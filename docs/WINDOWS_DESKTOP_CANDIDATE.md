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

### 核验 Authenticode 发行包

先构建普通 Windows 候选，从中复制 `Shenyi.exe` 到候选包之外，由负责发行的人员给副本添加内嵌 Authenticode 签名和时间戳。保留原构建目录及清单。用独立可信渠道确认发布者叶证书的 SHA-256 指纹，取证书 DER 完整字节的摘要。只有受信的发布操作员应配置这个值，并在权限受控的本地 Windows 目录中运行以下命令。 [Microsoft Windows 签名工具](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)

```powershell
node scripts/windows-candidate-authenticode.mjs finalize `
  --bundle 'D:/release-lab/windows-unsigned' `
  --signed-exe 'D:/release-lab/externally-signed/Shenyi.exe' `
  --publisher-sha256 $publisherCertificateSha256 `
  --output 'D:/release-lab/windows-authenticode'
```

`finalize` 先核验原候选清单和文件。逐字节核对 PE，只接受签名所需的校验和、证书目录及文件末尾对齐和证书记录的变化。Windows 必须返回有效的内嵌签名、识别到时间戳证书，并匹配指定发布者。整个签名后文件的 SHA-256 进入新包清单，其余文件沿用原构建哈希。输出使用全新目录，原构建和外签副本继续留存。 [PE 文件格式](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format) · [Windows Authenticode 读取](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/get-authenticodesignature?view=powershell-5.1)

对新包完成上一节的 Ed25519 清单签名，再由独立验收人员执行以下双签名核验。发布者证书和清单公钥各自从可信渠道取得。

```powershell
node scripts/windows-candidate-authenticode.mjs verify `
  --bundle 'D:/release-lab/windows-authenticode' `
  --publisher-sha256 $publisherCertificateSha256 `
  --public-key 'D:/trusted-config/update-ed25519.pub.pem' `
  --signature 'D:/release-metadata/shenyi-0.61.0-win-x64.sig' `
  --installed-version '0.60.0'
