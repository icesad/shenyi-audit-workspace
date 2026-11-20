# Windows x64 桌面便携候选

此目录包用于本地发行验证。它包含 `Shenyi.exe`、同目录的 Electron 运行文件和桌面客户端。包内没有安装程序、服务端或连接配置。运行时请保留完整目录。

## 构建

签名前的发行候选从记录的提交构建。可将该提交的 `git archive` 解到独立目录，在该目录按锁文件准备桌面构建依赖。若使用现有工作区，先逐文件核对构建清单中的实际字节和 Git 中的源文件。Git 会归一化文本换行符，签名前应用摘要按归档中的实际字节计算。

从仓库根目录运行。构建使用 Node 24.15 或更新的 24.x 版本、其可调用的 npm、按桌面锁文件安装的 Electron 工具，以及已经包含根锁文件生产依赖的本地 npm 缓存。输出目录的上级目录应已存在，输出目录位于仓库之外且尚未创建。

```powershell
node scripts/build-windows-desktop-candidate.mjs `
  --electron-archive 'D:/codex-temp/electron-cache/manual/electron-v45.3.2-win32-x64.zip' `
  --npm-cache 'D:/codex-temp/npm-cache' `
  --output 'D:/codex-temp/shenyi-windows-local/stage-win-x64'
```

构建核验 Electron 官方归档 SHA-256，按清单复制客户端源码，并从锁文件离线安装生产依赖。产出的 `candidate-manifest.json` 记录归档固定版本、候选状态及清单之外每个文件的大小和 SHA-256。进入签名发行阶段后，还需独立校验发布签名。 [Electron 官方打包说明](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)

桌面候选和双人评审包使用同一发布步骤。构建完成后，系统 PowerShell 调用 Windows 目录移动把暂存目录发布到目标。若目标名已被占用，保留目标和暂存目录。遇到临时占用类错误最多再尝试两次，并在每次移动前复核目录身份及目标是否仍空缺。最终失败时，命令返回错误和保留的暂存路径。 [Windows 目录移动规则](https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.move?view=netframework-4.8.1)

## 启动

以下方法用于直接启动未安装的本地候选。已安装的双签名候选按[双签名便携安装](#双签名便携安装)启动。可信团队服务配置由部署人员在包目录之外准备。直接启动未安装候选时，将配置的绝对路径作为 `SHENYI_TEAM_SERVICE_CONFIG` 传给 `Shenyi.exe`。该文件包含 `schemaVersion`、团队服务的 HTTPS 源地址 `apiBase`，以及部署时确定的服务实例 UUID `serverId`。客户端根据正常证书链校验 HTTPS，并在公开认证能力读取后核验实例，再使用登录凭据。 [服务配置约定](TRUSTED_TEAM_HTTPS_CONTRACT.md)

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

`verify` 返回 `osSignatureVerified: true` 后再继续发行验收。当前核验范围为 `Shenyi.exe` 的内嵌签名和完整包清单，时间戳结果来自 Windows 验签。Windows 可能按本机信任配置联网检查证书。完成核验的 `schemaVersion: 2` 候选按[双签名便携安装](#双签名便携安装)管理。

### 管理本地便携安装

以下命令用于 `schemaVersion: 1` 便携演练。首次安装使用还未创建或为空的专用本地目录，目录位于候选包和仓库之外。命令使用独立配置的 Ed25519 公钥和该候选清单的发布签名，当前版本取自安装状态。本类目录后续只接受同类候选。

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

### 双签名便携安装

首次安装 `schemaVersion: 2` 候选时，为它准备全新的专用本地安装目录。维护方通过独立可信渠道取得 Ed25519 公钥和发布者叶证书的 DER 字节 SHA-256 指纹，分别保存到受保护的配置目录。日常账号对该配置目录只有读取权限。首次 `apply` 固定这两个信任值，之后每次安装、检查、定位、启动和回滚都传入相同的公钥和指纹。`schemaVersion: 1` 的既有目录继续用于便携演练，双签名候选须安装到新目录。发布者证书轮换流程待另行制定。

在仓库根目录打开 PowerShell。安装操作员和日常账号分别在自己的窗口设置以下变量。

```powershell
$installTool = 'scripts/manage-windows-candidate-install.mjs'
$installRoot = 'D:/shenyi-signed-install'
$publisherKey = 'D:/trusted-config/update-ed25519.pub.pem'
$publisherSha256 = (Get-Content -Raw -LiteralPath 'D:/trusted-config/publisher-cert-sha256.txt').Trim()
```

安装操作员先安装一份已完成两种签名的新候选。安装命令核验候选与复制后的文件，再切换活动版本。`inspect` 可复核活动版本。双签名核验通过后，成功回执含 `osSignatureVerified: true` 和发布者指纹。

```powershell
node $installTool apply `
  --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256 `
  --bundle 'D:/release-lab/windows-0.61.0-authenticode' `
  --signature 'D:/release-metadata/shenyi-0.61.0-win-x64.sig'
node $installTool inspect --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256
```

