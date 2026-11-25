# 开发、运行与测试

协作开发先从 [当前双人交接](COLLABORATION_HANDOFF.md) 确认应取的分支。GitHub 的默认分支为 `main`。

## 1. 环境和首次准备

- Windows 或 macOS，Node.js 24.x（至少 24.15，建议团队使用同一小版本）。协作候选在 Windows Node 24.22.1 复验。
- Git / GitHub Desktop；浏览器先使用当前版本 Chrome 或 Edge。Safari 需要独立实机验收，不能以 Chromium 回归代替。
- 克隆私有仓库需要被邀请的个人 GitHub 账号。不要把仓库下载到放客户账套的目录。

```sh
git clone --branch codex/team-collaboration-handoff-20261120 https://github.com/icesad/shenyi-audit-workspace.git
cd shenyi-audit-workspace
npm ci --ignore-scripts
npm run dev
```

打开 `http://127.0.0.1:8773/`。`Ctrl+C` 停止本次启动的服务。首次装依赖需要联网，以后静态前端可本机运行。两台电脑各自执行 `npm ci --ignore-scripts` 安装锁定的依赖。

端口被占用时先确认是不是自己此前启动的服务，不要随意结束不认识的进程，也不要自动改端口。已有业务资料与浏览器 origin 绑定：`localhost`、`127.0.0.1`、不同端口、file地址、线上站点分别使用不同数据区。

## 保留旧审核预览的独立候选

用户已要求保留旧窗口时，使用根目录 `Start-Team-Candidate-Preview.cmd` 查看当前分支。该入口为每次新建的合成环境自动选择独立loopback端口，不改变原8773／8774入口或其数据；正常桌面设备签名和业务授权仍生效。账号、目录、关闭行为及Mac限制见[独立候选预览](ISOLATED_CANDIDATE_PREVIEW.md)。请勿重启原审核入口或向候选导入真实客户资料。

## 合成团队库离线恢复演练

`scripts/team-database-backup.mjs`提供`create`、`verify`、`rehearse`三项运维CLI，详见[操作与安全边界](TEAM_OFFLINE_BACKUP.md)。仅使用本次获准的另建合成库，不选择保留中的两份预览；每次新建目录，恢复结果不启动服务。备份含凭据且未加密，不能当普通员工导出或生产切换。

## 2. 测试命令

```sh
npm run check:repo
npm run test:unit
npm test
```

- `check:repo`：仓库文件范围/常见秘密模式的防误传检查，不是完整安全审计。
- `test:unit`：按文件排除提到 Playwright 的应用测试，再以严格模式运行剩余业务测试和工具测试。选中的 Windows 专属用例在 Windows x64 上执行。
- `npm test`：所有 `*.test.cjs`，并发为1，缺浏览器/本机原件的测试可能跳过；结果必须同时报告跳过数。
- `npm run test:strict`：所选测试有任何跳过就失败，不能把跳过包装成通过。
- `npm run test:tools`：只验证新增协作工具，不证明业务软件正确。

GitHub Actions 的 `unit` 任务使用 Windows x64、Node 24.22.1 和 Python 3.12，执行仓库检查和严格单元回归。Ubuntu 的 `tools` 任务执行仓库与跨平台工具检查。两处都按锁文件安装依赖。Windows 本地可将 `TEMP` 和 `TMP` 设置为已存在的 D 盘短路径，合成文件夹具会在临时目录中创建。

浏览器回归前安装项目锁定版本的 Chromium：

```sh
npx playwright install chromium
npm test
```

开发者可设置 `QUOTE_LEDGER_CHROMIUM_EXECUTABLE` 指向本机获准浏览器；runner 默认优先使用已安装的 Playwright Chromium，未安装则保留各专项原有提示。不要把 Windows Edge 的绝对路径照搬到 Mac。

将配套浏览器放在D盘或其他自定义缓存目录时，安装和测试必须使用相同的 `PLAYWRIGHT_BROWSERS_PATH`。例如在PowerShell中：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "D:/dev-cache/playwright"
node node_modules/playwright/cli.js install chromium
node scripts/test.mjs --strict
```

部分历史专项直接调用 `chromium.executablePath()`，只设置 `QUOTE_LEDGER_CHROMIUM_EXECUTABLE` 不足以满足它们；保留这些专项原断言，使用锁定依赖匹配的配套浏览器。`SHENYI_MATERIAL_PRESERVATION_NATIVE_ZIP` 必须指向实际原生流程已保存、且能核对来源与SHA的合成资料v2包；`CONCLUSION_STAGE_ZIP` 必须是固定身份的授权原始结论包。缺少这些输入时严格门仍未通过，不以其他ZIP或跳过结果替代。

某些原件身份测试需要仓库外的用户授权 ZIP，如 `CONCLUSION_STAGE_ZIP`。不要为了消除 SKIP 把真实原件提交到仓库。历史 `tests/browser/*-smoke.cjs` 是另行执行的 smoke，不会因为名字不是 `*.test.cjs` 而自动纳入全量 runner。

## 3. 目录规则

**平铺 `dist/` 是应用源码，不是可以删除的编译目录。**只有 `dist/client/`、`dist/server/`、`dist/.openai/` 是平台构建生成物。

```text
dist/                  前端源码、本机解析器、模板布局与许可证
tests/                 合成回归及历史 smoke（无客户业务原件）
scripts/               跨设备静态服务和测试入口
docs/                  架构、协作、入门、组件来源与限制
server/                账号资料服务代码
hosting-server/        原 Sites 服务器源码；部署单独配置
.github/               Issue/PR 模板、代码审查人和CI
```

## 4. 云端构建不是本地运行

根 `npm run build` 仍调用原 `hosting-server/scripts/build-root.mjs`。它需要部署负责人的 Sites 项目绑定、D1配置和 `hosting-server` 独立依赖；新 clone 不包含真实 `.openai/hosting.json`，因此**不能直接发布原站点**。

示例仅见 `config/hosting.example.json`。负责人按正式发布工具在本机配置两个真实 manifest；这些文件已忽略，不进入 Git。不要把占位 ID 当真实配置，也不要复制别人的部署凭证。

本轮只建立 GitHub 协作，不更换生产站点、不启用自动部署、不迁移客户资料。发布需记录环境、commit、构建/测试、权限与回滚方案，参见 STATUS。

## 5. 开发中的数据安全

新页面/新存储逻辑先用独立测试浏览器上下文和合成项目。不要在有真实资料的浏览器里跑破坏性回归。编辑业务代码前先确认 Issue 范围；保存、核对、冻结、登记、导出是不同动作，不能因为按钮改名而改变其语义。
