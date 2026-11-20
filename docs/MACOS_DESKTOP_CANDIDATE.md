# 审易 macOS 桌面候选

候选归档分别面向 Apple 芯片 `arm64` 和 Intel `x64`，当前锁定的 Electron 需要 macOS 13 或更新版本。两份构件使用同一份审易客户端源码与生产依赖清单。产物用于后续在 Mac 上签名并验收。 [Electron macOS 支持范围](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support)

## 2026-11-19 当前候选交接

Apple 芯片与 Intel 的 0.61.0 原 ZIP 与 Windows 评审客户端均基于 `418250f`。本轮 Mac 签前交接包位于 `D:/codex-temp/shenyi-m7-macos-parity-20261119/handoff/Shenyi-macOS-Candidate-Handoff-0.61.0.zip`。选择对应架构目录的原 ZIP 与清单，交接包内的 README 和 SHA256SUMS.txt 可独立使用。证据见 `D:/codex-temp/shenyi-m7-macos-parity-20261119/verification.json`。

接收方可从解压包根目录运行 `python3 -I ./tools/build-macos-desktop-archive.py --verify`，按 README 明确给出原 ZIP、架构和版本。获准发行人员另行签发候选签名后，可从同一目录运行 `node ./tools/macos-candidate-signature.mjs verify`。需要从可信渠道独立取得发布公钥。在空接收路径实测这两类工具可直接运行。

当前候选尚待 Apple Developer ID 签名、公证及实际 Mac 验收。签前演练的一次性密钥仅用于测试，签名及测试公钥保存在交接包外。已经接受 0.61.0 的环境必须使用更高经批准版本完成升级。较早的 4bc11ab 归档与证据保存在原 M7AV 检查点。

## 构建候选

签名前的发行候选从记录的提交构建。可将该提交的 `git archive` 解到独立目录，在该目录按锁文件准备桌面构建依赖。若使用现有工作区，先逐文件核对构建清单中的实际字节和 Git 中的源文件。Git 会归一化文本换行符，签名前应用摘要按归档中的实际字节计算。

在仓库根目录使用 Node 24.15 或更高版本的 24.x、npm 和 Python 3.10 或更新版本。用 `npm --prefix desktop ci --ignore-scripts` 按桌面锁文件准备构建工具和 Electron 校验值。在仓库外准备包含根仓库生产依赖的 npm 缓存。输出目录尚未创建，上一级实际目录已存在并支持硬链接。ZIP 与清单均发布后，该目录才是完整候选。

```powershell
node scripts/build-macos-desktop-candidate.mjs --arch arm64 --electron-archive 'D:/deploy/electron-v45.3.2-darwin-arm64.zip' --npm-cache 'D:/deploy/npm-cache' --output 'D:/deploy/shenyi-macos-arm64'
node scripts/build-macos-desktop-candidate.mjs --arch x64 --electron-archive 'D:/deploy/electron-v45.3.2-darwin-x64.zip' --npm-cache 'D:/deploy/npm-cache' --output 'D:/deploy/shenyi-macos-x64'
```