```

`verify` 返回 `osSignatureVerified: true` 后再继续发行验收。当前核验范围为 `Shenyi.exe` 的内嵌签名和完整包清单，时间戳结果来自 Windows 验签。Windows 可能按本机信任配置联网检查证书。便携安装工具仍使用 Ed25519 核验包。正式系统安装器、发布证书和终端 Windows 安装验收继续单独办理。

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

正式部署由管理员提供已核对的服务配置和受信证书。M7O 使用子进程单独信任的自建 CA，并验证缺少该 CA 时连接被拒绝。该轮将合成文件路径交给产品主进程的选件回调，同时记录了提交成功后误报权限不足的问题。原生选件与提示修复见下节。

本轮用同一包实测重装被拒绝，实际新旧正式版本的切换仍待实机检验。系统安装器、Authenticode、macOS 原生安装和生产试点沿后续发行流程独立验收。

### 采集提交与原生选件

M7P 修正采集任务状态提示。提交成功并收到当前任务的权限结果后，界面显示「本任务已提交，等待负责人核对。」提交按钮保持禁用。退回状态和提交能力仍由服务端核验，相关界面回归覆盖了退回后重新提交。

真实安装版打开由客户端进程拥有的 Windows 文件选择窗口。取消后服务端无提交请求，任务、提交与附件记录保持原样。选中合成文件后产生一次签名提交并返回 `201`，SQLite 中的 64 字节原件与源文件逐字节一致。重启后沿用原设备密钥并读回提交历史。经理退回和重新提交本轮以自动测试验证。

M7P 在可写安装目录发现，Windows 文件选择窗口打开后会出现空 `log/`，严格清单复检返回 `CANDIDATE_INVENTORY_INVALID`。无窗口输入时也能复现，安装文件哈希与清单一致。调整主进程工作目录的实验已撤销。创建该目录的组件仍待定位。M7Q 在下节记录了写入受限副本的使用后验签。 [原生选件验收范围](NATIVE_OS_FILE_DIALOG_ACCEPTANCE.md#受管客户端采集选件)

### 限制安装目录写入

M7Q 在原签名清单和应用内容上做 NTFS 权限演练。新安装的 `bundle` 及其子项对本机测试用户限制写入。实测拒绝新建文件、目录以及为包内现有文件获取写入句柄，独立用户资料目录保持可写。客户端以非提升权限运行，真实文件选择、取消、提交和重启均成功。关闭后由操作员重新运行 `inspect`，2,006 个文件和 247 个目录与使用前一致。测试脚本、原 ACL 和报告保存在演练目录，ACL 操作仅限独立副本。 [Windows 文件权限](https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants)

正式安装由操作员控制安装父目录、`releases`、签名和 `state.json`。日常用户只需读取执行，用户配置、设备密钥及业务选件位于独立可写位置。验签公钥也由操作员从可信渠道固定并单独保护。验证有效权限时需同时检查父目录的删除子项能力，防止子目录被移除或替换。发布新版本时在受保护的父目录下创建新的版本目录并验签。 [权限继承](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights) · [删除与重命名权限](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew)

`apply`、`inspect` 和 `rollback` 由具备写入安装状态及锁文件权限的操作员执行。确认回执中的可执行文件后，使用日常账号启动。现有安装工具以便携目录为入口，正式部署仍需用独立的安装与日常账号实测有效权限、新旧正式版本切换、回滚和操作系统签名。

### 日常账号只读启动定位

日常账号可用 `resolve-launch` 核验当前活动版本，取得 `Shenyi.exe` 的绝对路径。先由操作员准备可信脚本和 Node 运行环境，保护安装状态、程序目录和独立取得的验签公钥，并为客户端配置已核对的团队服务。日常账号需要读取和执行权限，用户资料仍保存在独立可写目录。

```powershell
$receipt = node scripts/manage-windows-candidate-install.mjs resolve-launch `
  --root 'D:/shenyi-local-install' --public-key 'D:/trusted-config/update-ed25519.pub.pem'
if ($LASTEXITCODE -ne 0) { throw '无法核验已安装的审易版本。' }
$active = ConvertFrom-Json -InputObject ($receipt -join "`n")
& $active.executablePath
```

定位过程读取完整的签名和文件清单，并在输出前再次核对安装状态。当前存在安装锁或核验期间状态被替换时，请等操作员完成安装或回滚后重新定位。回执只对应本次核验时的活动版本。操作员仍用 `inspect` 获取带锁检查结果。

### 直接启动已验签版本

日常启动入口可调用 `launch`。由操作员在安装目录之外提供团队服务配置，固定受信的 Node 运行环境、启动工具和验签公钥，再用日常账号执行。

```powershell
node scripts/manage-windows-candidate-install.mjs launch `
  --root 'D:/shenyi-local-install' `
  --public-key 'D:/trusted-config/update-ed25519.pub.pem' `
  --service-config 'D:/trusted-config/team-service.json'
```

命令只读核对当前版本后直接启动安装包中的 `Shenyi.exe`。回执中的 `pid` 表示 Windows 已创建进程。窗口就绪、服务身份和设备登录由客户端继续核验。开始 `apply` 或 `rollback` 前，请关闭本次安装启动的客户端。切换后再从同一入口启动，有效的用户资料与设备绑定继续使用原位置。

客户端保留当前 Windows 用户的资料目录和公开微信应用配置。启动入口清除调试、预览、代理和 TLS 配置覆盖，发现关闭 TLS 校验的设置时拒绝启动。只有明确配置为 `https://127.0.0.1` 的本地演练可以继承绝对路径指定的额外测试 CA。公网部署使用正式证书。

M7S 在独立 Windows 安装中依次启动 `0.61.0`、签名演练版 `0.61.1` 和回滚后的 `0.61.0`。演练版包含已修复的采集界面和独立版本元数据。三个真实窗口均完成合成实习生登录，只显示获指派的任务。设备只在首次登录登记，升级与回滚后继续使用原密钥。回滚后的最高已接受版本仍为 `0.61.1`。此次使用测试发布签名和合成配置，正式版本更新与操作系统签名另按发行要求实测。
