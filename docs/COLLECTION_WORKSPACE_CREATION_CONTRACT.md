# M4K 正常采集工作区创建执行合同

2026-11-16，base `68c9e27dcbb9b3393a070df086a10c49650542ba`，分支 `codex/collection-workspace-creation`，TEAM-M4。上一Goal轮次为progress：M4J已本地提交并独审。开工clean，远端main060a98e／report894078b未变。1028份tracked、50,190,920字节已逐SHA备份在 `D:/codex-temp/shenyi-collection-workspace-creation-20261116/baseline/`，同级manifest。沿用codex-long-task-guard，每轮只推进本片；不重建工作区、不覆盖无关WIP。

## 已确认结果与边界

用户已确认经理／合伙人可新建、创建者管理本项目授权，并明确允许中标前先建仅资料采集工作区，中标后再按最新中标报价和原编号正式立项。本片完成正常桌面“空项目团队→创建工作区→授权／新任务→指派实习生／助理→正常上传→获独立核对权者阅读／预览→撤权”闭环，不借M4F迁入登记、可信SQL夹具或stub替代正常创建。

工作区始终标“采集工作区 · 未正式立项”，不生成quote、正式编号、合同或专业立项事实。旧formal UUID=quoteId、首次won编号／立项引用／latestwon三时点、旧UUID/CAS/冻结/原件及公式全部保持。未来正式化须另立可信来源与UUID关联合同，不静默重键、移动任务／原件、伪造won或改不可变origin；本片不称转换已经实现。Mac、客户原件上云和生产仍另验。

## 可信创建事实与权限

复用getProjectAccess团队候选（无已有project要求），最终处理器自行重核strict projectActor/currentActor与ordinaryTeamContext：有效active manager/partner、单团队历史、管理员经批准的业务兼任及无reviewer历史。junior、纯技术、停用、跨团队／复杂身份默认拒绝，不信renderer角色、creator或候选缓存。

server生成UUIDv4和当前creator，时间来自server。原team_projects只写title、active、空financial_summary和`{}`结构；同事务registerManagedProject、owner ACL、明确初始collection.read/manage/review和不可变创建记录。新建不自动给他人、材料权、任务或指派。read/manage/review精确布尔，后两者依赖read，owner不推导任何数据权。

UI三项默认均不勾选，用户逐项选择；允许all-false的owner-only治理工作区，明确提示本人不能读任务／创建任务，现M4B禁止creator事后给自己补采集权，不能暗中修成自动授予。正常闭环显式选择read/manage，review仍独立。当前密码重验与明确确认后才创建。

新增一张不可变creation/provenance表，同时承载who/when/何工作区/初始权限的创建审计和永久回执；不重建旧project_access_events CHECK。固定kind=collection-workspace，保存team/project/currentcreator、创建title、规范语义SHA（含actor/team/kind/title/三flag，不含密码／token）、requestId、createdProjectRevision和createdAt。requestId在新表全局唯一，project UUID全域防碰撞；与M4F requestId及正式provenance双向互斥。重复POST拒绝且不重复发布；foreign／不可访问请求只报通用拒绝，不回传他人元数据。SQL immutable UPDATE/DELETE guard、INSERT一致性guard和M4F反向冲突guard须实现；旧68表204DDL及旧行原样，预计69表209对象，最终按实际DDL报数。

body读取后、KDF后、BEGIN内、插入审计后最终回读均核原actor/token/lease/stamp、credential revision、identity epoch、role资格及team状态，不能只比最后角色字符串。复用原密码工作限额和技术频率限制，不设未经确认的商业配额。所有项目/sidecar/grants/创建记录原子提交；任一失败、版本耗尽、审计失败或触发器后资格／新资源事实改变全回滚。createdProjectRevision取初始化触发器后的实际安全值，不硬编码1；合法创建不撤当前会话。

新workspace在材料context及实际SQL scope统一404，即使owner或误插材料grant也不能查目录／数量、配置或使用材料read/import/review/close/maintain；UI锁定对应入口。旧registered项目行为不变。M4F不得覆盖已有workspace UUID，也不得补正式来源绕过限制；其余未接专业模块继续默认拒绝。

## HTTP与精确投影

