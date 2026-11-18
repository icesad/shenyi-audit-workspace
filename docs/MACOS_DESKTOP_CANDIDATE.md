# 审易 macOS 桌面候选

候选归档分别面向 Apple 芯片 `arm64` 和 Intel `x64`，当前锁定的 Electron 需要 macOS 13 或更新版本。两份构件使用同一份审易客户端源码与生产依赖清单。产物用于后续在 Mac 上签名并验收。 [Electron macOS 支持范围](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support)

## 构建候选

在仓库根目录使用 Node 24.15 或更高版本的 24.x、npm 和 Python 3.10 或更新版本。用 `npm --prefix desktop ci --ignore-scripts` 按桌面锁文件准备构建工具和 Electron 校验值。在仓库外准备包含根仓库生产依赖的 npm 缓存。输出目录尚未创建，上一级实际目录已存在并支持硬链接。ZIP 与清单均发布后，该目录才是完整候选。

```powershell
node scripts/build-macos-desktop-candidate.mjs --arch arm64 --electron-archive 'D:/deploy/electron-v45.3.2-darwin-arm64.zip' --npm-cache 'D:/deploy/npm-cache' --output 'D:/deploy/shenyi-macos-arm64'
node scripts/build-macos-desktop-candidate.mjs --arch x64 --electron-archive 'D:/deploy/electron-v45.3.2-darwin-x64.zip' --npm-cache 'D:/deploy/npm-cache' --output 'D:/deploy/shenyi-macos-x64'
```

构建前校验锁定的官方 Electron ZIP。归档内保留框架、许可证、执行位及相对符号链接。在 ZIP 中替换默认 Electron 应用资源，按候选包名设置主程序和 helper 的可执行文件及 plist。输出包含 `Shenyi.app` 的 ZIP 和 `candidate-manifest.json`。清单记录目标架构、版本和两层归档的 SHA-256。交接时以可信来源的清单核对 ZIP 摘要。Windows 可生成归档，避免在 Windows 解包后重新压缩，以保留 Mac 框架的符号链接和权限。 [Electron v45.3.2 官方构件](https://github.com/electron/electron/releases/tag/v45.3.2) · [Electron 手工打包](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)

## Mac 实机验收

1. 在获准的 Mac 上核对 ZIP 摘要。使用 macOS 的归档工具或 `ditto -x -k` 解包到独立测试目录。
2. 由有权限的人员按 Apple 的嵌套代码顺序签名，再核验 `codesign --verify --deep --strict --verbose=2 Shenyi.app`。发行版还须使用 Developer ID、Hardened Runtime 和公证票据，按最终分发构件核验。上游 Electron 保留的签名字段和候选 SHA-256 均不构成审易发行签名。候选产品 ID 为 `invalid.shenyi.audit.candidate`，正式产品 ID 和发行证书应在签名阶段确认。 [Apple 签名指南](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac) · [Apple 公证指南](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution/)
3. 准备独立合成团队服务，将其 HTTPS origin 和实例 UUID 写入包外的[可信服务配置](TRUSTED_TEAM_HTTPS_CONTRACT.md)。使用受信任的 TLS 证书，随后用绝对路径启动已签名的主程序。包内不放服务配置、账号或密钥。

```sh
SHENYI_TEAM_SERVICE_CONFIG="/absolute/path/team-service.json" \
  "/absolute/path/Shenyi.app/Contents/MacOS/Shenyi"
```

4. 核验缺少配置、错误实例或不可信证书时拒绝进入团队业务。使用测试账号登录并绑定设备，退出重开后核对公钥指纹和登录流程。核验 Keychain 访问失败时的界面，检查浏览器会话和设备密钥分别写入 `~/Library/Application Support/ShenyiTeamDesktop` 下的 `profile` 和 `device-vault`，旧预览目录无新写入。测试时使用独立 macOS 用户。 [Electron safeStorage](https://github.com/electron/electron/blob/v45.3.2/docs/api/safe-storage.md)
5. 验收一条资料采集流程，核对原件哈希、设备撤销、安装升级和退出。Apple 芯片及 Intel 要分别记录运行架构、签名、Keychain、系统文件选择和持久状态。Finder 启动与正式升级路径待安装包确定后实测。
