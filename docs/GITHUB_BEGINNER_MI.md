# 米老师的 GitHub 零基础协作教程

适用审易协作开发，苹果电脑优先，Windows 同样可用。更新于 2026-11-21。

米老师的 `mixue117` 已有私有仓库的读取和写入权限。用这个账号登录后就能看文档、下载代码或上传自己的业务分支，可以跳过下文的注册和邀请步骤。第一次同步时，用 GitHub Desktop 选 `codex/team-collaboration-handoff-20261120`。已有业务代码时，先按交接文档登记原版本和涉及文件，再确定导入方式。 [打开当前协作分支](https://github.com/icesad/shenyi-audit-workspace/tree/codex/team-collaboration-handoff-20261120) · [当前双人开发交接](COLLABORATION_HANDOFF.md)

已经安装 GitHub Desktop 时，点 **Fetch origin → Current Branch → 协作分支**。如显示 **Pull origin**，先更新，再选 **New Branch**。在新分支上传一项业务修改，开 PR 时将目标分支选为 `codex/team-collaboration-handoff-20261120`。已有业务代码先保留原版本，并附上涉及的文件和验收样例。 [三步接手](COLLABORATION_HANDOFF.md#从同一版本开始) · [第一份业务提交](COLLABORATION_HANDOFF.md#分工和第一份业务提交)

审易私有仓库存放代码与开发文档。GitHub 可能默认显示 `main`。查看本次交接和最新进度时，先切到协作分支。 [审易协作仓库](https://github.com/icesad/shenyi-audit-workspace)

## 一、先分清三个东西

| 名字 | 可以把它理解成 | 你用它做什么 |
| --- | --- | --- |
| GitHub 网页 | 团队的开发档案柜和问题登记簿 | 看文档、提需求、反馈问题、看进度 |
| GitHub Desktop | 电脑与档案柜之间的同步工具 | 参与修改代码时，下载、更新和上传代码 |
| 审易软件 | 实际办理项目的应用 | 报价、立项、收集资料、填写底稿 |

> **GitHub 同步的是提交到仓库里的代码和文档。审易浏览器里保存的项目、账套、证照、附件和填写记录，不会因为换电脑登录同一个 GitHub 账号就自动出现。**
>
> 不要把客户资料放进代码文件夹来「同步业务」。确需迁移业务数据时，先在软件中另行导出备份，由负责人确认加密、安全传输和导入方式；新设备核对成功前，保留旧电脑及原数据。当前软件不因此变成多人实时协同系统。

## 二、第一次使用：注册自己的账号

1. 打开 [GitHub 注册页面](https://github.com/signup)，按页面提示注册。
2. 使用自己能长期收信的邮箱，完成邮箱验证。
3. 记下 **GitHub 用户名**。它不等于邮箱，也不要求是手机号；审易软件的手机号账号资料是另一回事。
4. 给项目负责人发「GitHub 用户名」，让负责人邀请你加入私有仓库。**不要发送密码、验证码或恢复码。**

每个人使用自己的账号，不共用管理员账号。注册流程以 [GitHub 官方注册说明](https://docs.github.com/en/account-and-profile/how-tos/account-management/creating-an-account-on-github) 为准。

### 开启两步验证（2FA）

1. GitHub 网页右上角头像 → **Settings**（设置）。
2. 找到 **Password and authentication**（密码与验证）。
3. 在 **Two-factor authentication** 中选择启用，按向导绑定验证器。
4. 把恢复码存入自己的密码管理器或安全离线位置，不要存进仓库、聊天截图或教程文件里。
5. 更换手机前，先确认新设备能完成验证，再停用旧设备。

菜单变化时，参考 [GitHub 官方两步验证教程](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication)。

## 三、接受仓库邀请

1. 先在浏览器登录刚才自己的 GitHub 账号。
2. 收到负责人发出的仓库邀请后，打开邮件或邀请链接，核对仓库确实属于本项目。
3. 点击接受邀请，再打开本教程开头的仓库链接。
4. 确认能看到代码首页及 **Private** 标识；看不到时，先核对是否登录了被邀请的账号。

**如果还没收到邀请，不代表你操作错了，也不要自己新建一个同名仓库。**把自己的用户名发给负责人即可。私有仓库没有权限时可能显示 404，这是权限问题的一种表现，不要改成公开来解决。[官方邀请说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)

## 四、最推荐的日常用法：只用网页提需求和验收

### 1. 找入口

打开仓库 → 点击上方 **Issues**。可以理解成「问题与需求清单」。先搜索有没有相同问题；已有就进去补充，不重复新建。

### 2. 提交一条清楚的反馈

点击 **New issue**（新建问题），有模板就选「问题反馈」或「功能需求」；没有模板时，使用空白问题。标题写「哪个页面＋什么问题」，正文可以直接复制下面这段填写：

```text
页面：例如「立项 → 项目登记表」
软件版本：页面可见版本号；没有就写测试日期
设备与浏览器：例如 Mac + Safari（能查到版本就补充）

操作步骤：
1. 打开……
2. 点击……
3. 选择……

现在看到：……
我希望变成：……
只允许改动：……
不要改动：其他页面、布局和业务规则保持原样。

截图：已遮住客户名称、金额、联系方式、签章和其他敏感信息。
验收标准：例如保存后切换页面再回来，内容仍在。
```

填好后点击 **Submit new issue**（提交）。复制页面网址发给负责人，以后就在这条问题下面继续讨论。**一条问题尽量只说一件事**，避免改好了一个地方却遗漏另一处。[官方新建 Issue 说明](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)

### 3. 修改完成后怎么验收

1. 在同一条 Issue 中查看负责人回复的「测试版本／分支／试用入口」。
2. 先确认版本。**代码上传了，不等于试用网站已经发布更新。**
3. 按原步骤测试，回帖写「通过」或「未通过＋具体步骤」。
4. 需要补充要求就在原问题中注明；新的独立要求另开一条。

建议回复示例：

```text
验收版本：负责人提供的版本号
设备：Mac + Safari
结果：通过
核对范围：仅项目成本核算入口，其他页面未要求修改。
```

> 第一次合作做到这里就够了。下面是需要参与改文档或代码时才使用的内容。

## 五、需要参与修改时：安装 GitHub Desktop

### 1. 苹果电脑安装与登录

1. 前往 [GitHub Desktop 官方下载页](https://desktop.github.com/) 下载 macOS 版本。
2. 解压下载文件，打开 GitHub Desktop；按系统提示完成安装。
3. 软件菜单 **GitHub Desktop → Settings → Accounts**，选择登录 **GitHub.com**。
4. 选择 **Continue With Browser**，在浏览器登录并完成验证，再返回 Desktop。

Windows 入口通常是 **File → Options → Accounts**，其余思路相同。无需在这个教程阶段单独安装 Git 或生成访问令牌。设备是否受支持，请看 [官方系统要求](https://docs.github.com/en/desktop/overview/supported-operating-systems-for-github-desktop)；登录步骤见 [官方 Desktop 登录说明](https://docs.github.com/en/desktop/installing-and-authenticating-to-github-desktop/authenticating-to-github-in-github-desktop?platform=mac)。

### 2. 首次把代码取到电脑：Clone（克隆）

1. GitHub Desktop 菜单 **File → Clone Repository**。
2. 在 GitHub.com 标签中选择审易仓库；找不到时选择 **URL** 标签，粘贴仓库网址。
3. **Local Path** 选择专用开发目录，例如用户主目录下的 `Developer` 文件夹。
4. 点击 **Clone**，等待完成。
5. 用 **Repository → Show in Finder** 找到代码；Windows 对应 **Show in Explorer**。

不要选择微信下载目录、客户账套目录、iCloud／OneDrive 自动同步目录，不要把两份仓库嵌套在一起。团队已建仓库时用 Clone，**不要 Create new repository（新建仓库），也不要每次都 Download ZIP 覆盖旧代码**。[官方克隆说明](https://docs.github.com/en/desktop/adding-and-cloning-repositories/cloning-and-forking-repositories-from-github-desktop)

### 3. 运行审易和克隆代码不是一回事

GitHub Desktop 下载完代码，并不会自动启动软件。请按仓库的 `README.md` 和开发说明运行；初次环境安装由开发负责人协助。**不要自行双击任意 HTML 文件来判断所有功能是否正常，也不要把 GitHub 的代码页面当作软件页面。**

## 六、参与改动时记住一条流程

**先更新 → 建自己的分支 → 只改约定内容 → 提交 → 推送 → 提交合并申请 → 测试验收。**

| 英文按钮 | 白话意思 | 是否等于网站更新 |
| --- | --- | --- |
| Fetch origin | 查询网上有没有新提交 | 否 |
| Pull origin | 把网上的新提交取到本机 | 否 |
| Commit | 给本机这次改动留一份版本记录 | 否 |
| Push origin | 把本机提交传到 GitHub | 否 |
| Pull Request / PR | 请团队检查后，把改动并入选定的目标分支 | 否 |
| Merge | 把审核过的改动并入目标分支 | 不必然；还要实际发布 |

### 每次开始

1. 在 Desktop 确认 **Current Repository** 是审易仓库。
2. 检查 **Changes**：若还有上次未提交修改，先停下处理，不要丢弃，也不要覆盖。
3. 点击 **Fetch origin**，切到 [当前交接](COLLABORATION_HANDOFF.md) 约定的协作基线。如果出现 **Pull origin**，点击并等同步完成。
4. 点击 **Current Branch → New Branch**，从当前基线建自己的分支。业务改动可以用 `work/mi-report-issue-123`，把 `123` 换成实际 Issue 编号。
5. 按 Issue 约定修改文件。创建 PR 时，核对 GitHub 页面上 `base` 为 `codex/team-collaboration-handoff-20261120`，`compare` 为自己的分支。

分支操作以 [官方 Desktop 分支说明](https://docs.github.com/en/desktop/making-changes-in-a-branch/managing-branches-in-github-desktop) 为准；Fetch 和 Pull 的区别见 [官方同步说明](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/syncing-your-branch-in-github-desktop)。

### 改好后提交并交给团队检查

1. 回 Desktop 的 **Changes**，逐个检查准备提交的文件，只勾选本次约定的内容。
2. 若看到客户账套、证照、公章、合同原件、导出包或 `.env`，**不要提交，先通知负责人**。
3. 在 **Summary** 写清楚，例如 `docs: 补充立项验收步骤（#12）`，点击 **Commit to 当前分支**。
4. 点击 **Publish branch**（首次发布分支）或 **Push origin**（已有远程分支）。仅 Commit 而没 Push，其他电脑和同事看不到。
5. 点击 **Preview Pull Request / Create Pull Request**。目标选择 [当前交接](COLLABORATION_HANDOFF.md) 约定的协作基线，来源选择自己的分支。
6. 在网页填写关联 Issue、改动文件、可复跑的合成样例、实际测试结果和待验收事项，再发起 PR。交接已有业务时也填原版本。 [可复制的提交说明](COLLABORATION_HANDOFF.md#提交验收和合并)
7. 由负责人检查、测试后合并。米老师不确定时，不自行点击合并按钮。

这是协作约定；仓库是否已启用强制保护和自动检查，以管理员实际设置为准。提交步骤见 [官方提交说明](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop)，PR 步骤见 [官方发起 PR 说明](https://docs.github.com/en/desktop/working-with-your-remote-repository-on-github-or-github-enterprise/creating-an-issue-or-pull-request-from-github-desktop)。

## 七、从苹果换到 Windows，或换另一台电脑

### 离开电脑 A 前

- 先确认浏览器里的业务内容按软件要求保存；这与代码提交是两回事。
- 代码修改做到一个可说明的阶段，**Commit，再 Push** 到自己的分支。
- 在 GitHub 网页打开该分支，确认最新提交和文件确实可见。
- 把分支名、Issue 编号、最新提交、已做／未做事项发给协作者。
- 未推送的内容还只在 A 电脑，**不要以为关闭电脑就已经同步**。

### 到电脑 B 后

- 使用自己的同一 GitHub 账号登录；首次用 B 电脑时 Clone，已有仓库时 Fetch/Pull。
- 如果继续自己尚未合并的工作，切到约定的同一工作分支再 Pull，不要误在 `main` 接着改。
- 如果开始新任务，先更新 [当前交接](COLLABORATION_HANDOFF.md) 的协作基线，再建新分支。
- 按开发文档安装环境；不搬 `node_modules`、浏览器缓存或整套旧电脑配置。
- 不在 A、B 两台电脑同时改同一个工作分支。若确有并行工作，各建分支并约定文件范围。

**即使代码版本相同，B 电脑的项目账套和附件也可能是空的——这是本机业务数据尚未迁移，不是 GitHub 丢了代码。**

## 八、哪些东西不能上传到 GitHub

即使仓库是 Private，也遵守本项目的禁传规则：

- 客户序时账、科目余额表、未审报表、审计报告、已填底稿和其他未脱敏资料；
- 营业执照、执业证书原件，公章／法人章／签字图片；
- 身份证号、手机号、银行账户、合同、发票、支付记录；
- 软件本机导出的项目备份、浏览器数据或包含客户资料的压缩包；
- 密码、短信验证码、2FA 恢复码、API Key、访问令牌、`.env` 和私钥。

提交问题时也一样：截图先脱敏，日志先检查，不把真实 Word／Excel 原件拖入 Issue。需要复现时请开发者用虚构样本；确需真实资料，由负责人另行安排获授权的安全渠道。**`.gitignore` 只是辅助，不能保证敏感内容一定被拦下。**

## 九、遇到这些情况先这样做

| 情况 | 先做什么 | 不要做什么 |
| --- | --- | --- |
| 仓库显示 404／没有权限 | 核对账号、邀请是否接受，联系负责人 | 不要把仓库改公开 |
| Desktop 找不到审易仓库 | 确认同账号已接受邀请，刷新或用仓库 URL 克隆 | 不新建同名仓库冒充原仓库 |
| Commit 后同事看不到 | 检查是否 Push／Publish branch，网页核对分支 | 不反复复制整个文件夹覆盖 |
| 提示有本地修改不能切分支 | 保留现场，截图文字并联系开发者 | 不点 Discard all changes |
| 出现 Conflict／合并冲突 | 停止继续编辑，记录分支、文件和提示，交开发者处理 | 不直接选「全部用我的」，不 Force push |
| 软件还是旧界面 | 核对运行目录、分支、软件版本和是否真的发布 | 不因此改其他模块 |
| 换电脑后项目和附件不见了 | 检查业务数据备份／迁移，不清理旧设备 | 不把真实业务资料提交到仓库 |
| 网络失败 | 保留本地文件和提交，网络恢复后再同步 | 不关闭证书校验，不共享密码／令牌 |

冲突表示两边可能都改了同一处，不代表「网上的可以删掉」。由开发者对照两边、运行测试后解决；参考 [GitHub 官方冲突说明](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/resolving-a-merge-conflict-on-github)。

## 十、米老师的第一次练习（不动软件代码）

- [ ] 注册账号、验证邮箱并开启 2FA。
- [ ] 把 GitHub 用户名给负责人，接受私有仓库邀请。
- [ ] 打开 README 和本教程。
- [ ] 新建一个 Issue，标题为「协作试用：米老师已进入仓库」。
- [ ] 正文注明「这是协作练习，不要求修改软件」，不放客户信息。
- [ ] 收到回复后，在同一条 Issue 下发一条评论。

到这里就已经可以开始协作。**提需求与验收走 Issue；代码改动走分支和 PR；业务资料留在独立、安全的数据流程中。**
