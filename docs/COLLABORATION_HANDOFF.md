# 审易双人开发交接

更新于 2026-11-20。适合产品负责人和米老师从同一套代码开始开发。

| 项目 | 当前交接点 |
| --- | --- |
| 仓库 | 私有的 [icesad/shenyi-audit-workspace](https://github.com/icesad/shenyi-audit-workspace) |
| 本阶段协作基线 | `codex/team-collaboration-handoff-20261120` |
| 本次交接的功能提交 | `589a0ed`，含微信支付 Native 锁单与收款账本 |
| 米老师的 GitHub 账号 | `mixue117`，已核对具有本仓库读写权限 |
| 历史四来源报告 | `work/report-four-sources`，仍在草稿 PR #2，等待业务验收。 [查看草稿](https://github.com/icesad/shenyi-audit-workspace/pull/2) |

协作基线承接原评审分支和本地支付阶段的已提交代码。产品发布基线继续采用 `main`。网页上的历史报告草稿、原评审分支和当前协作基线各有自己的 commit。拉取前先核对选中的分支。

## 分工和第一件事

- **米老师**负责审计流程、原表格式、底稿及报告规则。可以自己提交代码、写业务说明，也可以用网页给出操作步骤和验收结果。先从一项明确的报告或底稿业务规则开始，把预期、合成样例和验收条件写在同一条 Issue。
- **产品负责人**负责桌面体验、团队权限、设备、订阅席位、官网及上线。收款下一步是接年费和席位兑现，并验证重复回调或查单只生效一次。
- 若同一功能同时涉及业务和技术，两人先在 Issue 约定各改的文件和验收人，再分别从协作基线开分支。

四来源报告已有历史草稿。米老师可先对照 PR #2 复核报告草稿的四类来源、底稿填写和 Word 导出。准备接续这份草稿时，先在 Issue 记录拟采用的报告版本和本次要改的业务规则。需要汇合历史代码时，由双方验收后提交独立的集成 PR。

## 把代码取到自己的电脑

**只看资料或反馈。** 用自己的 GitHub 账号登录，打开仓库，在分支选择器切到 `codex/team-collaboration-handoff-20261120`。可以直接浏览文档或在 Issues 留下脱敏反馈。 [米老师操作步骤](GITHUB_BEGINNER_MI.md)

**用 GitHub Desktop 开发。** 首次用 **File → Clone Repository**，选择审易私有仓库。已有克隆时先检查 **Changes**，保存手头的修改，再点 **Fetch origin**。在 **Current Branch** 找到上述协作基线并切换。从该分支点 **New Branch** 建自己的任务分支，例如 `work/mi-report-issue-编号` 或 `work/product-billing-issue-编号`。

**用终端克隆。** 在准备存放源码的开发目录运行以下命令。已有本地仓库时使用下方第二组命令。

```sh
git clone --branch codex/team-collaboration-handoff-20261120 https://github.com/icesad/shenyi-audit-workspace.git
cd shenyi-audit-workspace
```

```sh
git fetch origin
git switch --create codex/team-collaboration-handoff-20261120 --track origin/codex/team-collaboration-handoff-20261120
```

本地已经有同名协作分支时，使用 `git switch codex/team-collaboration-handoff-20261120` 和 `git pull --ff-only`。开发前通过 `git status --short --branch` 核对分支和已有改动。

## 本地运行和复验

需要 Node.js 24.15 或以上的 24.x。本次复验使用 Node.js 24.22.1。首次在仓库根目录安装固定依赖，再运行工作台预览。

```sh
node --version
npm ci --ignore-scripts
npm run dev
```

工作台在 `http://127.0.0.1:8773/`。官网本地预览可另外运行 `node scripts/website-preview.mjs`，按终端输出打开本机地址。退出预览用 `Ctrl+C`。桌面端需安装独立 Electron 依赖，Windows 和 macOS 的启动方式以候选预览文档为准。 [开发环境](DEVELOPMENT.md) · [独立团队桌面预览](ISOLATED_CANDIDATE_PREVIEW.md) · [官网预览](../website/README.md)

开发者可从仓库根目录复跑本轮检查。

```sh
npm run check:repo
npm run test:tools
node --test tests/team-wechat-native-billing.test.cjs tests/team-wechat-native-orders.test.cjs tests/team-wechat-native-notification.test.cjs
```

功能提交 `589a0ed` 的历史验收为 624 项相关回归通过，独立复跑 33 项支付专项通过。已验证同一收款经回调和查单可去重，SQLite 关闭重开后能读回原记录。真实商户、官网正式付款、年费与席位兑现、生产对账和部署仍待验收。Windows 原评审包和报告预览有各自历史验收记录，macOS 安装与升级仍需实机复核。历史进度中的 `D:/codex-temp/` 记录由原开发电脑保存，对方可用本页命令复验共享源码。 [当前进度](../进度.md) · [支付接入说明](PAYMENT_CHANNEL_PREPARATION.md)

## 提交、验收和合并

1. 任务分支改好后运行直接相关测试。先用 `git status` 检查文件，再提交本任务的源码和文档。
2. 将自己的任务分支推到同一个私有仓库。建立 PR 时把 **base** 选为本阶段协作基线，把 **compare** 选为自己的任务分支。触及报告历史草稿时，在正文注明 PR #2 和采用的报告基线。
3. PR 写明关联 Issue、分支及提交号、实际改动、通过／失败／跳过项和需要对方核对的步骤。业务规则请米老师确认，产品和技术变更由产品负责人验收。验收后的集成由负责人处理。
4. 源码和文档随 Git 同步。客户账套、底稿原件、合同、浏览器业务数据、密钥及本地数据库留在获准的专用环境。用合成样例复现问题，只在 Issue 和 PR 留脱敏结果。

| 需要继续查什么 | 从哪里开始 |
| --- | --- |
| 审计业务、角色和职责 | [团队产品需求](TEAM_PRODUCT_REQUIREMENTS.md) |
| 两人协作、换电脑、保护未提交修改 | [协作规则](COLLABORATION.md) |
| 当前功能、尚缺的实际验收 | [当前状态](STATUS.md) · [进度](../进度.md) |
| 上线流程、商户与双平台发布 | [商业化路线图](COMMERCIALIZATION_ROADMAP.md) |
| 需求、问题或提交说明 | [贡献约定](../CONTRIBUTING.md) |
