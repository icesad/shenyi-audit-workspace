# 团队采集桌面界面：现有视觉扩展

本阶段是Extension，不是整体UI升级。复用原审易标识和视觉token，不修改旧dist页面或其业务流程。

- Design Read：资料采集工具；受指派的团队员工；安静、严谨的文档工作空间。visual-variance 2、motion-intensity 1、information-density 6、asset-dependence 3、brand-fidelity 10。
- 叙事职责：登录后快速识别任务与提交状态；笔记本近距离阅读；任务列表/详情双栏适合当前信息量，禁止显示全项目导航。
- 真实标识：`../dist/brand-shenyi.png`，由受控应用协议映射；原样使用，不重画。
- 色彩来自`dist/styles.css`：nav `#172e32`、ink `#20373a`、muted `#6c7d7e`、accent `#27685b`、paper `#f5f6f2`、line `#e3e8e2`、amber `#986829`、red `#aa3d35`。
- 字体沿用Microsoft YaHei/PingFang SC；正文14px、说明12px、主标题30px，长文件名/摘要可换行。
- 以8px节奏组织间距，输入44px、按钮38–44px、圆角6/9px、轻微层次；只有状态变化的短过渡，遵守减少动态效果偏好。
- 登录/加载/无任务/无权限/版本冲突/退出均有说明；当前明确“本机合成演示”，不暗示设备绑定、生产登录或商业化已完成。
- 保护：不改logo、全局品牌、既有布局、模板、公式或存储键；不加入主题选择器、广告性装饰和未授权模块入口。

M2交互验收覆盖登录→读取任务→详情/提交记录→受控选择文件→上传保存→下载→退出；完整视觉升级留M6。

M4H原件只读预览沿用同一视觉，不改变品牌或核心布局：独立阅读窗口使用真实logo、墨绿标题区、米白背景、白色文档区及原控件层级；文件名和正文可换行，关闭按钮、加载与失败提示及键盘焦点清楚可达。保持8px节奏、6px按钮圆角、原中文字体，减少动态效果。当前为extension/preserve，visual-variance 1、motion-intensity 0、information-density 6、asset-dependence 3、brand-fidelity 10；近距离笔记本阅读、安静且严谨，document内容优先。完整配色／字号升级仍归M6。