- `POST /api/teams/:teamId/collection-workspaces`，body仅 `{requestId,title,read,manage,review,currentPassword}`；201 `{receipt}`。旧`POST .../projects`仍拒绝，不将其包装成正式立项。
- `GET /api/teams/:teamId/collection-workspaces/receipts/:requestId`，仅当前合格creator、同team、仍有效owner及active/frozen项目；`{receipt}`。foreign/未知/失权同404，archived拒绝；正常重新持钥可查，不绑定旧lease。404不证明原在途创建永远未提交。

receipt精确11键 `{requestId,teamId,projectId,kind,title,createdBy,read,manage,review,createdProjectRevision,createdAt}`，为不可变创建时事实，不能充当当前权限。创建／查回执后都fresh GET项目。title严格1..300码点、trim、拒Cc/Cf/坏Unicode，不静默截断；同名允许不同UUID，不能用名称代替幂等。query/method/origin/HEAD沿中央边界；不新增bootstrap、通用SQL/URL或伪身份入口。

旧ProjectView精确8键不变；仅新工作区使用精确9键，额外`kind:'collection-workspace'`，其他kind/额外字段拒绝。列表与详情保持同scope。旧缺kind显示“既有登记项目”，不能凭旧sidecar或fixture推断已正式立项；active/frozen与kind正交。

## 桌面：107→109窄RPC，20form／25密码

- `createCollectionWorkspace({requestId,teamId,title,read,manage,review,currentPassword,confirmed:true})` → `shenyi:collection-workspace-create`。成功 `{status:'created',receipt}`；实际可能发出后结果不明 `{status:'unknown',requestId}`。
- `getCollectionWorkspaceReceipt({teamId,requestId})` → `shenyi:collection-workspace-receipt`，返回receipt。

ID与布尔/确认精确校验；main-only beforeSend/assertCurrent/onDispatch沿现client机制，不暴露回调给renderer。requestId为发送前公开的lowercase UUIDv4；main单发锁和已用ID集合，unknown只GET不POST重放。错误密码等确定拒绝可由用户显式重新尝试新操作；不能把unknown/404当作失败自动换ID。

关闭／重开面板在同actor/team保留pending/unknown锁与查询编号，已发提交不冒充取消。换actor/device先清密码、旧内容和DOM，再按捕获上下文处理迟到结果／401，不清后来账号；不将他人未知请求信息显示给新账号。重登录后可用本人保存的查询编号手动只读查询，不自动重放。密码／确认在提交后和关闭／换team／身份变更时清除；JS字符串不承诺绝对擦除。

沿web-design-engineer Extension和desktop/brand-spec.md，只在现项目panel增加创建form、三checkbox、当前密码、明确确认、公开查询ID与只读查询。成功但刷新失败应说明“已创建，请刷新”，不能鼓励重复创建。创建标识、receipt初始权限与当前项目能力分别展示；整体UI升级仍归M6。

## 分工与结束验证

- server agent独占新workspace schema／低层facts policy／API、database/application接线、project policy的kind投影及材料context/SQL拒绝、新server核心测试；不改client/UI/旧counter tests。低层kind模块不得循环import project-access-policy。
- root独占team-client的新严格方法／ProjectView union、必要新main manager、bridge/preload、新client/main/entry测试、文档/进度/BACKLOG及旧109/20/25与69/209准确兼容；实际计数变化按最终DDL，不弱化旧业务断言。
- UI agent独占team-ui.js/index/newUI专项及新strict Windows native，先正常创建happy path，后未知单POST/回执、权限与数据保持；不能用审批迁入或直接调用创建API替代主路径。
- 独立agent独占新安全验收，真实SQL/strict client跨team/role/creator/nonce、KDF/lease/资格ABA、审计后回滚、回执越权、材料冒充formal与旧8键；实际原生工件和最终scope/index另审。不改产品或root验收脚本。

先直接相关专题，后候选冻结、正常Windows实际创建→任务→上传→独立核对预览及撤权、COMMIT丢回复仅1POST/恢复仅GET；截图、真实SQLite/OSvault/原件SHA及主动授权事件逐项对应。旧相关创建/授权/材料/预览/导出与身份撤销按影响验证。最后原Node24 `node scripts/test.mjs --unit --strict`完整gate，失败/skip/粗排除如实，已绿且无新疑点不重复扩大。

共享预览升级前真RO在线备份，保持全部旧68表204DDL和typed行、9/16账号、两UUID，新表为空，无自动owner/项目/资料/grants或真实客户。仅本地提交；单列main／一键／线上，M4和整个Goal继续active。所有失败源／日志保留，三次同路径失败重审前提，不循环或弱化验收。
