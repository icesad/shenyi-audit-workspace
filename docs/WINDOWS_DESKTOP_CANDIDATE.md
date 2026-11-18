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

直接调用 `verify` 时，`--installed-version` 由操作者按可信的本机记录提供，使用三段正式版本号。验签会拒绝等于或低于输入版本的候选。使用下文的便携安装工具时，版本依据来自安装目录的状态记录。

### 管理本地便携安装

使用 `manage-windows-candidate-install.mjs` 在专用目录管理便携包。首次安装使用尚未创建或为空的本地目录，目录位于候选包和仓库之外。此入口使用已单独配置的发布公钥，无需提供当前安装版本。示例中的候选包和发布签名是上一节的成对产物。

```powershell
$installRoot = 'D:/shenyi-local-install'
$publisherKey = 'D:/trusted-config/update-ed25519.pub.pem'
node scripts/manage-windows-candidate-install.mjs apply `
  --root $installRoot --public-key $publisherKey `
  --bundle 'D:/codex-temp/shenyi-windows-local/stage-win-x64' `
  --signature 'D:/release-metadata/shenyi-0.61.0-win-x64.sig'
node scripts/manage-windows-candidate-install.mjs inspect --root $installRoot --public-key $publisherKey
node scripts/manage-windows-candidate-install.mjs rollback --root $installRoot --public-key $publisherKey
```

升级沿用同一安装目录和公钥，将 `--bundle` 与 `--signature` 改为更高版本的成对产物。CLI 核验输入与新复制的全部文件，再更新当前版本。`inspect` 重新验签并返回可启动的 `executablePath`。关闭本次演练正在运行的客户端后，按上文配置可信服务，通过返回的路径手动打开已切换版本。

`rollback` 仅切换到仍可通过核验的上一版。回滚后保留已接受的最高版本记录，常规升级仍须超过这个版本。此命令只管理程序目录；客户端配置、设备密钥与服务端数据各自沿用原位置。版本状态保存在安装目录中的 `state.json`，历史程序及失败时保留的复制文件位于 `releases`。Windows 演练在专用目录验证切换与版本读取；系统级安装、断电耐久和跨版本业务数据迁移待单独验收。 [Node.js 文件操作接口](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath)

### 后续发行验证

当前交付是便携目录、独立发布签名及本地版本切换工具。Windows EXE 的 Authenticode 签名、系统安装器、macOS 原生构建及签名公证仍待完成。正式发布密钥与操作系统证书需独立配置，本地验证使用合成测试密钥。

### 受管服务窗口验收

Windows x64 0.61.0 便携候选已通过临时发布密钥验签并安装到独立目录。由安装回执指定的 `Shenyi.exe` 连接隔离的受管 HTTPS 服务，分别走通技术管理员、实习生及同一绑定设备重新打开。两个角色使用已验证的合成手机号和独立的设备密钥。技术管理员可打开和刷新本团队的订阅与席位，实习生只看到获指派的任务。实际提交的合成原件与数据库留存内容逐字节一致。

正式部署由管理员提供已核对的服务配置和受信证书。原生验收使用子进程单独信任的自建 CA，并验证缺少该 CA 时连接被拒绝。测试将合成文件路径交给产品主进程的选件回调，系统选件对话框的人工操作待验收。提交成功后界面会显示已保存，当前的上传说明仍会说账号无提交权限。这句提示需要按已提交状态调整。

本轮用同一包实测重装被拒绝，实际新旧正式版本的切换仍待实机检验。系统安装器、Authenticode、macOS 原生安装和生产试点沿后续发行流程独立验收。
