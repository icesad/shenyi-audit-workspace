# M4J 采集提交原件软件内预览执行合同

2026-11-16，base `dc3d57f60a4cb7ca9f785ade308e0f4ec9a79452`，分支 `codex/task-submission-preview`，关联TEAM-M4。上一轮为progress：M4I已本地提交并独审。开工clean，远端main060a98e／report894078b不变；1020份tracked原版、50,040,655字节逐SHA备份在 `D:/codex-temp/shenyi-task-submission-preview-20261116/baseline/`，同级manifest。继续codex-long-task-guard；不重建工作区。

## 结果与范围

正常员工从本人提交历史、经理／合伙人从项目资料核对列表点击原件预览，直接阅读正文。权限完全沿原下载：本人提交＋当前任务范围＋有效附件grant，或具体项目read＋review；owner/manage/技术身份/材料read不能替代。历史可见不等于可下载。frozen按原读取规则、archived拒绝；材料closed不参与本链。

不新增HTTP、schema、ACL或专业状态，不关联材料清单，不写盘、不核对或签发。原件、UUID、任务与资料记录保持。正常创建路径本轮已获产品负责人答复：允许中标前先采集工作区，中标后再正式立项；下一单项接创建。本片仍不开放创建、不伪造报价／正式编号或信任客户端JSON。Mac、真实客户及生产另验。

采用web-design-engineer的Extension，沿desktop/brand-spec.md、真实logo和现按钮布局，只补两处预览／精确关闭／加载错误反馈。完整视觉升级仍归M6。

## 精确接口：104→107，19form／24密码不变

- `previewTaskSubmission({requestId,teamId,taskId,revision,submissionId})` → `shenyi:task-submission-preview`。
- `previewProjectSubmission({requestId,teamId,projectId,projectRevision,taskId,revision,submissionId})` → `shenyi:project-submission-preview`。
- `closeTaskSubmissionPreview({previewId})` → `shenyi:task-submission-preview-close`。

requestId／previewId为发送前canonical lowercase UUIDv4；其他ID沿旧opaque ID。revision当前已显示task安全非负整数，projectRevision当前project安全正整数。主frame／exact APP_URL／sender和精确keys强制；renderer不送attachmentId、user、角色、SHA、bytes、URL、路径或HTML。open只回 `{opened:true,previewId:requestId,filename,byteLength}`，close只回 `{closed:boolean}`；旧A不能关新B。

## main真实来源与生命周期

复用既有8个client接点：guardSession／context订阅、两种单选export-plan、两种GET、两种HEAD。plan绑定当前own user或project范围、task/project版本、submission／attachment／name／长度／SHA。单ID计划→GET实际bytes并核SHA/1..12MiB→原HEAD＋fresh同plan.sha256→hidden阅读窗口；旧HEAD没有完整hash／版本头，不仿造材料HEAD投影、不改旧DTO。

source交付前、reveal前及展示期间每5秒非重叠执行HEAD＋fresh同计划，检查完整计划SHA、当前版本和actor/device generation。每次await后及显示前核current job；失权、改派、撤附件grant、项目read/review撤销、角色／成员失效、版本变化、网络错误立即清本次显示。权限ABA沿原服务端版本及会话撤销，不用renderer角色或客户端时钟放行。

own/project共用一个current job和进程内已用requestId集合。初始guard必须先于占用ID、关旧窗；A迟到响应／错误／onClosed只作用A。可控Buffer清零、引用清除，仅内存，不创建文件／缓存／持久URL。type固定application/octet-stream，按原reader扩展名识别，不用材料准入改采集原件。0字节诚实提示无法预览，原下载／导出语义不变。

原样复用material-preview-window.cjs及reader assets：一次source/reveal、随机非persist session、无preload/Node/业务IPC、CSP/导航/外连/下载/DevTools拒绝；宏／HTML惰性、公式仅缓存，格式精度限制保留。controller的50秒未reveal截止与host不响应销毁保持。

主workspace最多一个阅读child，task与material打开时互关另一manager，但不误清无关上传来源。主窗导航／reload／renderer消失／关闭销毁两类manager；本人换任务、项目面板关／换项目／换任务、session清除／device暂停关捕获的本次preview，旧exact close不能碰后来任务或材料窗口。已显示像素及合法副本不能承诺远程收回。

## 分工与结束验证

- controller agent独占新task-submission-preview.cjs、必要最小team-client helper、新controller/client测试；不改server/bridge/preload/UI/host。
- UI agent独占team-ui.js/index两正常入口、新UI测试和strict Windows native；不改controller或root桥接。先给原生场景／数据保全计划，再运行；不直接注入preview API代替用户点击。
- root独占bridge/preload、文档/进度/BACKLOG和旧107精确计数／名单适配；104旧方法及其他断言保持，不改验收标准求绿。
- 独立agent做新增权限／生命周期对抗与源码、实际原生工件复核，不改产品或root旧断言。

先直接相关Node24专题，覆盖own/他人/改派/撤grant、senior权限组合、伪造scope、SHA/长度/空件、GET/source/reveal挂起后失权、版本ABA和A/B迟到；复用原host测试，不重做无新疑点的全部格式。真实Windows从正常UI展示合法合成Office/PDF与惰性标记，撤权／暂停关窗，无新文件、业务和原件保持；故意撤权的ACL/audit单列。失败源码／日志留存，连续同路径三次失败重审。

冻结后原 `node scripts/test.mjs --unit --strict` 完整gate，实际选入／粗排除、失败／skip如实。旧相关原生默认、项目核对、任务导出、材料预览／维护按影响验证，不自动重跑全部历史原生。若升级共享预览，先真RO在线备份并保持68表／204DDL、全部行、账号和UUID，不自动增权。最后仅本地提交，单列main／一键／线上；M4/完整Goal继续active。