日常账号使用相同的工具、目录和受保护的信任配置。`resolve-launch` 返回本次核验时的可执行路径。正常启动可直接调用 `launch`，另传入安装目录之外的团队服务配置绝对路径。两个命令均执行双签名核验。

```powershell
node $installTool resolve-launch --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256
node $installTool launch `
  --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256 `
  --service-config 'D:/trusted-config/team-service.json'
```

升级前关闭本次安装启动的客户端。由安装操作员传入同一信任配置下更高版本的包和发布签名。

```powershell
node $installTool apply `
  --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256 `
  --bundle 'D:/release-lab/windows-0.61.1-authenticode' `
  --signature 'D:/release-metadata/shenyi-0.61.1-win-x64.sig'
```

需要回退时，先关闭客户端。回滚只核验即将生效的上一版。当前程序包损坏或其签名失去信任时，只要安装状态可读、上一版仍通过双签名，就可以回退。最高已接受版本继续保留，下一次升级仍须超过该版本。

```powershell
node $installTool rollback --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256
```

### 恢复中断的 Windows 安装

安装或升级进程异常退出，目录仍提示 `INSTALL_BUSY` 时，可以用同一套发行工具和信任配置执行 `recover`。Windows 会独占打开现有锁。安装进程或另一恢复进程仍持有锁时，命令返回 `INSTALL_BUSY`，保留现场。

```powershell
node $installTool recover --root $installRoot --public-key $publisherKey --publisher-sha256 $publisherSha256
```

恢复先核对已提交的状态和可用发行包，再清理未发布的安装状态临时文件。活动版本、上一版记录、历史发行目录和最高已接受版本保持原样。首次安装尚未提交状态时，恢复只清除遗留锁和临时状态，随后可重试安装。已无锁时返回 `recovered: false`。

回执 `verifiedRelease: active` 表示已核验活动版，可继续用 `resolve-launch` 检查入口。若仅上一版通过核验，回执为 `verifiedRelease: previous`，由操作员另行执行 `rollback`。遇到公钥或发布者指纹不符、无法核验的状态或异常目录项时，保留锁供检查。 [Windows 文件共享规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)

### Windows MSI 发布来源

在 Windows 用 `build-windows-release-msi.mjs` 将 `schemaVersion: 2` 双签名候选制作成 MSI。使用独立配置的 Ed25519 公钥与发布者叶证书 DER 字节的 SHA-256 指纹。输出使用仓库和输入候选目录之外的绝对 `.msi` 路径，父目录须已存在，输出文件须尚未创建。

```powershell
$publisherKey = 'D:\trusted-config\update-ed25519.pub.pem'
$publisherSha256 = (Get-Content -Raw -LiteralPath 'D:\trusted-config\publisher-cert-sha256.txt').Trim()
$releaseMsi = 'D:\release-lab\shenyi-0.61.0-win-x64.msi'
node scripts/build-windows-release-msi.mjs `
  --bundle 'D:\release-lab\windows-0.61.0-authenticode' `
  --signature 'D:\release-metadata\shenyi-0.61.0-win-x64.sig' `
  --public-key $publisherKey --publisher-sha256 $publisherSha256 `
  --output $releaseMsi