构建前校验锁定的官方 Electron ZIP。归档内保留框架、许可证、执行位及相对符号链接。在 ZIP 中替换默认 Electron 应用资源，按候选包名设置主程序和 helper 的可执行文件及 plist。输出包含 `Shenyi.app` 的 ZIP 和 `candidate-manifest.json`。清单记录目标架构、版本和两层归档的 SHA-256。交接先进行下文的离线签名与验签。Windows 可生成归档，请直接传输原 ZIP，以保留 Mac 框架的符号链接和权限。 [Electron v45.3.2 官方构件](https://github.com/electron/electron/releases/tag/v45.3.2) · [Electron 手工打包](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)

## 离线签名与交接

签名和验签都在仓库根目录执行，使用前述 Node 与 Python 版本。Windows 的 `python` 或 macOS 的 `python3` 须可从命令行调用。发布人员用独立保管的 Ed25519 PKCS#8 PEM 私钥分别签署两种架构的候选。候选目录只放原 ZIP 和清单。私钥和独立签名使用候选目录与仓库之外的绝对路径，签名输出须尚未创建。

```powershell
foreach ($arch in 'arm64', 'x64') {
  node scripts/macos-candidate-signature.mjs sign `
    --bundle "D:/deploy/shenyi-macos-$arch" --arch $arch `
    --signature "D:/deploy/shenyi-macos-$arch.sig" `
    --private-key 'D:/publisher-private/update-ed25519.pem'
  if ($LASTEXITCODE -ne 0) { throw "macOS $arch 候选签名失败" }
}
```

发布方在传输前用 `verify` 和构建机的绝对路径复验候选，交付对应架构的原 ZIP、`candidate-manifest.json` 和独立 `.sig` 文件。接收方从可信渠道独立取得 SPKI PEM 发布公钥，在解包前再次验签。验签核对清单签名、架构、ZIP 的大小和 SHA-256，以及归档结构。`--installed-version` 使用本机已接受版本的可信记录。无既有版本时传 `0.0.0`，以下用 `0.60.0` 演示。候选版本必须更高。验签失败时停止传输或解包。

```sh
(
  for arch in arm64 x64; do
    node scripts/macos-candidate-signature.mjs verify \
      --bundle "/Volumes/ShenyiRelease/shenyi-macos-$arch" --arch "$arch" \
      --signature "/Volumes/ShenyiRelease/shenyi-macos-$arch.sig" \
      --public-key '/Users/release/trusted-config/update-ed25519.pub.pem' \
      --installed-version '0.60.0' || exit 1
  done
)
```

验签通过后，在对应架构的 Mac 解包。Ed25519 签名保护交接件的来源和完整性。候选尚需取得 Apple Developer ID 签名和公证，并按下节进行 Gatekeeper、Keychain 和运行架构的 Mac 实机验收。

## 从 Finder 启动已配置客户端

已打包的 macOS 客户端从 `/Library/Application Support/ShenyiTeamDesktop/team-service.json` 读取由管理员部署的团队服务配置。基础配置包含配置版本、HTTPS 源地址和实例 UUID。启用受管微信时，使用版本 2 写入已批准的公开 AppID。若同时启用官网订单，使用[版本 4 受信配置](TRUSTED_TEAM_HTTPS_CONTRACT.md#同时启用微信与官网订单的版本-4-配置)，并填写独立的官网 origin。部署人员先核对源地址和实例，使用受控且无凭据的 JSON 文件。系统配置目录由 `root:wheel` 持有，权限为 `0755`，配置文件同属 `root:wheel`，权限为 `0644`。 [Apple 应用支持文件位置说明](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPFileSystem/Articles/WhereToPutFiles.html)

首次部署时，由管理员替换示例中的源路径后运行。示例只创建审易专用目录及其配置文件。Apple 系统父目录沿用机器原有权限。普通运行账号对系统父目录、审易专用目录和配置文件均须无实际写权限，包括通过 ACL 获得的权限。

```sh
(
  set -eu
  source='/Users/release/approved/team-service.json'
  support='/Library/Application Support'
  target="$support/ShenyiTeamDesktop"
  if [ ! -f "$source" ] || [ -L "$source" ] || [ ! -d "$support" ] || [ -L "$support" ]; then
    printf '%s\n' '请检查配置源文件和系统支持目录。' >&2
    exit 1
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    printf '%s\n' '审易系统配置目录已存在，请由管理员核对。' >&2
    exit 1
  fi
  sudo /usr/bin/install -d -o root -g wheel -m 0755 "$target"
  sudo /usr/bin/install -o root -g wheel -m 0644 "$source" "$target/team-service.json"
  /usr/bin/stat -f '%Su:%Sg %Sp %N' "$target" "$target/team-service.json"
)
```

部署后，普通用户直接在 Finder 双击 `Shenyi.app`。已存在专用目录时，客户端只接受该目录中的合格配置。若目录或文件权限不安全、配置损坏或文件缺失，客户端会显示原生提示并在连接服务前退出。系统模式使用正常 TLS 校验，拒绝禁用校验或从环境变量覆盖证书信任。调整既有配置时，由管理员核对服务身份、权限和文件内容。

仅在可信系统父目录下尚未创建审易专用目录的测试 Mac，可通过终端显式指定合成服务配置。该入口用于独立本机测试。

```sh
SHENYI_TEAM_SERVICE_CONFIG='/Users/release/test/team-service.json' \
  '/Users/release/test/Shenyi.app/Contents/MacOS/Shenyi'
```

配置加载逻辑已在 Windows 测试。Finder、Gatekeeper 与 Keychain 仍须在 Mac 上验收。

## 正式 ZIP 接收与签名核验

发行人员先将候选包里的 Electron 许可及第三方 notices 放入 `Shenyi.app`，把主应用及各个 Shenyi Helper 的标识改为本次正式标识，再签名、公证并将票据装订到应用。用 Mac 的 `ditto -c -k --sequesterRsrc --keepParent` 将最终应用归档为 ZIP。最终归档包含 `Shenyi.app` 和可选的 `__MACOSX` 附带元数据，发行记录单独提供 ZIP 的 SHA-256、Team ID、Bundle ID、版本与架构。 [Apple ZIP 分发](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution) · [Apple 票据装订与重新打包](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

签名前用获准源码对应的原候选生成归档回执。使用 Python 3.10 或更新版本，`$approved_candidate_zip` 使用实际 ZIP 的绝对路径。

```sh
python3 -I scripts/build-macos-desktop-archive.py --verify "$approved_candidate_zip" "$arch" "$version" \
  > "$candidate_receipt_file"
```

命令成功后，核对回执的 `archiveSha256` 等于独立取得的获准候选 ZIP 摘要。将 `appPayloadSha256` 连同源码提交、候选 ZIP 摘要、版本和架构记录于同一份发行批准记录。接收方从该记录取应用负载摘要，另取获准正式 ZIP 的最终摘要，运行跨平台只读核对。

```sh
python3 -I scripts/build-macos-desktop-archive.py --verify-release "$release_zip" "$arch" "$version" \
  --bundle-id "$bundle_id" --sha256 "$approved_sha256" \
  --app-payload-sha256 "$approved_app_payload_sha256"
