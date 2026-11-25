# shenji.vip 官网与 Windows 首发

截至 2026-11-25，产品负责人确认域名 `shenji.vip` 已购，已通过阿里云提交网站 ICP 备案，正在审核。拟用于托管官网的阿里云服务器尚未购买。首发使用根域名 `https://shenji.vip`。Windows 为首发平台，macOS 第二阶段再验收。网站、客户端和生产团队服务有各自的上线时间。[Windows 路线 #22](https://github.com/icesad/shenyi-audit-workspace/issues/22)

## 负责人现在做什么

| 时点 | 产品负责人和运维 | 业务体验 |
| --- | --- | --- |
| 等待审核 | 在现有阿里云备案订单查看进度、短信核验和补正通知。记录域名到期日及拟购资源，购买前核对订单中的域名、接入资源和部署地域。阿里云已是本次申请的接入商。 | 从完整解压后的六模块体验目录打开 `ShenyiWorkbench.exe`，使用合成资料核对六个入口、保存和重开。 |
| 确定服务器 | 选择有固定公网地址、可用于本次备案接入的中国内地 Linux 实例，记录地域、带宽、流量和备份预算。可先准备环境与证书。下载流量可按“安装包大小 × 预计下载次数”估算。 | 确认向客户开放的模块和 Windows 验收清单。 |
| 收到备案结果 | 核对成功通知中的域名、主体及**网站**备案号。具备服务器和证书后，可先开通产品官网，此时页面展示真实备案号及下载待发布状态。 | 核对公开介绍与实际交付能力一致。 |
| 客户端准备好 | 在干净 Windows 电脑上核验普通用户安装、首次启动、升级、卸载、数据恢复、六模块和相应权限；批准发布者、版本、SHA-256 与回退版本后再开放客户下载。 | 由产品负责人汇总并确认脱敏样本的业务回归，确认安装版与验收版本一致。 |
| 实际对外开放后 | 记录首次开放日期，按规定在开通之日起 30 日内提交公安联网备案；获批后按平台要求在页脚展示公安备案标识。 | 用客户网络再核对下载、文件签名与启动。 |

首次备案取得备案号前保持本机或内网预览。已有阿里云订单的当前环节和资源要求以该订单为准。[阿里云备案期间的访问说明](https://help.aliyun.com/zh/icp-filing/the-influence-of-the-record-during-the-site-visit) · [管局审核](https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/administration-review) · [公安联网备案](https://help.aliyun.com/zh/icp-filing/basic-icp-service/the-public-security-network-for-record-and-cancellation)

## 备案通过后，先开通官网

1. 在已核对的源码提交、干净工作区中使用 Node.js 24.15 或以上的 24.x。准备一个尚不存在的仓库外输出目录。PowerShell 示例中的备案号由经办人输入。
2. 使用生成的官网文件和同次构建的 Nginx 配置。只有 `site/` 的内容进入网站根目录。将 `baseline.json`、它的 SHA-256 和源码提交保存在发布记录中，供上线后用另一台电脑核验。
3. 在 ECS 上为官网配置 Nginx、覆盖 `shenji.vip` 的可信 TLS 证书及私钥。模板路径为 `/etc/nginx/shenyi-website/public-chain.pem` 和 `public-key.pem`。将安全组与系统防火墙的 HTTPS 443 配置好。团队 API、管理后台、测试数据和签名材料均位于站点根目录之外。[阿里云 Nginx 证书部署](https://help.aliyun.com/zh/ssl-certificate/install-ssl-certificates-on-nginx-servers-or-tengine-servers)
4. 在域名当前使用的权威 DNS 上配置根域名的 A 记录，主机记录为 `@`，值为该实例的实际公网 IPv4。仅在备案订单接入成功、站点已准备好且准备开放后切换流量。`www.shenji.vip` 需要另配 DNS、证书和主机规则，首发只公布根域名。[阿里云根域名解析](https://help.aliyun.com/zh/dns/getting-started-with-website-dns)

```powershell
$siteCommit = git rev-parse HEAD
$icpNumber = Read-Host '输入备案成功通知中的网站备案号'
node scripts/build-windows-download-site.mjs --output D:/Releases/shenji-site-initial --source-commit $siteCommit --filing-number $icpNumber
```

首次开站由运维将构建的 `site/` 内容完整复制到 `/srv/shenyi-website/releases/<发布编号>/`，用该目录作为只读站点。网站符号链接 `/srv/shenyi-website/current` 指向活动版本。生成的 `nginx-shenyi-website.conf` 交由运维安装到 Nginx 的 `http` 配置上下文。切换前保留上版目录和配套配置，执行 `nginx -t` 成功后再加载配置。若已有团队 API 虚拟主机，请沿用其默认主机配置。公开官网可先独立运行。[Linux 部署与原子回退步骤](LINUX_TEAM_DEPLOYMENT.md#官网静态站与团队-api-并行部署)

## 客户从哪里下载

客户始终访问官网首页的「下载中心」。发布状态由静态构建产物决定，立项、账号和订单接口不挂在公开官网的静态路由上。

| 准备好的产物 | 下载中心对客户展示 |
| --- | --- |
| 网站备案已通过，客户安装器尚未签发 | 展示已获批备案号并链接工信部，普通客户下载待发布。 |
| 已获准的客户 Windows 安装程序 | 下载按钮、版本、文件大小与 SHA-256。下载地址固定为本域下的 `/downloads/shenyi-windows-setup.exe`。 |
| 单独核验的团队受管部署 MSI | 明确标为管理员部署文件，供管理员配置和激活。六模块本机走查 ZIP 始终留在本地。 |

在 Windows 发布机上，用独立核准的签发资料准备仓库外 JSON。普通客户安装器使用 `filingNumber`、`customerExe`（绝对路径）、`sha256`、`publisherSha256`（签发证书 SHA-256 指纹）和 `version`。文件摘要须取自同一份客户安装器在干净 Windows 完成安装、升级、启动及卸载验收后的独立批准记录；发布者指纹从受信签发资料核实。构建时重新检查安装程序的 Windows 签名、时间戳、版本及摘要，再将同一文件复制到正式下载目录。

```powershell
$siteCommit = git rev-parse HEAD
node scripts/build-windows-download-site.mjs --output D:/Releases/shenji-windows-release --source-commit $siteCommit --release-input D:/ReleaseInputs/customer-windows.json
```

受管部署 MSI 使用独立参数 `filingNumber`、`msi`、`publicKey`、`sha256`、`publisherSha256`、`version`、`installedVersion` 和 `appPayloadSha256`，其中两个文件均用绝对路径；临时目录 `scratchRoot` 可选。受管安装源及信任建立参见[Windows 发行说明](WINDOWS_DESKTOP_CANDIDATE.md)。两类产物按对应发布模式生成独立整站版本。

## 上线核对与回退

从外部办公网络打开首页、核对域名和备案链接。部署带下载的版本时，从首页实际点击下载、核对签名和摘要，再在干净 Windows 上启动。自动核对使用本次发布保存的基线和独立确认的基线摘要。

```powershell
$baselineDigest = Read-Host '输入本次获批基线的 SHA-256'
node scripts/check-website-release.mjs --origin https://shenji.vip --baseline D:/Releases/shenji-windows-release/baseline.json --baseline-sha256 $baselineDigest
Get-FileHash -Algorithm SHA256 -LiteralPath "$env:USERPROFILE/Downloads/shenyi-windows-setup.exe"
```

有问题时将站点与其 Nginx 配置一并切回上一批，重新执行 `nginx -t`、重载并按上一批基线核验。若只需撤下安装器，可切回已备案、下载待发布的版本，首页仍可访问。记录时间、版本和核验结果。
