# 审易 · 审计工作台

私有协作开发仓库：<https://github.com/icesad/shenyi-audit-workspace>。

**协作开发从 `codex/team-collaboration-handoff-20261120` 开始。** 米老师用 `mixue117` 和产品负责人各从同一版本开任务分支。交接页包含 GitHub Desktop 和终端步骤、本机启动、首份业务 PR 以及验收口径。GitHub 默认打开 `main` 时，可用下方链接直达共享分支。 [GitHub 双人开发交接](https://github.com/icesad/shenyi-audit-workspace/blob/codex/team-collaboration-handoff-20261120/docs/COLLABORATION_HANDOFF.md) · [本地交接文档](docs/COLLABORATION_HANDOFF.md) · [米老师 GitHub 教程](docs/GITHUB_BEGINNER_MI.md)

## 这里放什么

放应用源码、合成测试、开发文档和需求记录；**不放客户账套、真实底稿、合同、证照、公章、签名、密码或浏览器业务备份**。

代码同步 ≠ 业务数据同步。换电脑登录 GitHub 不会带出原浏览器里的项目、附件和填写记录。现阶段不承诺多人实时编辑同一项目。

## 文档入口

| 我要做什么 | 看这里 |
|---|---|
| 第一次用 GitHub、给开发者反馈 | [米老师新手教程](docs/GITHUB_BEGINNER_MI.md) |
| 拉取当前候选、分工和提交第一条 PR | [双人开发交接](docs/COLLABORATION_HANDOFF.md) |
| Mac / Windows 安装、运行、测试 | [开发与运行](docs/DEVELOPMENT.md) |
| 换电脑、两个人改同一软件 | [跨设备协作规则](docs/COLLABORATION.md) |
| 看模块和文件对应关系 | [架构与数据边界](docs/ARCHITECTURE.md) |
| 知道现在究竟完成到哪里 | [当前状态](docs/STATUS.md) |
| 接续之前的目标和需求 | [GOAL](GOAL.md) / [BACKLOG](BACKLOG.json) |
| 团队权限、桌面端、年订阅与两位负责人分工 | [团队产品需求](docs/TEAM_PRODUCT_REQUIREMENTS.md) |
| 国内上线手续、域名/阿里云/支付与阶段验收 | [商业化路线图](docs/COMMERCIALIZATION_ROADMAP.md) |
| 持续开发Goal提示词与本机检查点 | [Goal提示词](docs/COMMERCIALIZATION_GOAL.txt) / [进度](进度.md) |
| 提交修改、约束改动范围 | [贡献约定](CONTRIBUTING.md) |
| 哪些资料不能上传、出了问题怎么办 | [安全说明](SECURITY.md) |

## 本机运行（开发者）

使用 Node.js **24.15 或更高的 24.x**。协作候选复验环境为 24.22.1。

```sh
npm ci --ignore-scripts
npm run dev
```

在浏览器打开 <http://127.0.0.1:8773/>。服务仅监听本机，不自动上传资料；端口被占用时会报错，**不会悄悄换端口**。第一次安装依赖需要联网；安装好后静态前端可断网运行。平台账号接口和云端功能不属于本机静态运行的验证范围。

不要双击 `dist/index.html` 来代替这个开发入口。不同地址、端口、浏览器和设备会使用不同的本机业务存储。

## 分支和发布

- `main`：以原线上 v61 为应用基线，新增协作工具和文档；不是重新设计软件。
- `codex/team-collaboration-handoff-20261120` 是本阶段两人开任务分支的起点，包含团队应用、官网和微信 Native 付款候选。当前版本的验收和复跑命令见交接文档。 [接手步骤](docs/COLLABORATION_HANDOFF.md)
- `work/report-four-sources`：保留此前已实现、尚未在原站点发布的成本导航和四来源报告页修改，待业务验收；不作为已经完成的正式报告功能。
- GitHub 提交/合并 **不会自动发布原网站**。发布由负责人独立执行并记录结果。
- 现有布局和业务规则只按明确需求修改；没有说到的地方不自行扩展。

## 软件边界

这是在持续开发和业务验证中的工具，不是自动完成审计或自动出具意见的系统。账表算术校验、资料上传、底稿填写、核对、冻结、报告签发是不同环节，不能互相替代。Excel 原公式、链接和原件必须保留；未完成的审计程序、证据、结论、日期和签字不能补造。

## 授权

本仓库保持私有，不授予对自有源码或模板的开源许可。第三方组件沿用其各自许可证及来源说明，见 [第三方声明](docs/THIRD_PARTY.md)。模板的共享及商业使用权需另行确认；不要将私有仓库改为公开来解决访问问题。
