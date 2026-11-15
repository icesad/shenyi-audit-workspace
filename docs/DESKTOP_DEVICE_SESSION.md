# M3B 正常桌面设备会话

本页保留`e37eaab`的M3B范围；后续[换机审批M3C](DEVICE_REPLACEMENT.md)已完成Windows本地验证，现为64窄接口/10form/17密码。下文“换机尚待实现”仅指M3B当时，Mac、正式服务及最高审核账号恢复仍未完成。

2026-11-15，分支 `codex/desktop-device-session`，从M3A `77f6c1d` 接续。本轮已将 [设备底座](DEVICE_IDENTITY_FOUNDATION.md) 接入正常客户端并通过Windows本地独立验收，详细证据见 [进度](../进度.md)。[执行合同](DESKTOP_DEVICE_SESSION_CONTRACT.md)记录精确接口与竞态要求，M3C换机审批、Mac与国内正式服务仍待完成。

## 登录和使用

用户名合成演示、手机号密码、微信授权都经过相同设备关卡。身份登录只拿到临时上下文；设备未就绪时不下发团队成员投影，也不加载任务、人员或审核能力。真实短信和微信仍未配置，相关入口如实禁用。

未绑定的账号需要确认账号、本机指纹、设备名称，重新输入当前密码并勾选同意，才首次登记并进入工作区。登录密码不缓存，也不拿第一次输入的密码静默绑机。已绑定同一密钥时自动完成持钥证明；不同密钥或已撤销历史会阻断，不提供删除本地文件、改设备ID或重新首次绑定的绕过路径。换机规则仍是员工由团队管理员审核，管理员本人由产品负责人审核，相关申请/审批另在M3C实现。

正常 `Start-Team-Preview.cmd` 和 `Start-Team-Review-Preview.cmd` 使用同一8774端口，不能同时启动；两者固定启用服务端设备门。客户端缺系统密钥、服务端缺严格设备能力或协议不符时不会降级。它们仍是合成开发预览，没有生产身份、客户业务资料或签名安装包。

## 在线会话和文件边界

每个业务请求在main中签名实际method、path/query、同一份正文SHA256和新nonce。令牌、租约秘密、私钥和签名字节不进入renderer；新3项窄操作是本机状态、明确首次登记、重连，总57项preload接口，没有通用网络或签名接口。

业务租约约15分钟，main提前续接，单飞采纳新会话。旧请求、文件选框和迟到401不能沿用新代次；原操作不自动重发。另一个实例完成持钥登录后，服务端立即撤旧业务会话，旧实例在下一次请求或main心跳发现后清退。main默认每5秒核验一次，不将此轮询描述为实时推送；网络超时另有上限。

网络或响应读取失败会暂停业务，清理界面中的业务内容和输入；强行调用RPC也不能绕过。main或用户重连仍须在线持钥核验，不能仅凭 `navigator.onLine`、本地时钟或尚未到期的缓存放行。自然到期要求重新登录。已发出的操作若未收到结果，必须先联网核对，不自动重复提交。系统休眠/恢复会使旧文件guard失效再核验；保存前HEAD、上传前fresh授权及原件hash规则保持。

## 密钥存储与局限

设备key目录独立于业务profile和默认Roaming userData。Windows使用 `%LOCALAPPDATA%/ShenyiTeamPreview/device-vault`，Mac候选为本机 `~/Library/Application Support/ShenyiTeamPreview/device-vault`。Windows这个小型OS保护文件跟随系统本机账户目录；代码、依赖和大体积证据仍在D盘。异常目录/坏文件/系统加密不可用时拒绝，不静默搬迁或换key。

OS加密不是硬件不可复制保证。同一OS保护上下文复制密文可读，受管网络home、域漫游策略、管理员迁移或系统克隆也有边界；本机目录选择只避免普通配置漫游带走设备key。跨电脑和Mac须分别实测，不从路径名称推出安全结论。

## 验证与接续

新严格验证使用全新合成SQLite、真实Windows Electron safeStorage、隔离D盘key/profile和随机端口HTTP，不给已有普通9/review13演示账号自动登记。原生报告须区分真实主进程/renderer/HTTP/SQL、合成供应商、测试拦截的文件对话框及Mac/生产未验项。

旧M2 DOM和11项原生兼容采用明确的test-only diagnostic夹具，产品main不引用，业务/权限/原件/撤权断言保持；这些结果只证明旧流程兼容，不能当成设备绑定证据。新M3与默认smoke必须使用严格门和真实OSkey，不经过该夹具。

最终Node24完整portable：1662通过、0失败、0跳过，297.46秒；新入口/连接4、client21、独立security55、UI30共110包含在内。41份运行及单元源文件在最终全量期间hash未变。独立UI296项属于重叠专项，不重复累计。真实严格原生5图/5阶段SQL、默认strict smoke8图及11项旧诊断原生兼容全部通过，独立审查无剩余本地P1/P2。两一键入口已实跑required=true，普通9/review13账号未自动绑定，46表/76对象及全部原行与before完全相同。仓库外证据在 `D:/codex-temp/shenyi-device-client-20261115/`，没有推送、进入main或上线，Goal仍active。

主进程休眠/恢复事件按 [Electron45 powerMonitor](https://raw.githubusercontent.com/electron/electron/v45.3.2/docs/api/power-monitor.md) 接入。文档不替代实机验证。