```

构建器使用 Windows Installer COM 和 MakeCab，校验输入及暂存副本的双签名。生成 MSI 后先只读核对发行结构，再由 Windows Installer 以 `/a` 解出管理映像并核验发行内容。成功回执的 `workingDirectory` 指向构建记录与管理映像，其中 `source-policy.stdout.txt` 记录结构核验。MSI 按机器安装、按版本并存，默认目标是 64 位 Program Files 下的 `Shenyi\ReleaseSource\<version>\bundle`，`signature.ed25519` 与 `bundle` 同级。MSI 只携带发行副本。包内无密钥、团队服务配置或用户资料，也不会创建快捷方式或启动客户端。 [Windows Installer 管理安装](https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation)

如需独立复核管理映像，用新目录作为 `TARGETDIR`。完成后，`bundle` 与 `signature.ed25519` 直接位于该目录下。`/a` 生成管理映像，本机产品注册使用 `/i`。本轮未执行 `/i`。 [TARGETDIR 说明](https://learn.microsoft.com/en-us/windows/win32/msi/targetdir)

```powershell
$releaseSource = 'D:\release-lab\shenyi-0.61.0-admin-image'
$msiArgs = '/a "{0}" TARGETDIR="{1}" /qn /norestart' -f $releaseMsi, $releaseSource
$extraction = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" `
  -ArgumentList $msiArgs -WindowStyle Hidden -Wait -PassThru
if ($extraction.ExitCode -ne 0) { throw "MSI 管理映像提取失败，退出码 $($extraction.ExitCode)" }
```

取得发行来源后，由操作员将它应用到独立受保护的活动安装目录。下例使用管理映像的根目录。将来正式安装时，`$releaseSource` 使用实际安装的 `Shenyi\ReleaseSource\<version>`。激活时仍核验签名和版本，启动、升级及回滚沿用[双签名便携安装](#双签名便携安装)。

```powershell
node scripts/manage-windows-candidate-install.mjs apply `
  --root 'D:\shenyi-signed-install' --public-key $publisherKey --publisher-sha256 $publisherSha256 `
  --bundle (Join-Path $releaseSource 'bundle') `
  --signature (Join-Path $releaseSource 'signature.ed25519')
```

### 外签后核验最终 MSI