```

工具核对受信摘要、包内路径与符号链接、版本和正式 Bundle ID、主程序及配套组件的 Mach-O 架构，并完整读取归档成员核验 CRC。应用负载摘要覆盖 `Shenyi.app/Contents/Resources/app/` 内的每份普通文件，包括相对路径、权限位、字节数和内容。签名可更新此目录之外的发行元数据。若应用负载摘要不匹配，接收方应停止验收，核对所用候选和签名流程。

在 Mac 上，把 `check-macos-release-zip.mjs`、`check-macos-release-app.mjs` 和 `build-macos-desktop-archive.py` 放在同一工具目录。从可信安装中取得 Python 的绝对路径，并用 Node 24.15 或更高的 24.x 执行。

```sh
node scripts/check-macos-release-zip.mjs \
  --archive "$release_zip" --sha256 "$approved_sha256" --python "$trusted_python" \
  --app-payload-sha256 "$approved_app_payload_sha256" \
  --team-id "$team_id" --bundle-id "$bundle_id" --version "$version" --arch "$arch" \
  > "$receipt_file"
```

该入口将受信 ZIP 的字节复制到私有临时目录，核对结构后用 macOS `ditto` 解包，对生成的应用检查 Developer ID、Gatekeeper 和公证票据。完整回执同时记录 ZIP 摘要、签名前应用负载摘要匹配结果、应用签名及应用树摘要。核验会清理临时副本，应用启动、下载安装、Keychain 和升级仍在正式实机流程中留证。

## 已签名应用的只读核验

已解包的应用可独立复查 Developer ID 签名、公证和票据。用受支持的 Mac 和 Node.js 24.15 或更新的 24.x 运行下列命令。把示例参数替换为该次发行记录中的值。核验期间保持应用目录静置。票据核验使用该 Mac 上的 Xcode 命令行工具。 [Apple 签名身份说明](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/) · [Apple 公证与票据装订流程](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)

```sh
node scripts/check-macos-release-app.mjs \
  --app '/Users/release/verified/Shenyi.app' \
  --team-id 'A1B2C3D4E5' --bundle-id 'cn.example.shenyi' \
  --version '0.61.0' --arch 'arm64' > '/Users/release/verified/app-check.json'
```

命令核对 `Info.plist` 的两个版本字段和主程序 Mach-O，递归严格验签，并用 Apple 证书链和独立提供的发行身份约束核对外层签名。它要求 Hardened Runtime 和安全时间戳，检查验收机启用了 Gatekeeper。macOS 14 及以后使用 `syspolicy_check distribution`，macOS 13 使用 `spctl` 的执行评估。还会独立校验应用的附带票据。 [Apple 签名验证说明](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html) · [Apple 公证测试说明](https://developer.apple.com/forums/thread/130560)

完整通过后，命令退出码为 0，标准输出包含本机评估方式、主程序架构、签名摘要、时间戳和应用树摘要。应用树摘要覆盖普通文件内容、相对路径、权限和符号链接目标，链接须解析到应用内部。任一失败返回非零，并在标准错误中记录失败代码。最终 ZIP 的字节和签名交接、Framework 和 Helper 架构，以及下面的真实 Finder、Keychain 和升级测试分别留证。

## Mac 实机验收

1. 在获准的 Mac 上按[离线签名与交接](#离线签名与交接)验签。使用 macOS 的归档工具或 `ditto -x -k` 解包到独立测试目录。
2. 由有权限的人员按 Apple 的嵌套代码顺序签名，再核验 `codesign --verify --deep --strict --verbose=2 Shenyi.app`。发行版还须使用 Developer ID、Hardened Runtime 和公证票据，并在 Mac 上用 Gatekeeper 检查最终分发构件。上游 Electron 保留的签名字段和候选 SHA-256 均不构成审易发行签名。候选产品 ID 为 `invalid.shenyi.audit.candidate`，正式产品 ID 和发行证书应在签名阶段确认。 [Apple 签名指南](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac) · [Apple 公证指南](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution/)
3. 管理员按「从 Finder 启动已配置客户端」配置独立合成团队服务，使用能通过客户端默认 TLS 验证的证书。用普通 macOS 测试账号在 Finder 打开已签名的应用，核对有效配置下可连接。另在独立测试环境核对缺少配置、路径权限不安全或文件损坏时的原生提示，以及错误实例或不可信证书时拒绝进入团队业务。
4. 使用测试账号登录并绑定设备，退出重开后核对公钥指纹和登录流程。核验 Keychain 访问失败时的界面，检查浏览器会话和设备密钥分别写入 `~/Library/Application Support/ShenyiTeamDesktop` 下的 `profile` 和 `device-vault`，旧预览目录无新写入。 [Electron safeStorage](https://github.com/electron/electron/blob/v45.3.2/docs/api/safe-storage.md)
5. 验收一条资料采集流程，核对原件哈希、设备撤销、安装升级和退出。Apple 芯片及 Intel 要分别记录 Finder 启动、运行架构、签名、Keychain、系统文件选择和持久状态。正式升级路径待安装包确定后实测。
