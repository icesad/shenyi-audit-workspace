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

当前交付采用未签名的便携目录。后续验收还包括 Windows 签名和安装升级、macOS 原生构建及签名公证、独立更新验签、国内部署与备份恢复演练。
