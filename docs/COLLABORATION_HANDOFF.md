# 审易双人开发交接

更新于 2026-11-20。适合产品负责人和米老师从同一套代码开始开发。

| 项目 | 当前交接点 |
| --- | --- |
| 仓库 | 私有的 [icesad/shenyi-audit-workspace](https://github.com/icesad/shenyi-audit-workspace) |
| 本阶段协作基线 | `codex/team-collaboration-handoff-20261120` |
| 本次交接的功能提交 | `a114502`，含微信支付 Native 原单扫码、验签查单和权益兑现 |
| 米老师的 GitHub 账号 | `mixue117`，已核对具有本仓库读写权限 |
| 历史四来源报告 | `work/report-four-sources`，仍在草稿 PR #2，等待业务验收。 [查看草稿](https://github.com/icesad/shenyi-audit-workspace/pull/2) |

协作基线承接原评审候选，并纳入微信支付的锁单、可信收款账本、年费和席位兑现、HTTPS 回调及已锁定订单的官网付款。两位负责人在这条基线上集成开发，发布验收另走 `main`。

## 分工和第一件事

- **米老师**负责审计流程、原表格式、底稿及报告规则。先从一项报告或底稿业务规则开始，在 Issue 记录入口、预期、可分享的合成样例和验收条件。已经在自己电脑开发的业务代码可以单开分支提交，并在 PR 中写明原始基线、涉及的模块和需核对的结果。
- **产品负责人**负责桌面体验、团队权限、设备、订阅席位、官网及上线。收款侧下一项是接获准的正式报价和服务端锁单，再将桌面订单详情接到官网付款入口。正式商户和上线手续随实际条件推进。
- 若同一功能同时涉及业务和技术，两人先在 Issue 约定各改的文件和验收人，再分别从协作基线开分支。

四来源报告的历史草稿位于 `work/report-four-sources` 的 `894078b`。米老师可在 PR #2 复核四类来源、底稿填写和 Word 导出。若要接回历史代码，先在 Issue 记录采用的提交和业务规则，再从协作基线开独立集成分支，将选定改动纳入新 PR。由米老师核对业务结果，产品负责人核对集成及回归。 [历史草稿 PR #2](https://github.com/icesad/shenyi-audit-workspace/pull/2)

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

**开自己的任务分支。** 下面以 Issue #123 作命令示例，实际使用项目中的 Issue 编号。

```sh
git fetch origin
git switch --no-track -c work/mi-report-issue-123 origin/codex/team-collaboration-handoff-20261120
```

任务分支完成提交后运行 `git push -u origin HEAD`。使用 GitHub Desktop 时，点击 **Publish branch** 推送，再到 GitHub 建立 PR。

## 本地运行和复验

需要 Node.js 24.15 或以上的 24.x。本次复验使用 Node.js 24.22.1。首次在仓库根目录安装固定依赖，再运行工作台预览。

```sh
node --version
npm ci --ignore-scripts
npm run dev
```

工作台在 `http://127.0.0.1:8773/`。官网静态预览可另外运行 `node scripts/website-preview.mjs`，Windows 也可双击 `Start-Website-Preview.cmd`。按终端输出打开本机地址，用 `Ctrl+C` 停止。

安装 [桌面依赖](../desktop/README.md#本机运行) 后，Windows 可双击 `Start-Team-Candidate-Preview.cmd` 打开独立合成桌面。macOS 可在根目录运行 `node scripts/team-isolated-preview.mjs`，仍需做实机验收。Windows 完整评审包还有 `Start-Team-Website-Checkout-Candidate.cmd`，可演练既有合成订单流程。 [开发环境](DEVELOPMENT.md) · [独立团队桌面预览](ISOLATED_CANDIDATE_PREVIEW.md) · [官网预览](../website/README.md)

开发者可从仓库根目录复跑本轮检查。

```sh
npm run check:repo
npm run test:tools
node --test tests/team-wechat-native-website.test.cjs
```

功能提交 `a114502` 的 172 项相关回归和 9 项本机 HTTPS 集成全部通过。另有独立复跑的 9 项集成测试、24 项 Linux 发布脚本测试及桌面和移动尺寸的 Chrome 页面测试。微信付款页用合成商户和已锁定原单验证。正式报价下单、桌面付款入口、真实商户及对账、Mac 安装升级仍待验收。历史进度中的 `D:/codex-temp/` 日志在原开发电脑保存，可用本页命令复验共享源码。 [当前进度](../进度.md) · [支付接入说明](PAYMENT_CHANNEL_PREPARATION.md#授权官网原单付款)

## 提交、验收和合并

1. 任务分支改好后运行直接相关测试。先用 `git status` 检查文件，再提交本任务的源码和文档。
2. 将自己的任务分支推到同一个私有仓库。建立 PR 时明确选择 **base** 为 `codex/team-collaboration-handoff-20261120`，**compare** 为自己的任务分支。触及历史报告时，在正文注明 PR #2 和采用的报告提交。
3. PR 写明关联 Issue、分支及提交号、实际改动、通过／失败／跳过项和对方复现步骤。米老师确认业务规则，产品负责人验收应用、权限和技术。验收后的集成由负责人处理。需要解决冲突时先对照两方改动和业务预期，再复跑受影响的流程。
4. 源码和文档随 Git 同步。客户账套、底稿原件、合同、浏览器业务数据、密钥及本地数据库留在获准的专用环境。用合成样例复现问题，只在 Issue 和 PR 留脱敏结果。

| 需要继续查什么 | 从哪里开始 |
| --- | --- |
| 审计业务、角色和职责 | [团队产品需求](TEAM_PRODUCT_REQUIREMENTS.md) |
| 两人协作、换电脑、保护未提交修改 | [协作规则](COLLABORATION.md) |
| 当前功能、尚缺的实际验收 | [当前状态](STATUS.md) · [进度](../进度.md) |
| 上线流程、商户与双平台发布 | [商业化路线图](COMMERCIALIZATION_ROADMAP.md) |
| 需求、问题或提交说明 | [贡献约定](../CONTRIBUTING.md) |
