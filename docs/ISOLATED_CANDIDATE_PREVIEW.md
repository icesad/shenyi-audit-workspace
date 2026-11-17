# 独立合成候选预览

本入口用于保留已打开的旧审核预览，同时查看当前分支的正常团队桌面功能。它只创建合成环境；不是生产部署、客户资料迁移、安装包或原共享库升级。

## 启动与使用

Windows 双击根目录 `Start-Team-Candidate-Preview.cmd`。依赖沿用 `desktop/README.md` 的锁定 Electron 和 Node.js 24.15 以上 24.x；入口优先使用本机 Codex 的 Node24，找不到时才检查 PATH 中的 Node，版本不符会退出。macOS 开发命令为：

```sh
node scripts/team-isolated-preview.mjs
```

macOS 目前只有路径和配置逻辑，尚未完成原生实机验收。

窗口标题为“审易 · 独立合成候选预览 · 编号”，页内显示“独立候选预览”。合成账号 `manager-a`、`partner-a`、`intern-a`、`assistant-a`，密码 `ShenyiDemo!2026`。登录后仍须明确同意并验证密码登记电脑；职级、设备登记不自动扩充项目或模块权限。短信和微信未配置时仍关闭。

每次启动都是全新环境。关闭该候选窗口后，其服务和数据库连接停止，文件保留；本入口不提供续用某次候选目录的选项。请勿在其中存放真实客户资料，也不要把保留目录当作已完成的备份恢复功能。

## 隔离与失败规则

- Windows 管理根目录为 `D:/codex-temp/shenyi-team-isolated-preview`；macOS 为 `~/Library/Application Support/ShenyiIsolatedTeamPreview`。根目录须有准确的专用 marker，每次在其下创建新的 `candidate-UUID`。
- 各候选独立建立当前 schema 的合成 SQLite、动态 loopback 端口、服务 UUID、Electron userData 和 OS 保护的设备密钥目录。没有复制旧数据库、用户资料或旧 vault。两个候选可并存；同一候选配置的第二客户端受原有单实例锁约束。
- 新配置只在未打包客户端启用，限定规范的 `http://127.0.0.1` 高位端口，排除 8773、8774。它不修改默认固定地址拒绝逻辑或生产受信 HTTPS 校验。HTTP 与 UUID pin 仅用于本机合成开发，不能作为生产 TLS 身份证明。
- 正常 main、preload、renderer、窄 IPC、设备挑战签名和逐请求证明照常运行；renderer 不接收 token 或设备私钥。请求前仍做无凭据身份探测，并核对实际响应 URL、UUID、重定向和设备能力。身份不符时拒绝并清退当前业务会话。
- `candidate.json` 严格限制目录、文件类型、大小、UTF-8 和规范 JSON；拒绝路径跳转、已有 junction/symlink、未知字段、BOM、混合旧服务配置及 packaged 模式，失败不回落到旧服务。不能阻止有相同 OS 文件写权限的用户实时篡改全部程序和目录。
- launcher 仅清理自己创建的服务及捕获的子进程。子进程环境移除旧 `SHENYI_*`、已知 Node/Electron 调试与代理注入变量；不改变父进程环境、HOME、LOCALAPPDATA 或用户全局设置。启动异常明确失败；自己的目录和失败记录保留。

服务启动器在启动Electron前创建专用profile，并以受控的`--user-data-dir`参数让早期GPU／网络／页面进程也使用该目录；main再核对参数与派生目录完全相同。不能仅凭最终`app.getPath`判断早期缓存归属。绕过launcher仅设环境变量而漏传匹配CLI不受支持，会拒绝；不保证这种错误外部调用在拒绝前未触默认缓存。会话数据路径与初始化时序参照[Electron官方文档](https://www.electronjs.org/docs/latest/api/app#appsetpathname-path)。

新入口不接受服务器地址、资料目录或其他 CLI 参数。原 `Start-Team-Preview.cmd`、`Start-Team-Review-Preview.cmd` 及其端口、共享库、vault 解析规则保持原状。用户已选择保留旧预览，本项不关闭它、不升级实际共享库，也不重验两条原入口。

## 验收边界

相关测试位于 `tests/isolated-preview-*.test.cjs`。实际 Windows 正常 Electron、独立端口、DPAPI、并存、单实例和新 cmd 的结果见 `进度.md` 与 `docs/STATUS.md`；独立审查及原失败记录存放在仓库外 `D:/codex-temp/shenyi-isolated-preview-20261118/`。

本项不替代原始 ZIP 的完整严格门、真实 OS Open/Save、Mac、安装/更新、真实供应商、支付、客户或生产验收；M4 和完整商业化 Goal 继续进行。
