# 团队 HTTPS 服务部署候选

`scripts/start-team-service.mjs` 用于在受控主机上运行独立团队服务。入口使用配置中的 HTTPS 源地址校验请求，并只监听本机 `127.0.0.1`。现有普通预览和审核预览继续使用各自的开发入口。

单机部署可复用 Nginx 双段 TLS 与 systemd 模板。 [Linux 部署、验证和回滚](LINUX_TEAM_DEPLOYMENT.md)

## 准备配置

使用 Node 24.15 或更新的 24.x 版本。在仓库之外准备一份独立的、已完成 schema 初始化的 SQLite 库，并核对数据库中的 `device-server-id`。新环境可按下节初始化首位产品负责人。服务启动会检查数据库身份和结构，拒绝演示库、未知身份或缺少数据库的配置。启动过程不会初始化、迁移或注入演示账号。

另行准备与 `apiBase` 主机匹配的 PEM 证书链和私钥，保存在受控的本机目录。示例均为路径和 UUID 格式示意。

```json
{
  "schemaVersion": 1,
  "database": "D:/shenyi-service/team.sqlite",
  "apiBase": "https://127.0.0.1:9443",
  "serverId": "11111111-1111-4111-8111-111111111111",
  "listenPort": 9443,
  "tlsCertificate": "D:/shenyi-tls/chain.pem",
  "tlsKey": "D:/shenyi-tls/server-key.pem"
}
```

