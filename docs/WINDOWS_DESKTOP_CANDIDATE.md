# Windows x64 桌面便携候选

此目录包用于本地发行验证。它包含 `Shenyi.exe`、同目录的 Electron 运行文件和桌面客户端。包内没有安装程序、服务端或连接配置。运行时请保留完整目录。

## 构建

从仓库根目录运行。构建使用 Node 24.15 或更新的 24.x 版本、其可调用的 npm、按桌面锁文件安装的 Electron 工具，以及已经包含根锁文件生产依赖的本地 npm 缓存。输出目录的上级目录应已存在，输出目录位于仓库之外且尚未创建。

```powershell
node scripts/build-windows-desktop-candidate.mjs `
  --electron-archive 'D:/codex-temp/electron-cache/manual/electron-v45.3.2-win32-x64.zip' `
  --npm-cache 'D:/codex-temp/npm-cache' `
  --output 'D:/codex-temp/shenyi-windows-local/stage-win-x64'
```

构建核验 Electron 官方归档 SHA-256，按清单复制客户端源码，并从锁文件离线安装生产依赖。产出的 `candidate-manifest.json` 记录归档固定版本、候选状态及清单之外每个文件的大小和 SHA-256。进入签名发行阶段后，还需独立校验发布签名。 [Electron 官方打包说明](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)

## 启动

由部署人员在包目录之外准备可信团队服务配置，并把其绝对路径作为 `SHENYI_TEAM_SERVICE_CONFIG` 传给 `Shenyi.exe`。该文件包含 `schemaVersion`、团队服务的 HTTPS 源地址 `apiBase`，以及部署时确定的服务实例 UUID `serverId`。客户端根据正常证书链校验 HTTPS，并在公开认证能力读取后核验实例，再使用登录凭据。 [服务配置约定](TRUSTED_TEAM_HTTPS_CONTRACT.md)

```powershell
$env:SHENYI_TEAM_SERVICE_CONFIG = 'D:/local-test-config/trusted-team.json'
& 'D:/codex-temp/shenyi-windows-local/stage-win-x64/Shenyi.exe'
```

生产配置尚未签发，本地验收使用单独准备的合成服务配置。启动缺少配置、配置无效或附带开发预览目录开关时，程序退出并返回非零状态。成功启动后，Windows 的 Chromium 配置位于 `%LOCALAPPDATA%/ShenyiTeamDesktop/profile`，设备密钥位于同一应用目录的 `device-vault`，由系统凭据保护。开发预览沿用各自目录。预览页的固定合成密码可从使用说明查阅。 [预览使用说明](ISOLATED_CANDIDATE_PREVIEW.md)

## 发行验收

### 发布清单签名与验签

签名人员使用独立保管的 Ed25519 PKCS#8 PEM 私钥。验签人员从可信渠道预先取得对应的 SPKI PEM 公钥。密钥与签名文件放在候选目录和仓库之外，公钥由验签方独立配置。密钥路径使用绝对路径，Windows 路径包含盘符。

```powershell
node scripts/windows-candidate-signature.mjs sign `
  --bundle 'D:/codex-temp/shenyi-windows-local/stage-win-x64' `
  --private-key 'D:/publisher-private/update-ed25519.pem' `
  --signature 'D:/release-metadata/shenyi-0.61.0-win-x64.sig'

node scripts/windows-candidate-signature.mjs verify `
  --bundle 'D:/codex-temp/shenyi-windows-local/stage-win-x64' `
  --public-key 'D:/trusted-config/update-ed25519.pub.pem' `
  --signature 'D:/release-metadata/shenyi-0.61.0-win-x64.sig' `
  --installed-version '0.60.0'
```

签名为 64 字节的独立文件。签名命令先核对清单和全部包文件，在支持硬链接的文件系统上排他发布签名。已有目标不会被覆盖。验签读取配置的公钥，验证签名、版本、精确文件清单、文件大小和 SHA-256。输出记录签名、清单、公钥指纹、候选版本和验签时提供的已安装版本。 [Node.js 签名接口](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptosignalgorithm-data-key-callback)

`--installed-version` 取可信的本机已安装版本，使用三段正式版本号。验签会拒绝等于或低于输入版本的候选。当前离线工具由操作者提供这个值，尚未接入安装器读取或持久维护版本。验签检查当时目录中的文件，验签后的保管或安装由部署流程负责。

### 后续发行验证

当前交付是便携目录与独立发布签名。Windows EXE 的 Authenticode 签名、安装与原地升级、可回滚安装验收、macOS 原生构建及签名公证仍待完成。正式发布密钥与操作系统证书需独立配置，本地验证使用合成测试密钥。
