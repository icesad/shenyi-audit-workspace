# 审易双人开发交接

更新于 2026-11-21。协作基线包含团队客户端、服务端、官网和合成测试。米老师负责审计规则，产品负责人负责应用和上线。双方从同一个提交各开任务分支，并用同一合成样例验收。

| 项目 | 当前交接点 |
| --- | --- |
| 仓库 | 私有的 [icesad/shenyi-audit-workspace](https://github.com/icesad/shenyi-audit-workspace) |
| 本阶段协作基线 | [`codex/team-collaboration-handoff-20261120`](https://github.com/icesad/shenyi-audit-workspace/tree/codex/team-collaboration-handoff-20261120) |
| 本轮同步内容 | 协作分支纳入已验收的四职级合成库离线恢复 `63c37bb` 和试点批准回执 `767b39b`。开任务分支前先拉取更新，把实际起点记到 Issue。 |
| 已验收的构件源码 | 最新 Windows 双人评审 ZIP 来自 [`6ef38ba`](https://github.com/icesad/shenyi-audit-workspace/commit/6ef38ba9492240dd5eeac1b328ea0124acc2c0d4)。macOS 双架构签前包和同源 Linux 演练包来自 [`704959f`](https://github.com/icesad/shenyi-audit-workspace/commit/704959f6284c961ebda48d386f88c1d6e4883a71)。新版 Linux 支付探针包来自 [`98a5a38`](https://github.com/icesad/shenyi-audit-workspace/commit/98a5a38037872e219107966ee96860a18f455b5d)。 |
| 当前收款候选 | 官网报价、锁单、扫码付款、查单与超时关单。Windows 客户端可打开或继续官网购买，也可在获准绑定的新电脑上查阅同队微信订单并打开原单。 |
| 米老师的 GitHub 账号 | `mixue117`，已核对具有本仓库读写权限 |
| 主干与历史草稿 | GitHub 默认打开 `main`。历史报告分支 `work/report-four-sources@894078b` 的草稿 PR #2 指向 `main`，等待业务验收。 [查看草稿](https://github.com/icesad/shenyi-audit-workspace/pull/2) |

## 本次同步的两个已验收改动

- **加密备份与离线恢复**。Windows 合成团队库恢复后，100 张表的 372 条原有记录、两份原件、席位和撤权历史保持一致。带离线标记的原副本及改名副本均被服务拒绝启动。51 项相关回归通过。 [恢复手册](TEAM_OFFLINE_BACKUP.md#windows-四职级采集库恢复演练)
- **试点批准回执**。产品负责人批准试点后遇到断线，可重新连接，在人工审核面板刷新原申请，核对北京时间截止和实际席位。已收到的回执在列表延迟时仍会显示。Windows 源码客户端实测找回四席，全程一笔批准。167 项相关回归和 44 项独立界面检查通过。 [操作说明](MANUAL_TEAM_ONBOARDING.md#试点批准结果待核对)

新版团队申请录入及其编号核对仍在开发机验收。当前一键评审包对应 `6ef38ba`。试点批准修复以同步后的源码复跑；安装包、合成库和原始日志保留在开发机。

## 从同一版本开始

1. **米老师**用 `mixue117` 登录 GitHub Desktop，先保留旧业务目录和未提交修改。克隆仓库或点击 **Fetch origin**，切到 `codex/team-collaboration-handoff-20261120`，再从这个版本新建自己的业务分支。 [GitHub Desktop 图文步骤](GITHUB_BEGINNER_MI.md)
2. **产品负责人**从同一协作分支另开应用任务分支。双方在 Issue 写清各自改动的文件、合成样例、预期结果和验收人。米老师已有业务代码时，先记录原版本和文件清单，一次交接一个业务改动。
3. 各自在 GitHub Desktop 选择 **Publish branch** 或 **Push origin**。新 PR 的 **base** 选择 `codex/team-collaboration-handoff-20261120`，**compare** 选择自己的任务分支。米老师验收审计结果，产品负责人验收应用、权限和兼容性。

当前为私有协作候选。合入 `main` 和正式发布分别验收。

## 分工和第一份业务提交

- **米老师**负责审计流程、原表格式、底稿及报告规则，并确认预期业务结果。已有代码时，先保存原开发目录和版本，在 Issue 记录原提交号、涉及文件、想采用的业务规则及演示步骤。从协作分支建立自己的业务分支，挑出与该任务有关的提交或文件差异，逐项核对后推送。原版本无提交号时，记录软件版本或修改日期及准确文件名，保留原目录供双方对照。
- **产品负责人**负责桌面易用性、组织和项目权限、账号与设备、订阅席位、官网及上线，负责技术验收与版本集成。接到业务分支后，先核对共同改动的入口、项目权限和数据兼容，再复跑对应工作流。收款上线目前还要确认正式价格目录和商户配置。 [支付接入说明](PAYMENT_CHANNEL_PREPARATION.md)
- 业务跨到权限、存储或界面时，两人先在 Issue 约定改动的文件、接口和验收人。底稿的专业复核、新冻结和重开规则由米老师确认。现有底稿查阅、填写、导出权限和版本保存按已有合同与验收记录执行。 [底稿三权与业务边界](WORKPAPER_ACCESS_CONTRACT.md) · [模块入口和文件](ARCHITECTURE.md)

四来源报告的历史草稿位于 `work/report-four-sources@894078b`。米老师可在 PR #2 复核四类来源、底稿填写、草稿保存和 Word 导出。选定要保留的提交、专业规则和验收样例后，从当前协作基线开独立集成分支并发起新 PR。米老师确认业务结果，产品负责人复核立项、账表、权限及底稿入口。 [历史草稿 PR #2](https://github.com/icesad/shenyi-audit-workspace/pull/2) · [报告合并预演记录](STATUS.md#2026-11-20-历史报告草稿隔离合并预演)

### 米老师的第一份业务交付

1. 如果成果目前只在本机，保留原目录，在同一条 Issue 记录原版本或提交号、准备交接的文件、业务规则和一份合成样例。若已有 Git 提交，附提交号和要采用的改动。若只是反馈规则或预期结果，可以先在 Issue 写清，供产品负责人据此实现。
2. 从最新协作基线建自己的分支，一次带入一项约定的业务改动。已存在一个业务分支时可先推送到同一私有仓库供双方对照；提交前用 `git status --short` 查清新增或修改的文件。合入候选使用单独的 PR，目标选择协作分支。
3. 以同一个合成项目复现这项改动，再分别签收。米老师确认数据来源、计算或填报规则、预期输出。产品负责人确认项目权限、存量数据兼容、桌面入口和回归。验收成功后，产品负责人合入共享候选，并记录测试使用的提交号。

| 改动范围 | 从这些源码和说明入手 |
| --- | --- |
| 审计业务、旧版报表和底稿 | `dist/` 内的平铺应用源码。按模块定位入口和模板，保留项目 UUID、原件、公式与历史存储语义。 [文件地图](ARCHITECTURE.md#文件地图) |
| 桌面账号、设备、任务及项目授权 | `desktop/team-ui/`、`desktop/preload.cjs`、`server/team/`。由产品负责人复核服务端授权、撤权与端到端结果。 [团队产品需求](TEAM_PRODUCT_REQUIREMENTS.md) |
| 官网、订阅和席位 | `website/`、`server/team/` 的账务和微信支付模块。使用合成报价、订单及查单应答复验。 [官网开发](../website/README.md) · [支付接入](PAYMENT_CHANNEL_PREPARATION.md) |

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

完成同步后，用以下命令核对两台电脑的工作起点。第一行显示当前提交，第二行显示本机最近取到的远端协作提交。两行一致时，双方可以把这个提交号记在各自的 Issue。

```sh
git rev-parse --short HEAD
git rev-parse --short origin/codex/team-collaboration-handoff-20261120
```

**开自己的任务分支。** 下面以 Issue #123 作命令示例，实际使用项目中的 Issue 编号。

```sh
git fetch origin
git switch --no-track -c work/mi-report-issue-123 origin/codex/team-collaboration-handoff-20261120
```

产品方从同一远端分支建任务分支，使用自己的 Issue 编号和任务名称。两人各自在自己的分支完成开发。

## 业务合并时要核对的内容

| 本次改动 | 由谁复核、核对什么 |
| --- | --- |
| 原表读取、公式、底稿填写或报告输出 | 米老师用合成样例逐项核对输入、规则和预期输出。若采用 PR #2 中的改动，在新 PR 记下原提交、纳入的文件和仍待确认的规则。 |
| 共用页面、项目存储或团队接入 | 产品负责人确认原项目能打开和保存，原件与项目 UUID、已有记录和版本关系一致。涉及团队权限时，用有权和无权账号各走一次，并核对撤权后的访问。 |
| 两人改了同一模块 | 在合并前的同一个候选提交运行相关检查。PR 里记录米老师的业务结果和产品负责人的兼容、权限及入口结果，再合到协作分支。 |

## 本地运行和复验

需要 Node.js 24.15 或以上的 24.x。本次复验使用 Node.js 24.22.1。首次在仓库根目录安装固定依赖，再运行工作台预览。

```sh
node --version
npm ci --ignore-scripts
npm run dev
```

工作台在 `http://127.0.0.1:8773/`。端口已有审核预览时保留原进程，另用下方独立团队入口走查。官网静态预览可另外运行 `node scripts/website-preview.mjs`，Windows 也可双击 `Start-Website-Preview.cmd`。按终端输出打开本机地址，用 `Ctrl+C` 停止自己启动的服务。

在仓库根目录安装桌面依赖：

```sh
npm --prefix desktop ci --ignore-scripts
npm --prefix desktop run setup
```

Windows 可双击 `Start-Team-Candidate-Preview.cmd` 打开独立合成桌面。该入口需要可写的 D 盘。缺少 D 盘时可先用浏览器工作台。macOS 可在根目录运行 `node scripts/team-isolated-preview.mjs`，实机仍待验收。官网合成订单一键演练使用完整解压的 Windows 双人评审包中的 `Start-Team-Website-Checkout-Candidate.cmd`，需要包内的 Node 运行时。微信 Native 付款流程需要独立的受管 HTTPS 配置。共享库保全备份和隔离升级预演已有记录，实际共享库切换仍待验。 [桌面依赖](../desktop/README.md#本机运行) · [开发环境](DEVELOPMENT.md) · [独立团队桌面预览](ISOLATED_CANDIDATE_PREVIEW.md) · [官网预览及下单演练](../website/README.md)

两位负责人可按同一个合成案例走查采集、权限和原件预览。源码目录用 Windows 的 `Start-Team-Pilot-Candidate.cmd`，或运行 `node scripts/team-isolated-preview.mjs --pilot-demo`。各自启动时会得到独立合成库，可把观察结果记在同一份双人评审单。若要从空团队走查首管理员开通、邀请和四职级，先完整解压 Windows 双人评审 ZIP，再运行包内的 `Start-Team-Managed-Pilot-Candidate.cmd`。 [源码采集走查](TEAM_PILOT_REHEARSAL.md) · [空团队开通走查](PILOT_MANAGED_FIRST_TASK.md) · [双人评审单](PILOT_OWNER_REVIEW.md)

开发者可从仓库根目录复跑项目检查和直接相关回归。

```sh
npm run check:repo
npm run test:tools
```

按任务范围加跑专项。业务验收在独立环境记录操作入口、预期和实际结果。需要浏览器或特定样本的回归，可查开发文档配置对应依赖。 [测试说明](DEVELOPMENT.md#2-测试命令)

| 修改范围 | 可复跑的合成用例 |
| --- | --- |
| 项目授权、采集任务、团队底稿 | `node --test tests/team-project-access-core.test.cjs tests/team-task-management-core.test.cjs tests/team-workpaper-http-resume.test.cjs` |
| 首管理员与受邀员工激活、员工换机 | `node --test tests/team-managed-onboarding-sms.test.cjs tests/team-device-replacement.test.cjs tests/team-device-replacement-proof.test.cjs tests/team-desktop-device-replacement-client.test.cjs` |
| 首管理员审批和员工邀请断线恢复 | `node --test tests/team-managed-onboarding-sms.test.cjs tests/team-employee-activation.test.cjs tests/team-provisioning-core.test.cjs tests/team-desktop-provisioning-ui.test.cjs tests/team-desktop-invitation-pagination.test.cjs tests/team-desktop-invitation-pagination-ui.test.cjs` |
| 官网扫码付款、桌面账务、换机找回原单 | `node --test tests/team-wechat-native-website.test.cjs tests/team-desktop-billing-client.test.cjs tests/team-desktop-website-checkout.test.cjs tests/team-desktop-billing-ui.test.cjs tests/team-managed-service-config.test.cjs` |
| 微信账单和 Linux 监控 | `node --test tests/team-wechat-native-fund-bill-parser.test.cjs tests/team-wechat-native-reconciliation-cli.test.cjs tests/team-service-release-check.test.cjs` |
| 收到构件前复跑接收校验 | `node --test tests/check-release-handoff.test.cjs tests/team-service-release-check.test.cjs` |

## 官网与微信支付进度

| 功能提交 | 可接续的功能和已验证范围 |
| --- | --- |
| `a114502` | 从短时授权打开已锁定原单，显式获取付款码和主动验签查单。通过本机受管 HTTPS 及 Chrome 桌面、移动尺寸验证。 |
| `8d74d72` | 官网选择席位、报价及确认锁单。续费核对已占席和邀请预留，期中增购在原到期日以内。通过合成目录和收款应答验证。 |
| `89648ca` | 从 Windows 桌面「订阅与席位」打开或继续本次购买、按编号打开原单。以本机受管 HTTPS 和实际 Electron 核对跨重启复用原单。签前便携候选另有实启记录。 |
| `27de470` | 到期未付款原单可显式请求关闭。已请求出码的订单按验签查询、关单和复查确认。覆盖本机合成应答及隔离账本迁移。 |
| `8ca7a91` | 按北京时间账单日申请、下载和核验普通商户 `ALL` 账单，只读核对订单和收款。463 项相关检查及独立复跑的 18 项检查通过，零失败或跳过。 |
| `021ad76` | 从该账单选定单笔退款，以本应用原单、可信收款和微信验签查询核对当前状态。合成环境中 474 项相关检查和 29 项独立复跑通过。真实退款执行、期限或席位处置仍待确认。 |
| [`456d8d9`](https://github.com/icesad/shenyi-audit-workspace/commit/456d8d97c89992f2c1362bea30811956b60b9f79) | 新装或获准换机后，团队技术管理员可翻页查看当前支付配置下的本团队微信订单，包含由前任技术管理员创建的原单。受管服务未配置价格目录时仍可查阅已有订单。Windows 源码客户端与 Chrome 已通过独立合成受管 HTTPS 验收。 |
| `6fa09e8`、`96008cd` | 只读核对基本账户资金账单和较早账单日退款。跨日退款专项共有 492 项相关检查通过。 |

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
| Windows | `6ef38ba` 评审 ZIP 的包内一键入口已实测启动、负责人登录、初次绑机及正常退出。同一 ZIP 的打包 Electron 已从空库走完四席预留与激活、四职级分工、两份原件采集及撤权，相关回归 296 项通过。`704959f` 的独立打包客户端另有找回同队原单、员工换机和四职级采集实测。 | 正式签名 MSI 安装、升级和回退，以及两台电脑之间实际换机。 |
| macOS `704959f` | Apple 芯片和 Intel 两份候选均完成离线签前与接收检查。独立接收核对架构、交接签名和版本限制。 | Developer ID 签名、公证、Mac 实机安装、绑定和升级。 |
| Linux `704959f`、`98a5a38` | Ubuntu 24.04 隔离环境实测签名激活、账本加密恢复和回滚。新版支付探针以真实 Nginx 验证后端与公共入口三种启用状态。 [双路验收](LINUX_TEAM_DEPLOYMENT.md#2026-11-21-隔离-ubuntu-与-nginx-的微信-native-上线验收) | 国内云生产配置、外部告警送达、正式证书、真实商户及回调。 |
| 首队试点 | 空库实测首管理员开通、首队四席、邀请预留、四职级任务和停用在线员工后重新使用席位。受管短信配置以合成供应商覆盖管理员和员工激活。 [席位复用验收](MEMBER_DEACTIVATION.md#2026-11-21-有效试点停用员工与席位再使用) | 产品负责人批准首家试点并填写到期时间与席位上限，随后验收真实短信送达及获准团队样例。 |
| 审计业务 | 已有历史报告预演和合成结果可复跑。 | 米老师确认采用的专业规则及合并范围，双方签收。实际共享库升级和获准资料试点单独安排。 |

协作者从 GitHub 拉取源码、文档和合成测试，在各自电脑复跑。评审 ZIP、原始日志和演练数据库保存在原开发机。直接从 GitHub 克隆后可按上文运行源码。 [最新 Windows 评审包](WINDOWS_DESKTOP_CANDIDATE.md#2026-11-21-含开通恢复流程的-windows-双人评审包) · [macOS 接收](MACOS_DESKTOP_CANDIDATE.md#2026-11-21-当前协作提交的-macos-双架构签前交接) · [Ubuntu 发布恢复](LINUX_TEAM_DEPLOYMENT.md#2026-11-21-当前协作提交的-ubuntu-发布恢复与回滚)

团队走查已记录四职级的任务和原件范围、审批与激活顺序、停服核对结果，以及短信的复跑命令。 [四职级走查](PILOT_MANAGED_FIRST_TASK.md#2026-11-21-含开通恢复功能的评审包四职级验收) · [新员工换机验收](DEVICE_REPLACEMENT.md#2026-11-21-当前-windows-候选的新员工换机闭环) · [短信激活联测](MANAGED_TEAM_SERVICE.md#首管理员和员工激活联测)

## 收到发布构件时

收到 `Shenyi-Owner-Review-6ef38ba-Win-x64.zip` 后，先核对 ZIP 的 SHA-256，再完整解压并双击 `Verify-Owner-Review.cmd`。空团队采集使用解压目录内的 `Start-Team-Managed-Pilot-Candidate.cmd`。该包的摘要及验收记录见 Windows 评审说明。 [新版 Windows ZIP 摘要](WINDOWS_DESKTOP_CANDIDATE.md#2026-11-21-含开通恢复流程的-windows-双人评审包) · [随包操作手册](../README-Owner-Review.md)

下方离线清单覆盖先前的四份归档。接收方先从产品负责人批准的私有源码提交取用交接清单和校验脚本，并通过获准的交接记录核对预期清单摘要。选定下表对应的编号，再读取收到的原始 ZIP 或 TAR。两份 Linux TAR 的字节长度相同，需按清单编号核对实际摘要。 [当前构件清单](RELEASE_HANDOFF_CATALOG.json)

| 构件编号 | 用途 |
| --- | --- |
| `windows-704959f-review` | Windows x64 双人评审 ZIP，适用于合成走查。 |
| `macos-704959f-handoff` | macOS Apple 芯片及 Intel 两份候选的外层签前交接 ZIP。 |
| `linux-704959f-rehearsal` | 与两份桌面构件同源的 Ubuntu 暂存、恢复与回滚演练 TAR。 |
| `linux-98a5a38-native-payment` | 完整 Linux 服务 TAR，含更新后的微信 Native 探针，已用于签名激活和 Nginx 验收。 |

这份清单的 SHA-256 为 `dcf04f62369ad6a9e9a8cdb3164a36ce57f33ec36d01c6b8965b7915a21672b8`。接收时以批准记录中的值为准。在仓库根目录使用 Node.js 24.x 执行下列示例，将两个路径替换为本机的绝对实际路径，按收到的构件选择编号。macOS 可用 `pwd -P` 确认当前目录的实际路径。

```sh
node scripts/check-release-handoff.mjs --catalog "/absolute/review/docs/RELEASE_HANDOFF_CATALOG.json" --catalog-sha256 dcf04f62369ad6a9e9a8cdb3164a36ce57f33ec36d01c6b8965b7915a21672b8 --artifact macos-704959f-handoff --archive "/absolute/downloads/Shenyi-macOS-Signing-Handoff-0.61.0-704959f.zip"
```

成功时退出码为 `0`，回执记录构件编号、完整源码提交、字节数和 SHA-256。收到文件改名时可使用实际名称。失败时记录回执中的诊断码，按批准编号重新核对文件和清单。该命令只读归档字节。通过后按各平台接收文档核验内层构件、签名及实机结果。 [Windows 验收](WINDOWS_DESKTOP_CANDIDATE.md#发行验收) · [macOS 签名与接收](MACOS_DESKTOP_CANDIDATE.md#正式-zip-接收与签名核验) · [Linux 签名与暂存](LINUX_TEAM_DEPLOYMENT.md#发布归档签发与部署验签)

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