`apiBase` 为规范 HTTPS origin，使用主机及可选端口，尾部无需斜杠。直接连接本地演练时，origin 的端口与 `listenPort` 使用同一个值。配置、数据库、证书和私钥使用不同的本机绝对文件路径。私钥路径与连接配置仅由运维端持有。 [SQLite 现有文件打开模式](https://www.sqlite.org/uri.html#urimode)

Windows 仍填写带盘符的普通本地绝对路径。数据库预检、启动预检和正式启动会在内部处理 SQLite 长路径，沿用现有文件和实例核验。已用包含中文、空格、`#` 和 `%` 的 326 字符合成路径验收。受管库加密备份、比对和恢复演练使用同样的路径写法。 [受管库加密备份](TEAM_OFFLINE_BACKUP.md#受管库加密备份)

```powershell
node scripts/start-team-service.mjs --config 'D:/shenyi-service/service.json'
```

启动成功输出一行 `ready` JSON，包含实际监听地址、配置 origin 和服务实例 UUID。`GET /health` 提供进程存活状态，`GET /ready` 复核本地库可用性。常规停止信号为 `SIGINT`、`SIGTERM`，Windows 还支持 `SIGBREAK`。 [Node.js HTTPS 服务接口](https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener)

### 首队试点就绪检查

在计划开通首个试点的主机上，用实际运行服务的本机账号和同一配置执行以下检查。将示例替换为该环境的配置文件绝对路径。

```sh
node scripts/start-team-service.mjs --check-pilot-readiness --config /etc/shenyi-team/service.json
```

退出码 `0` 和 `{"event":"pilot-ready"}` 表示本机已通过启动配置、TLS、短信配置、开通与激活结构、试点审批结构和审核员资格检查。至少一位有效审核员须有已验证手机号，且同时具备团队开通与试点审批权限。随后按正常流程登录审核账号和绑定电脑。命令只读打开 SQLite，结束时关闭连接，期间无需启动监听器或发送短信。供应商真实送达、负责人确认和试点授权按各自流程验收。

| 错误码 | 核对项 |
| --- | --- |
| `MANAGED_PILOT_SMS_REQUIRED` | 为首管理员与员工激活准备有效的短信配置。 |
| `MANAGED_PILOT_SCHEMA_NOT_READY` | 核对当前库的开通、激活、试点结构及有效版本。 |
| `MANAGED_PILOT_REVIEWER_NOT_READY` | 核对已验证手机号、账号状态及两项独立审核权限。 |

普通服务启动和 Linux 版本切换继续按 `--check-startup` 验收。首次试点按本节另行记录结果。 [团队开通与试点流程](MANUAL_TEAM_ONBOARDING.md#受管服务首个试点)

## 首位产品负责人

操作者先在线下核验负责人的身份及本人手机号。指定仓库之外尚未创建的本机子目录，通过 UTF-8 标准输入传入 `displayName`、`phone`、`password` 和 `verifiedOutOfBand`。核验完成后才将 `verifiedOutOfBand` 设为 `true`。

在 PowerShell 7 中可用掩码输入，再通过管道传给 CLI。 [PowerShell 掩码输入说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/read-host?view=powershell-7.6#-maskinput)

```powershell
$ownerInput = @{
  displayName = Read-Host '负责人姓名'
  phone = Read-Host '已核验的本人手机号' -MaskInput
  password = Read-Host '负责人初始密码' -MaskInput
  verifiedOutOfBand = ((Read-Host '已核验身份和手机号时输入 已核验') -ceq '已核验')
}
try {
  $ownerInput | ConvertTo-Json -Compress | node scripts/bootstrap-managed-team.mjs --output-dir 'D:/shenyi-service/new-instance'
} finally {
  $ownerInput.Clear()
}
```

将回执中的 `databasePath` 和 `serverId` 填入上节配置。数据库记录手机号的线下核验来源，密码使用现有 scrypt 哈希，回执不含手机号、姓名或密码。

初始负责人拥有团队开通、管理员恢复、停用、换机、业务职级兼任、旧项目迁入、退款受理及试点审批权限。初始库无团队、业务成员、技术管理员或设备绑定。负责人用已核验手机号首次登录并登记电脑后，可处理团队申请。首管理员激活采用本人验证。初始化入口用于全新目录，已有账号维护和恢复采用原有流程。 [团队开通与首管理员流程](MANUAL_TEAM_ONBOARDING.md)

新的负责人初始化同时配置试点审批使用的记录及权限。已有受管库继续使用原有流程，待授权升级后启用试点审批。

恢复审核须按下文显式启用。首版退款由产品负责人受理，团队暂不在客户端提交。现有退款受理入口已在合成账务候选验收，受管环境仍需接入正式账务。 [退款受理流程](BILLING_REFUND_INTAKE_CONTRACT.md)

## 客户端与权限

桌面客户端使用单独配置的 HTTPS origin 和实例 UUID 连接。受管服务支持已验证手机号密码登录，也可按下文显式启用微信扫码。团队资料请求继续要求已绑定设备和当前权限。已配置的席位与订阅管理规则继续在服务端执行。演示账号登录和模拟付款处理关闭。正式支付仍待接入。 [桌面连接配置](TRUSTED_TEAM_HTTPS.md)

### 查阅订阅与席位

团队技术管理员完成绑定电脑登录后，可在「订阅与席位」查看本团队的订阅状态、北京时间起止日、当前已购席位、在用席位和有效邀请预留。从面板刷新可重新核对期限和容量。订阅到期后仍可查看，其中已购席位按查询时刻仍有效的容量计算，已启用的成员和当前有效的邀请继续计入占用。

受管服务本阶段提供只读查询。在线续费、增购、对账及正式退款仍待正式账务接入。退款由产品负责人受理。 [退款受理流程](BILLING_REFUND_INTAKE_CONTRACT.md)

## 可选阿里云短信配置

服务配置新增可选的 `smsProfile`，指向仓库之外单独保管的 UTF-8 JSON 文件。省略此字段时短信能力关闭。启用前需取得实际可用的短信资质、签名、模板和授权凭据。该接入按阿里云短信中国站 `SendSms` 设计。 [申请与接入流程](https://help.aliyun.com/zh/sms/getting-started/use-sms-api) · [SendSms 接口](https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms)

```json
{
  "schemaVersion": 1,
  "provider": "aliyun",
  "accessKeyId": "<短信调用凭据ID>",
  "accessKeySecret": "<短信调用密钥>",
  "phonePepper": "<由安全随机源生成的32字节，无填充base64url>",
  "signName": "<已审批短信签名>",
  "templates": {
    "bind": "<手机号绑定模板ID>",
    "reset": "<恢复验证码模板ID>",
    "activate": "<员工激活模板ID>",
    "first-admin": "<首管理员激活模板ID>"
  }
}
```

使用 STS 临时凭据时同时配置 `securityToken`。四种用途配置已审批的 `SMS_` 模板 ID，模板参数为六位验证码 `code`。挑战只在供应商接受后才能用于验证，拒绝或超时按既有流程记为发送失败。 [阿里云 V3 请求签名](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature)

## 可选审核式密码恢复

在主服务配置中同时设置 `smsProfile` 和 `"reviewedRecovery": true`。省略 `reviewedRecovery` 或设为 `false` 时，审核式密码恢复关闭，其他已配置的短信功能可继续使用。启用时，缺少短信配置、短信配置无效或数据库缺少必要的恢复结构都会阻止启动。

本团队员工由该团队技术管理员审核，技术管理员本人由获授权的产品负责人审核。审核人须在已绑定电脑登录并验证当前密码。申请人须提供本人收到的短信验证码和一次性恢复凭证。改密成功后原会话失效，申请人需重新登录。含最高审核权限历史的账号首版不开放在线恢复。 [密码恢复流程](RECOVERY_APPROVAL.md) · [最高审核账号处理决定](PRIVILEGED_ACCOUNT_RECOVERY_DECISION.md)

## 可选微信网站应用扫码

取得微信开放平台网站应用授权后，在主配置添加 `wechatProfile`，指定仓库外的独立 UTF-8 JSON 文件。省略此字段时微信扫码关闭。启用时，`apiBase` 须是使用标准 HTTPS 端口的域名，服务端将唯一回调固定为同一 origin 下的 `/api/auth/wechat/callback`。Node 的回环监听端口可继续使用现有值，公网入口须提供与微信审核一致的域名。 [网站应用微信登录开发指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html) · [腾讯 PC 微信登录](https://cloud.tencent.com/document/product/1441/62649)

```json
{
  "schemaVersion": 1,
  "provider": "wechat-open-platform",
  "appId": "<已批准的网站应用 AppID>",
  "appSecret": "<服务端保管的 AppSecret>"
}
```

桌面部署采用[版本 2 受信配置](TRUSTED_TEAM_HTTPS_CONTRACT.md#微信扫码的版本-2-配置)，将同一公开 AppID 写入 `wechatAppId`。客户端从已配置的 HTTPS 源地址生成固定回调。macOS Finder 与 Windows 可使用该配置直接启用已获批的扫码入口。版本 1 仍支持 `SHENYI_WECHAT_APP_ID` 和 `SHENYI_WECHAT_REDIRECT_URI`，须与服务端应用及回调一致。AppSecret 留在服务端。首次使用时，员工先用已验证手机号与密码登录并完成电脑绑定，退出后在这台电脑上扫码并确认关联。客户端使用独立的临时会话证明设备，关联结束清理临时会话。以后扫码仍须核验当前绑定设备，原员工身份、团队和项目权限继续生效。

授权页拒绝或关闭后，可回到桌面取消，未完成的事务按服务端期限过期。换码请求和响应由服务端处理，持久化关联使用同一 AppID 下的 OpenID。回调正文不返回身份、票据或会话。部署时沿用代理的专用回调日志规则，验收代理故障时的日志与其他转发层的记录。 [身份方案](PHONE_WECHAT_AUTH_PLAN.md) · [Linux 代理模板](LINUX_TEAM_DEPLOYMENT.md)

当前验收使用本机受控 TLS 证书和合成账号。后续仍需验证实际域名和证书、服务器进程托管、外部代理、防护与告警、真实负责人身份与手机号核验、真实供应商、数据库迁移及正式上线切换。
