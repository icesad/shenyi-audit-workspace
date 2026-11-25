# M4H 团队资料原件安全预览执行合同

2026-11-16，base `feca6cc03e7a575057b14599117be680d67502d3`，分支 `codex/team-material-preview`，仍仅 TEAM-M4 实现中。上一Goal回合属于 progress：M4G已本地提交并独审；本轮开工 checkout clean、main060a98e／report894078b不变。全部990个tracked旧文件改前原版（49,644,462 bytes）备份至 `D:/codex-temp/shenyi-team-material-preview-20261116/baseline/`，同级manifest。继续使用 codex-long-task-guard；不重建工作区或丢弃历史。

## 目标、授权与范围

正常团队桌面资料树／全部历史的原件按钮 → 当前账号材料read校验 → main核真实原件及SHA → 独立受限窗口复用旧惰性预览器 → 实际PDF翻页、Office正文／缓存单元格、图片及文本可看 → 撤权／暂停／换账号／关闭／重载后终止本次预览。不能用下载、直接注入预览API、假Office字节或只有窗口标题代替真实闭环。

材料read已由用户批准包含全部历史原件，独立调查确认预览不增加数据范围；不新增ACL、专业核对动作或签发资格。frozen项目和旧closed记录按read可预览，archived拒；仍禁止跨团队／项目／未授权账号及junior获取完整材料。不改server/schema、业务记录、原件、原专业规则、旧本机库、既有下载保存链、正常创建政策、整体UI或其他模块。真实客户数据、Mac、远程生产仍未授权／未验。

本片复用 `AuditPreviewReaders`／`AuditAttachmentPreview`、现有本地Office/PDF/图片组件；已支持格式按原安全模型显示。HTML/XML/Markdown只作惰性文本；公式仅缓存值，宏／外链／嵌入对象不执行。旧DOC/PPT的文字提取及Office分页等原有精度限制如实保留。RAR读取组件需要动态执行，不能为了RAR增加unsafe-eval；本片遇到不兼容或超限须清楚提示回工作台按原权限保存，不声称全格式精确还原。

## 视觉与既有设计

采用 `web-design-engineer`，按用户全局AGENTS沿用已批准 `desktop/brand-spec.md` 的扩展模式，不重新选择品牌或核心布局。真实logo仍用dist/brand-shenyi.png；墨绿／米白、Microsoft YaHei／PingFang SC、8px节奏、6px圆角、安静文档阅读界面。预览增加可达关闭、加载／失败说明、长文件名换行、键盘焦点和减少动态效果支持；完整UI升级仍归M6。本轮浏览器／Windows原生验收由原Goal明确要求，依skill executable browser acceptance进行。

## main可信原件与生命周期

仅两个新增workspace窄RPC（98→100，无新增form或密码框）：

- `previewProjectMaterial({requestId,teamId,projectId,fileId})`：requestId为renderer发送前生成的UUID；成功 `{opened:true,previewId:requestId,filename,byteLength}`。正常workspace不接收bytes、URL、路径、token或文档模型。
- `closeProjectMaterialPreview({previewId})`：只清该本机实例，返回 `{closed:boolean}`；旧A的迟到close不得关闭新B，不能使用无条件null清后来窗口。

channel分别 `shenyi:project-material-preview` 与 `shenyi:project-material-preview-close`；继承exact APP_URL／sender／mainFrame校验。所有团队／项目／文件参数从服务端范围验证，不接受URL、路径、raw record、角色、HTML或任意命令。

main controller按当前session generation／持钥device context捕获guard，生成独立job并在每个await之后、数据交付和显示前检查实例仍current。正常新开可替换旧预览；A的迟到结果、close、错误或onClosed仅作用A，绝不关闭／清除B。每实例最多原12MiB单文件，只放内存，不创建磁盘原件、缓存文件、业务备份或通用可读URL。

原件流程：GET当前材料record确认历史fileId和metadata → 原GET文件 → 实际bytes长度／SHA核对 → fresh HEAD匹配服务端projectRevision/materialRevision/SHA/byteLength及既有record snapshot → 建hidden独立窗口。source交付前、reveal前分别fresh HEAD+guard；显示期间每5秒非重叠HEAD复核，失败／版本变化即hide/destroy。HEAD新增内部投影保留已有 `authorizeProjectMaterialDownload` 返回契约：仅main内部 `getProjectMaterialPreviewHead` 返回精确 `{projectRevision,materialRevision,sha256,byteLength}`，拒非canonical数值／坏hash／缺头／非空HEAD正文，不新增HTTP端点或公开renderer查询能力。

