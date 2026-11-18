# 团队 HTTPS 服务部署候选

`scripts/start-team-service.mjs` 用于在受控主机上运行独立团队服务。入口使用配置中的 HTTPS 源地址校验请求，并只监听本机 `127.0.0.1`。现有普通预览和审核预览继续使用各自的开发入口。

## 准备配置

使用 Node 24.15 或更新的 24.x 版本。在仓库之外准备一份独立的、已完成 schema 初始化的 SQLite 库，并核对数据库中的 `device-server-id`。服务启动会检查数据库身份和结构，拒绝演示库、未知身份或缺少数据库的配置。启动过程不会初始化、迁移或注入演示账号。

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

```powershell
node scripts/start-team-service.mjs --config 'D:/shenyi-service/service.json'
```

启动成功输出一行 `ready` JSON，包含实际监听地址、配置 origin 和服务实例 UUID。`GET /health` 提供进程存活状态，`GET /ready` 复核本地库可用性。常规停止信号为 `SIGINT`、`SIGTERM`，Windows 还支持 `SIGBREAK`。 [Node.js HTTPS 服务接口](https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener)

## 客户端与权限

桌面客户端使用单独配置的 HTTPS origin 和实例 UUID 连接。受管服务只接受已绑定手机号的账号通过密码登录，团队资料请求继续要求已绑定设备和当前权限。已配置的席位与订阅管理规则继续在服务端执行。演示账号登录和模拟付款处理关闭，短信验证、微信扫码、账号自助恢复和支付供应商留待实际接入。 [桌面连接配置](TRUSTED_TEAM_HTTPS.md)

当前验收使用本机受控 TLS 证书和明确标记的合成业务夹具。后续仍需验证实际域名和证书、服务器进程托管、外部代理、防护与告警、首位负责人账号开通、真实供应商、数据库迁移及正式上线切换。