构建器产出的 MSI 由发行人员另行添加经批准的 Authenticode 签名及时间戳。保留构建回执和包内双签名核验记录，并由发行人员通过可信渠道交付**签名完成后的 MSI SHA-256**。发布者证书的 DER SHA-256 指纹同样由可信渠道取得。 [Windows Installer 数字签名](https://learn.microsoft.com/en-us/windows/win32/msi/digital-signatures-and-windows-installer)

```powershell
$finalMsi = 'D:\release-lab\shenyi-0.61.0-win-x64-signed.msi'
$approvedMsiSha256 = (Get-Content -Raw -LiteralPath 'D:\trusted-config\shenyi-0.61.0-msi-sha256.txt').Trim()
node scripts/windows-candidate-authenticode.mjs verify-msi --msi $finalMsi --msi-sha256 $approvedMsiSha256 --publisher-sha256 $publisherSha256
```

核验成功时输出最终文件的 SHA-256、字节数、发布者指纹，以及 Windows Authenticode、时间戳和只读 MSI 数据库检查结果。命令不启动安装器。Windows 可以按系统配置检查证书信任。交付方保存这份回执和构建阶段的包内双签名回执。 [Windows Installer 只读数据库模式](https://learn.microsoft.com/en-us/windows/win32/msi/installer-opendatabase)

外签后也用最终 MSI 的同一份可信摘要复核审易发行结构。在 64 位 Windows PowerShell 中指定该次发行的版本。 [标准安装执行序列](https://learn.microsoft.com/en-us/windows/win32/msi/installexecutesequence-table)

```powershell
& 'D:/ShenyiDeploy/scripts/inspect-windows-release-msi.ps1' `
  -MsiPath 'D:/delivery/Shenyi-0.61.0-x64.msi' `
  -ExpectedVersion '0.61.0' `
  -ExpectedSha256 $SignedMsiSha256
```

结构检查只读核对 x64、机器级安装、版本目录、文件和组件映射、内嵌 CAB 及两套受限执行序列，并拒绝额外安装表或嵌入变换。保留 `sourcePolicyVerified` 回执。此命令不调用 `msiexec`，签名及时间戳仍由上面的 `verify-msi` 单独核验。 [微软的 MSI 签名说明](https://learn.microsoft.com/en-us/windows/desktop/Msi/digital-signatures-and-windows-installer)

### 接收正式 MSI 并核对内层发布

签名前用 Node 24.15 或更新的 24.x 核对本次获准源码生成的完整候选。`$approvedCandidate` 使用候选目录的绝对路径。

```powershell
node scripts/verify-windows-candidate-inventory.mjs --bundle $approvedCandidate
```

核对回执的 `manifestSha256` 与获准候选清单一致。将回执的 `appPayloadSha256` 连同源码提交、候选清单摘要、架构和版本写入发行批准记录。应用负载摘要覆盖 `resources/app/` 内的相对路径、字节数和内容，`Shenyi.exe` 的 Authenticode 签名可单独完成。

接收人员从该记录取得应用负载摘要，另从可信渠道取得最终 MSI SHA-256、发布者叶证书 SHA-256、发行版本和 Ed25519 公钥。已接受版本从本机安装台账取得，首次台账为空时填 `0.0.0`。

```powershell
node scripts/check-windows-release-msi.mjs `
  --msi $finalMsi --msi-sha256 $approvedMsiSha256 --publisher-sha256 $publisherSha256 `
  --public-key $trustedEd25519PublicKey --version $releaseVersion --installed-version $installedVersion `
  --app-payload-sha256 $approvedAppPayloadSha256
```

该命令核对同一独立临时副本的摘要、Authenticode、时间戳和审易 MSI 结构。外层校验全部通过后，Windows Installer 用 `/a` 生成临时管理映像。工具在该映像核对清单、发行文件、Ed25519 签名和程序签名，核对载荷数量、大小、版本及获准应用负载摘要一致后给出回执。回执含两层摘要、匹配的 `appPayloadSha256`、发布者、ProductCode、PackageCode、版本及 `systemInstallPerformed: false`。摘要不一致时停止验收并核对构建输入。完成后清理本次临时目录。 [Windows Installer 管理提取](https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation)

临时目录默认建在本机用户主目录。可用 `--scratch-root` 指定已有的受保护本地目录。工具先核对祖先目录的所有者和变更权限，再为新目录关闭权限继承，仅允许当前用户、SYSTEM 和本机管理员访问。父目录允许其他人员删除或改权时，在读取 MSI 之前拒绝。

审易正式证书和已签名 MSI 就绪后，仍须在独立 Windows 终端验证安装注册、有效权限、升级、回滚和卸载。macOS 实机安装、签名和公证另按对应发行流程验收。

### 受管服务窗口验收

Windows x64 0.61.0 便携候选已通过临时发布密钥验签并安装到独立目录。由安装回执指定的 `Shenyi.exe` 连接隔离的受管 HTTPS 服务，分别走通技术管理员、实习生及同一绑定设备重新打开。两个角色使用已验证的合成手机号和独立的设备密钥。技术管理员可打开和刷新本团队的订阅与席位，实习生只看到获指派的任务。实际提交的合成原件与数据库留存内容逐字节一致。

正式部署由管理员提供已核对的服务配置和受信证书。M7O 使用子进程单独信任的自建 CA，并验证缺少该 CA 时连接被拒绝。该轮将合成文件路径交给产品主进程的选件回调，同时记录了提交成功后误报权限不足的问题。原生选件与提示修复见下节。

该轮用同一包实测重装被拒绝。双签名包使用[双签名便携安装](#双签名便携安装)中的门禁。[Windows MSI 发布来源](#windows-msi-发布来源)覆盖独立管理映像。正式系统安装注册、实际新旧正式版本切换、macOS 实机安装和生产试点另行验收。

### 采集提交与原生选件

M7P 修正采集任务状态提示。提交成功并收到当前任务的权限结果后，界面显示「本任务已提交，等待负责人核对。」提交按钮保持禁用。退回状态和提交能力仍由服务端核验，相关界面回归覆盖了退回后重新提交。

真实安装版打开由客户端进程拥有的 Windows 文件选择窗口。取消后服务端无提交请求，任务、提交与附件记录保持原样。选中合成文件后产生一次签名提交并返回 `201`，SQLite 中的 64 字节原件与源文件逐字节一致。重启后沿用原设备密钥并读回提交历史。经理退回和重新提交本轮以自动测试验证。

M7P 在可写安装目录发现，Windows 文件选择窗口打开后会出现空 `log/`，严格清单复检返回 `CANDIDATE_INVENTORY_INVALID`。无窗口输入时也能复现，安装文件哈希与清单一致。调整主进程工作目录的实验已撤销。创建该目录的组件仍待定位。M7Q 在下节记录了写入受限副本的使用后验签。 [原生选件验收范围](NATIVE_OS_FILE_DIALOG_ACCEPTANCE.md#受管客户端采集选件)

### 限制安装目录写入

M7Q 在原签名清单和应用内容上做 NTFS 权限演练。新安装的 `bundle` 及其子项对本机测试用户限制写入。实测拒绝新建文件、目录以及为包内现有文件获取写入句柄，独立用户资料目录保持可写。客户端以非提升权限运行，真实文件选择、取消、提交和重启均成功。关闭后由操作员重新运行 `inspect`，2,006 个文件和 247 个目录与使用前一致。测试脚本、原 ACL 和报告保存在演练目录，ACL 操作仅限独立副本。 [Windows 文件权限](https://learn.microsoft.com/en-us/windows/win32/fileio/file-access-rights-constants)

正式安装由操作员控制安装父目录、`releases`、签名和 `state.json`。日常用户只需读取执行，用户配置、设备密钥及业务选件位于独立可写位置。验签公钥也由操作员从可信渠道固定并单独保护。验证有效权限时需同时检查父目录的删除子项能力，防止子目录被移除或替换。发布新版本时在受保护的父目录下创建新的版本目录并验签。 [权限继承](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights) · [删除与重命名权限](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-deletefilew)

`apply`、`inspect` 和 `rollback` 由具备写入安装状态及锁文件权限的操作员执行。确认回执中的可执行文件后，使用日常账号启动。现有安装工具以便携目录为入口，正式部署仍需用独立的安装与日常账号实测有效权限、新旧正式版本切换、回滚和操作系统签名。

### 日常账号只读启动定位

日常账号可用 `resolve-launch` 核验当前活动版本，取得 `Shenyi.exe` 的绝对路径。先由操作员准备可信脚本和 Node 运行环境，保护安装状态、程序目录和独立取得的验签公钥，并为客户端配置已核对的团队服务。日常账号需要读取和执行权限，用户资料仍保存在独立可写目录。以下是旧版便携演练参数，双签名候选另传 [发布者指纹](#双签名便携安装)。

```powershell
$receipt = node scripts/manage-windows-candidate-install.mjs resolve-launch `
  --root 'D:/shenyi-local-install' --public-key 'D:/trusted-config/update-ed25519.pub.pem'
if ($LASTEXITCODE -ne 0) { throw '无法核验已安装的审易版本。' }
$active = ConvertFrom-Json -InputObject ($receipt -join "`n")
& $active.executablePath
```

定位过程读取完整的签名和文件清单，并在输出前再次核对安装状态。当前存在安装锁或核验期间状态被替换时，请等操作员完成安装或回滚后重新定位。回执只对应本次核验时的活动版本。操作员仍用 `inspect` 获取带锁检查结果。

### 直接启动已验签版本

日常启动入口可调用 `launch`。由操作员在安装目录之外提供团队服务配置，固定受信的 Node 运行环境、启动工具和验签公钥，再用日常账号执行。以下是旧版便携演练参数，双签名候选另传 [发布者指纹](#双签名便携安装)。

```powershell
node scripts/manage-windows-candidate-install.mjs launch `
  --root 'D:/shenyi-local-install' `
  --public-key 'D:/trusted-config/update-ed25519.pub.pem' `
  --service-config 'D:/trusted-config/team-service.json'
```

命令只读核对当前版本后直接启动安装包中的 `Shenyi.exe`。回执中的 `pid` 表示 Windows 已创建进程。窗口就绪、服务身份和设备登录由客户端继续核验。开始 `apply` 或 `rollback` 前，请关闭本次安装启动的客户端。切换后再从同一入口启动，有效的用户资料与设备绑定继续使用原位置。

客户端保留当前 Windows 用户的资料目录和公开微信应用配置。启动入口清除调试、预览、代理和 TLS 配置覆盖，发现关闭 TLS 校验的设置时拒绝启动。只有明确配置为 `https://127.0.0.1` 的本地演练可以继承绝对路径指定的额外测试 CA。公网部署使用正式证书。

M7S 在独立 Windows 安装中依次启动 `0.61.0`、签名演练版 `0.61.1` 和回滚后的 `0.61.0`。演练版包含已修复的采集界面和独立版本元数据。三个真实窗口均完成合成实习生登录，只显示获指派的任务。设备只在首次登录登记，升级与回滚后继续使用原密钥。回滚后的最高已接受版本仍为 `0.61.1`。此次使用测试发布签名和合成配置，正式版本更新与操作系统签名另按发行要求实测。

### 为已安装的双签名版本创建快捷方式

部署人员准备由其维护、普通用户可读和执行的启动工具、Node.js 24.15 或较新的 24.x 运行时、安装目录和独立信任配置。启动工具须保留仓库的相对目录结构。微信扫码配置使用受信团队服务的版本 2 配置文件。使用可信发布渠道交付的启动脚本，沿用终端的 PowerShell 执行策略。先按[双签名便携安装](#双签名便携安装)激活相应版本，再在指定的新位置生成 `.lnk`。 [团队 HTTPS 配置](TRUSTED_TEAM_HTTPS_CONTRACT.md)

```powershell
& 'D:/ShenyiDeploy/scripts/start-windows-managed-desktop.ps1' `
  -NodePath 'D:/ShenyiRuntime/node.exe' `
  -InstallationRoot 'D:/ShenyiInstall' `
  -PublicKey 'D:/ShenyiTrust/update-ed25519.pub.pem' `
  -PublisherSha256 $ShenyiPublisherSha256 `
  -ServiceConfig 'D:/ShenyiTrust/team-service.json' `
  -ShortcutPath 'D:/ShenyiShortcuts/Shenyi.lnk'
```

将 `$ShenyiPublisherSha256` 设为经独立确认的发布者证书 SHA-256 指纹。快捷方式写入前会读回核对目标和参数，保留已有同名文件。点击快捷方式后，系统 PowerShell 先清理继承的 Node、Electron、服务配置、代理及证书覆盖，再调用现有 `launch` 核验并启动活动版本。签名或配置检查失败时，界面提示联系部署人员。安装后的更新和回滚沿用同一快捷方式。创建命令只写指定 `.lnk`，快捷方式实际放置及目录权限由部署人员配置。 [Windows 快捷方式说明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/admin-development/create-desktop-shortcut-with-wsh)

命令行排查时省略 `-ShortcutPath` 可直接运行启动检查，查看原有 JSON 结果。进程创建回执之后仍须核对产品窗口、服务身份与实际登录。此快捷方式接入受管双签名发行路径，MSI 安装注册及正式签名产品的实机走查另行留证。
