# 审易双人开发交接

更新于 2026-11-20。两位开发者从下面的协作分支各开任务分支。协作基线包含团队客户端、服务端和官网。本轮交接纳入截至 `2b4b825` 的功能及验证记录，历史四来源报告单独验收。

| 项目 | 当前交接点 |
| --- | --- |
| 仓库 | 私有的 [icesad/shenyi-audit-workspace](https://github.com/icesad/shenyi-audit-workspace) |
| 本阶段协作基线 | [`codex/team-collaboration-handoff-20261120`](https://github.com/icesad/shenyi-audit-workspace/tree/codex/team-collaboration-handoff-20261120) |
| 本轮源码和验收记录截至 | [`2b4b825`](https://github.com/icesad/shenyi-audit-workspace/commit/2b4b8255034c9f977ad8d8d19f12240a96b78e52)，交接文档随分支继续更新 |
| 当前收款候选 | 官网报价、锁单、扫码付款、查单与超时关单。Windows 客户端可打开或继续官网购买。各阶段提交和实际验收范围见下文。 |
| 米老师的 GitHub 账号 | `mixue117`，已核对具有本仓库读写权限 |
| 历史四来源报告 | `work/report-four-sources`，仍在草稿 PR #2，等待业务验收。 [查看草稿](https://github.com/icesad/shenyi-audit-workspace/pull/2) |

协作分支承接团队应用和产品官网的评审候选。产品负责人核对远端提交后，以快进方式更新这条基线。两人的任务 PR 都先进入协作分支。本次候选待合入 `main` 和发布验收。

## 分工和第一件事

- **米老师**负责审计流程、原表格式、底稿及报告规则。已有业务代码时，可以直接交接一笔具体修改。先保存在原目录或原工作分支，并记录该版本的提交号、修改目录、演示步骤与合成样例；再把选定提交或文件差异整理到从协作基线新建的业务分支，逐项核对。旧开发目录留作备份，避免整目录覆盖协作克隆。若手头版本的基线还不清楚，先在 Issue 记录可识别的版本和涉及文件，双方核对后再导入。
- **产品负责人**负责桌面易用性、组织和项目权限、账号与设备、订阅席位、官网及上线，负责技术验收与版本集成。接到业务分支后，先核对共同改动的入口、项目权限和数据兼容，再复跑对应工作流。收款上线目前还要确认正式价格目录和商户配置。 [支付接入说明](PAYMENT_CHANNEL_PREPARATION.md)
- 业务跨到权限、存储或界面时，两人先在 Issue 约定改动的文件、接口和验收人。底稿的专业复核、新冻结和重开规则由米老师确认。 [底稿三权与业务边界](WORKPAPER_ACCESS_CONTRACT.md)

四来源报告的历史草稿位于 `work/report-four-sources@894078b`。米老师可在 PR #2 复核四类来源、底稿填写、草稿保存和 Word 导出。选择要保留的历史改动后，在 Issue 写明采用的提交、业务规则和验收样例，再从协作基线开独立集成分支提交新 PR。米老师签收业务结果，产品负责人核对现有立项、账表、权限及底稿入口的回归。 [历史草稿 PR #2](https://github.com/icesad/shenyi-audit-workspace/pull/2) · [报告合并预演记录](STATUS.md#2026-11-20-历史报告草稿隔离合并预演)

## 把代码取到自己的电脑

**只看资料或反馈。** 用自己的 GitHub 账号登录，打开仓库，在分支选择器切到协作分支。可以直接浏览文件，或到 Issues 留下脱敏反馈。 [米老师操作步骤](GITHUB_BEGINNER_MI.md)

**用 GitHub Desktop 开发。** 初次点 **File → Clone Repository**，选择审易私有仓库。已克隆时先检查 **Changes**，把手头修改保存在原工作分支。点 **Fetch origin** 后，在 **Current Branch** 切换到协作分支。若显示 **Pull origin**，点一下取到最新提交。随后点 **New Branch**，用 Issue 编号命名自己的任务分支，例如 `work/mi-report-issue-123` 或 `work/product-billing-issue-123`。

**用终端克隆。** 在准备存放源码的开发目录运行以下命令。已有本地仓库时使用下方第二组命令。

```sh
git clone --branch codex/team-collaboration-handoff-20261120 https://github.com/icesad/shenyi-audit-workspace.git
cd shenyi-audit-workspace
```

```sh
git fetch origin
git switch --create codex/team-collaboration-handoff-20261120 --track origin/codex/team-collaboration-handoff-20261120
```

本地已有同名协作分支时，用 `git switch codex/team-collaboration-handoff-20261120` 和 `git pull --ff-only` 更新。切换前运行 `git status --short --branch`，先在原工作分支保存已有修改。如果无法快进，保留本地提交并请产品负责人一起核对。

**开自己的任务分支。** 下面以 Issue #123 作命令示例，实际使用项目中的 Issue 编号。

```sh
git fetch origin
git switch --no-track -c work/mi-report-issue-123 origin/codex/team-collaboration-handoff-20261120
```

产品方从同一远端分支建任务分支，使用自己的 Issue 编号和任务名称。两人各自在自己的分支完成开发。

## 本地运行和复验

需要 Node.js 24.15 或以上的 24.x。本次复验使用 Node.js 24.22.1。首次在仓库根目录安装固定依赖，再运行工作台预览。

```sh
node --version
npm ci --ignore-scripts
npm run dev
```

工作台在 `http://127.0.0.1:8773/`。官网静态预览可另外运行 `node scripts/website-preview.mjs`，Windows 也可双击 `Start-Website-Preview.cmd`。按终端输出打开本机地址，用 `Ctrl+C` 停止自己启动的服务。

在仓库根目录安装桌面依赖：

```sh
npm --prefix desktop ci --ignore-scripts
npm --prefix desktop run setup
```

Windows 随后可双击 `Start-Team-Candidate-Preview.cmd` 打开独立合成桌面。macOS 可在根目录运行 `node scripts/team-isolated-preview.mjs`，实机仍待验收。`Start-Team-Website-Checkout-Candidate.cmd` 用于合成订单演练。新版微信付款须使用独立受管 HTTPS 配置。原有审核预览继续保留，2026-11-20 的两个本机入口复查均返回 HTTP 200。共享库保全备份、隔离升级预演及实际共享库切换是不同验收项，实际切换仍待验。 [桌面依赖](../desktop/README.md#本机运行) · [开发环境](DEVELOPMENT.md) · [独立团队桌面预览](ISOLATED_CANDIDATE_PREVIEW.md) · [官网预览](../website/README.md)

开发者可从仓库根目录复跑项目检查和直接相关回归。

```sh
npm run check:repo
npm run test:tools
node --test tests/team-wechat-native-website.test.cjs tests/team-desktop-billing-ui.test.cjs
```

## 官网与微信支付进度

| 功能提交 | 可接续的功能和已验证范围 |
| --- | --- |
| `a114502` | 从短时授权打开已锁定原单，显式获取付款码和主动验签查单。通过本机受管 HTTPS 及 Chrome 桌面、移动尺寸验证。 |
| `8d74d72` | 官网选择席位、报价及确认锁单。续费核对已占席和邀请预留，期中增购在原到期日以内。通过合成目录和收款应答验证。 |
| `89648ca` | 从 Windows 桌面「订阅与席位」打开或继续本次购买、按编号打开原单。以本机受管 HTTPS 和实际 Electron 核对跨重启复用原单。签前便携候选另有实启记录。 |
| `27de470` | 到期未付款原单可显式请求关闭。已请求出码的订单按验签查询、关单和复查确认。覆盖本机合成应答及隔离账本迁移。 |
| `8ca7a91` | 按北京时间账单日申请、下载和核验普通商户 `ALL` 账单，只读核对订单和收款。463 项相关检查及独立复跑的 18 项检查通过，零失败或跳过。 |
| `021ad76` | 从该账单选定单笔退款，以本应用原单、可信收款和微信验签查询核对当前状态。合成环境中 474 项相关检查和 29 项独立复跑通过。真实退款执行、期限或席位处置仍待确认。 |

金额不符、缺单或退款等差异写入受控对账报告。真实商户账单、实际差异处置和退款执行仍待验收。拉取协作分支后，可按对账文件查看远端最新相关提交。 [支付接入与对账说明](PAYMENT_CHANNEL_PREPARATION.md#商户交易账单对账) · [阶段记录与测试证据](../进度.md)

```sh
git fetch origin
git log -1 --format="%H %s" origin/codex/team-collaboration-handoff-20261120 -- server/team/wechat-native-reconciliation.mjs
```

确认上述文件在当前检出的分支后，可复跑合成对账用例。

```sh
node --test tests/team-wechat-native-trade-bill-parser.test.cjs tests/team-wechat-native-reconciliation.test.cjs tests/team-wechat-native-reconciliation-cli.test.cjs
```

## 可用的验收基线与剩余事项

| 范围 | 已验证 | 待实际验收 |
| --- | --- | --- |
| Windows `e28ae2a` | 双人评审包一键运行合成订单。独立 `Shenyi.exe` 经受管 HTTPS 核对设备绑定、重启后恢复官网原单和权益到账。 | 正式签名 MSI 的安装、升级及回退。 |
| macOS `e28ae2a` | Apple 芯片和 Intel 两包均完成离线签前核验。 | Developer ID 签名、公证、Mac 实机安装、绑定和升级。 |
| Linux 验收记录 `2b4b825` | 隔离 Ubuntu 实测签名部署从 `e28ae2a` 切换至 `b53f334`，核对加密恢复，再回退原版。核对七张 Native 账本表和合成原件，恢复演练库按预期拒绝启动。 | 国内云生产配置、正式证书、真实商户及回调。 |
| 审计业务 | 已有历史报告预演和合成结果可复跑。 | 米老师确认采用的专业规则及合并范围，双方签收。实际共享库升级和获准资料试点单独安排。 |

签前构件、原开发机 `D:/codex-temp/` 下的验收日志与本机预览由原机保管。协作者从 GitHub 拉取源码、文档和合成测试，在各自环境重跑。 [详细验收记录](STATUS.md) · [macOS 接收步骤](MACOS_DESKTOP_CANDIDATE.md#2026-11-20-协作版本签前交接) · [Linux 发布和回退](LINUX_TEAM_DEPLOYMENT.md#重新启用已签版本)

生产价格目录、增购折算分母、订单时效和退款后权益处置由产品负责人确认。上线申请以已确认的上海企业同主体收款为基础，先核对域名和阿里云资源，再按属地手续与正式回执推进。 [上线申请与域名服务器步骤](LAUNCH_INITIAL_APPLICATION_PACKET.md) · [商业化路线图](COMMERCIALIZATION_ROADMAP.md)

## 提交、验收和合并

1. 在 Issue 写明操作入口、范围、期望结果、样例和验收人。开工后只提交本次约定的源码和文档。提交前运行直接相关测试，并用 `git status --short` 和 `git diff --cached --stat` 核对待提交文件。
2. 在自己的任务分支 Commit。用 GitHub Desktop 点 **Publish branch** 或 **Push origin**，也可在终端运行 `git push -u origin HEAD`。推送完成后在 GitHub 的分支选择器核对分支和提交号。
3. 建立 PR 时将 **base** 选为 `codex/team-collaboration-handoff-20261120`，将 **compare** 选为自己的任务分支。正文列出关联 Issue、改动范围、提交号、复现步骤、通过／失败／跳过及待验收项。涉及历史报告时附 PR #2 和采用的提交。
4. 米老师确认审计业务结果，产品负责人核对应用、权限及测试。出现冲突时保留双方修改，由了解对应模块的人核对预期后处理，再复跑受影响的流程。产品负责人汇总验收后集成。涉及专业规则、业务原件或旧库兼容时，附上双方可按同一版本复跑的验收步骤。

提交已有业务成果时，可把这段贴到 Issue 或自己的 PR。命令、文件和结果请填写实际值。

```text
关联 Issue：
原业务版本 / 提交号：
本次 PR 分支 / 提交号：
涉及模块和文件：
使用的合成样例及操作步骤：
预期与实际业务结果：
测试命令及通过 / 失败 / 跳过：
需要米老师与产品负责人分别确认的事项：
```

双方验收后，由产品负责人另开 PR 将获准的改动合入 `main`。云部署、正式签名、真实收款与资料迁移各自记录实际结果。

源码和文档随 Git 同步。客户账套、底稿原件、合同、浏览器业务数据、支付对账报告、密钥及本地数据库留在获准的专用环境。Issue、PR 和截图只使用合成样例或经准许的脱敏结果。 [两台电脑的交接步骤与数据范围](COLLABORATION.md)

| 需要继续查什么 | 从哪里开始 |
| --- | --- |
| 审计业务、角色和职责 | [团队产品需求](TEAM_PRODUCT_REQUIREMENTS.md) |
| 两人协作、换电脑、保护未提交修改 | [协作规则](COLLABORATION.md) |
| 当前功能、尚缺的实际验收 | [当前状态](STATUS.md) · [进度](../进度.md) |
| 上线流程、商户与双平台发布 | [商业化路线图](COMMERCIALIZATION_ROADMAP.md) |
| 需求、问题或提交说明 | [贡献约定](../CONTRIBUTING.md) |