client现 `onProjectMigrationContextChange` 可复用为账号／设备变化订阅，暂停／换人立即关窗，不依赖renderer自觉清理。main reload／主renderer消失／主窗关闭、材料面板关闭／换项目、child重载／关闭、过期或unresponsive都销毁本次窗口、解绑handler/timer/listener、清内存引用／可控Buffer，取消迟到显示。child同步解析不能靠其45秒Promise timer抢占，main额外50秒reveal期限及unresponsive关闭。已经呈现的像素或合法副本不能承诺远程收回。

## 独立窗口、协议与内容策略

child无preload、无Node、无业务IPC；sandbox/contextIsolation/webSecurity开启，独立随机非persist session（不共享工作台session／cookie／cache），devTools关闭。新scheme `shenyi-preview` 只声明standard/secure/supportFetchAPI，不启bypassCSP、serviceWorkers、任意文件访问；固定origin `shenyi-preview://document/`。原workspace CSP与assets保持原限制。

每窗session仅固定本地asset allowlist及两个私有route：

- `GET /source`：拒query／range／额外path／其他method；used必须在第一个await前原子占用，最多一次。调用main getSource再次核权；返回octet-stream/no-store/nosniff、ASCII编码原名／类型／SHA／长度头，不含认证或真实路径。child校验头及bytes，再构造惰性Blob传给原reader。
- `POST /reveal`：无body、最多一次，仅在child已装配预览UI后请求；main fresh核权通过才show窗口。reveal只说明窗口获准显示，不代表格式解析成功或PDF首canvas已完成；真实验收须看实际正文／像素。解析失败允许显示诚实的错误说明。

其余请求拒绝；static route只GET且无query。child CSP单独允许原组件必要self及blob script/worker/image，禁eval／外部连接／frame/object/form/navigation；协议与webRequest同时阻止HTTP(S)、WS(S)、file、其他origin和workspace scheme。拒window.open／webview／权限／浏览器下载；Blob仅允许本child origin必要读取，不放宽主窗口。

原 `AuditAttachmentPreview.open` 仅加可选 `allowDownload=false`，默认true保旧行为；false时不创建原件下载anchor／href，不能只CSS隐藏。child内只读及关闭，保存仍回workspace使用原fresh HEAD、版本复核及原子落盘链。原预览器及reader的其他专业／格式逻辑保持。

## 文件归属与验收

- controller agent：`desktop/team-client.cjs`、`desktop/project-materials-client.cjs`，新 `desktop/material-preview.cjs` 及两个client/main专项测试；不碰UI/window host/bridge/server。
- UI/host agent：main/bridge/preload/project-materials UI接线，新 `desktop/material-preview-window.cjs`、`desktop/material-preview/*`、对应window/UI测试及新strict native；不改controller、公共client、旧counter tests或旧native脚本。
- root：旧viewer可选download开关及其回归、真实旧浏览器合成预览资料来源、docs/进度/BACKLOG、旧精确计数／名单的必要兼容适配。旧其他断言不弱化。
- 独立agent：新独立安全测试、实际源与工件复核；不改产品、root的旧断言或验收标准。

以原Node24绝对路径和现有Chrome/Electron运行，无新依赖下载。先专题（含private HEAD坏头/伪造scope、GET后或解析中撤权、source双请求、A/B迟到、reload、device pause、网络/导航/下载/IPC阻断、保旧default download），再真实合法合成Office/PDF/图片／文本经原旧页面准入和导出、正常M4F登记+M4G授权导入后从workspace点击预览。核可辨认PDF颜色／页序、Office正文／缓存值、惰性HTML及SVG，记录parser限制；全部业务与原件前后不变。

关键窗口必须真实Electron测CSP/blob worker/dynamic import与实际内容，独立只读检查所有PNG、SQL及vault。相关旧native兼容和必要旧浏览器回归保持；冻结运行/测试源后原 `node scripts/test.mjs --unit --strict` 完整gate，失败／跳过及整文件排除如实。共享预览不新增资料／账号／权限或schema；需要重启时先真RO online backup并逐表核数据保持。最终仅本地提交，单列main／一键入口／线上状态，M4/完整Goal仍active。

技术依据核对于2026-11-16：[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Session](https://www.electronjs.org/docs/latest/api/session)、[Protocol](https://www.electronjs.org/docs/latest/api/protocol)；实际已安装运行时和隔离效果以本轮原生证据为准。
