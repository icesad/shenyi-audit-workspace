# M4G 团队资料清单模块

2026-11-16，base `d9c2f00`，分支 `codex/team-materials-module`，关联 TEAM-M4。424份拟改旧文件已备份 `D:/codex-temp/shenyi-team-materials-20261116/baseline/`，manifest 同级。按长任务保护执行，唯一实现里程碑仍 M4。

## 已确认授权与本片结果

用户本轮明确批准：项目负责人可以验证密码后逐项为自己及本项目有效经理／合伙人配置资料清单权限；身份、职级和 owner 本身不自动有资料权限。关门／重开与核对权限分开，可单独授予经理／合伙人。历史 reviewer 姓名不映射当前账号。

本片必须实现正常桌面闭环：owner 明确授权 → 同 UUID 的旧 M4D 正式资料保全包首次导入 → 获权人员查看完整旧清单、历史及原件 → 复用原 `AuditChecklist.apply/gate` 核对、关门、重开 → 撤权／暂停／换账号后拒绝后续业务、挂起保存零发布。不得以只存包、只备份或只有 SQL 夹具授权代替可用模块。

不修改原专业规则、模板、编号或旧本机库；不自动转换成 task/submission、指派或签发；不接新项目创建路径。首片不提供团队清单换代、模板编辑、附件新增／移除或将新采集提交自动并入旧叶节点，这些后续按同一模块推进。真实客户来源／原件上云仍需单独授权，目前只用隔离合成数据验收。Mac、生产与真人选择器分层保留。

## 独立权限与失效

四个布尔权限 `read,import,review,close` 存独立项目材料 ACL。read 包括完整清单、全部事件和全部历史引用原件（含 removed／旧 generation）；后三项均要求 read。close **不要求 review**，反之亦然。collection 的既有三项权限不扩大，project.migrate 产品审核权不继承材料权；纯技术身份、六类审核身份历史、junior 均不能获得本模块数据。

有效 project.owner 管配置，允许明确 self，均用当前密码、memberRevision、grantRevision、projectRevision CAS；管理配置不等于读取数据，未获 read 的 owner 不下发 record、原件、数量或 hasRecord。候选仅本团队合格 senior，复用普通业务资格、管理员兼任批准、单历史团队及审核身份保护。role／member／account／兼任撤回等失效必须让旧材料 grants 不自动复活；正常改密／换机不永久丢已批准权限。ACL 变更记录当前可信 actor，并递增项目版本与目标 grant 版本；不得为 self 授权无意撤销本次合法设备会话。

active 项目可获权变更；frozen 可获权读已有资料和原件，拒绝 ACL／导入／核对／关门／重开；archived 全拒。旧 record.closed 不映射 team frozen。所有异步边界、KDF、最终事务和下载发布前重核 actor/device、当前资格、模块 ACL 与项目版本，权限 ABA／MAX／回滚不得放行。

## 原始记录、文件与正文准入

- 仅 M4F 已审核登记、UUID 相同、正式 namespace、非 TRIAL、材料区空的目标可首次导入。旧名称／事务所文字是历史快照，展示新旧项目名，不根据名称猜团队，不改旧文字或因改名重新编号。
- 完整保留原 `record.json` 的字段、原 revision、schema1/2、generation、closed、全部事件及历史原件 UUID／元数据／字节；原始导入 record 独立不可变保存。当前 record 初始与其一致，后续仅由原 `A.apply` 产生变化；另有服务端 materialRevision，不能重置旧 revision 或向旧记录塞入“迁入”专业事件。
- 当前导入／核对账号 ID 写独立模块审计，原自由 reviewer 仅历史文字。新 `A.apply` 的 reviewer 由服务端当前账号的安全显示名称提供；请求不能传 reviewer、record、nodes、tree、任意 command 或历史身份映射。
- `MaterialPreservation.inspect` 仅包结构／CRC／SHA，不等于正文准入。服务端必须对 **每份** 原件（包括 removed／旧代）执行与旧 restore 同一 `preparedFile`，核 name/type/size/hash 及合法正文，完整原子发布。root 负责将旧 private preparedFile 最小导出并注入 DOMParser，旧 browser 调用行为不变；Node adapter 使用已锁定 jsdom 30.1.3 的 DOMParser，晋为运行依赖，不新增版本，不执行脚本／外部资源。
- 保留原包 180MiB、record 24MiB、原件累计150MiB／5000份、单原件12MiB上限，不缩小旧合法包以绕开传输。17MiB设备请求限制不放宽；内部按1MiB分块传输，单块 base64 JSON 小于原限制。

## 服务数据与传输

服务端材料记录／历史原件／ACL／模块事件／导入staging独立存储，所有键带 team/project。不可跨团队去重或生成共享下载URL。保留导入的原 record 与 SHA、包 SHA、原 revision、当前 materialRevision；事件含可信 actor、操作、前后版本、requestId／来源hash，不记密码或原件全文。

staging 只属当前发起 actor、设备/lease、目标版本和包 SHA，不可读出块；最多每账号一个未完 staging、总声明包额不超过360MiB，TTL30分钟。开始、每块、最终提交均重核模块权／目标空态；每块验证 canonical base64、index、SHA、精确长度，重复相同块可安全确认，冲突块拒绝。取消只清本次未发布临时数据，失联未清如实报告并由TTL清理；不能删除已发布资料。严格租户scope先于业务读取/计数/游标。

内部 HTTP 根 `M=/api/teams/:teamId/projects/:projectId/materials`：

| route | 契约 |
|---|---|
| GET `M/access` | `{projectRevision,canManageAccess,read,import,review,close}`；只有治理／已见项目的合格senior可读能力，未获read不含hasRecord或业务计数 |
| GET `M/members?q=&after=&limit=` | owner；`{members:[{id,displayName,role,memberRevision,grantRevision,read,import,review,close}],hasMore}`；含self，q80／默认20／max50／scope cursor |
| POST `M/access` | `{projectRevision,userId,memberRevision,grantRevision,read,import,review,close,currentPassword}` → `{changed:true,projectRevision}` |
| GET `M` | read；`{projectId,projectRevision,materialRevision,recordSha256,record,packageSha256,importedAt,importedBy:{id,displayName}}`；空区 materialRevision0、record/hash/package/import字段null。最大 JSON 26MiB，仅此内部请求可提高接收上限 |
| POST `M/imports` | read+import+active；`{requestId,projectRevision,packageSha256,byteLength,chunkCount}` → `{requestId,chunkBytes:1048576,expiresAt}`；requestId UUID |
| PUT `M/imports/:requestId/chunks/:index` | `{sha256,data}` → `{requestId,index,received:true}`，数据为该块base64 |
| DELETE `M/imports/:requestId` | 当前发起账号可取消自己的未发布stage，不能取消已发布对象；`{canceled:true}` |
| POST `M/imports/:requestId/commit` | `{projectRevision,currentPassword}`；完整服务端检查／KDF后同事务发布record、全部原件、审计、回执并消费stage；重复发布409 |
| POST `M/actions` | `{requestId,projectRevision,materialRevision,recordSha256,action,currentPassword}`；action仅下述union；item 的 currentPassword=null，close/reopen须当前密码 |
| GET `M/receipts/:requestId` | 发起人当前read+同项目，最小回执，不自动重发；404不证明在途提交最终失败 |
| GET/HEAD `M/files/:fileId` | 当前read，同项目历史真实fileId；HEAD不读BLOB且任意状态无body；GET核实际bytes/SHA并附件响应，不执行内容 |

成功导入及动作回执统一 `{requestId,kind:'import'|'item'|'close'|'reopen',projectId,projectRevision,materialRevision,recordSha256,packageSha256,sourceRecordRevision,recordRevision,committedAt}`。sourceRecordRevision 始终固定原导入版本；recordRevision 是当前 A.apply 后的原模型版本，materialRevision 是独立服务 CAS 版本。未知提交只 GET 原回执，不重放 mutation；事务失败不得残留半份业务资料。无新公开一般项目创建或重归属接口。

## 原有核对／关门规则

action精确union：`{type:'item',id,status,evidence,reason}`、`{type:'close'}`、`{type:'reopen',reason}`。status沿原五种 pending/received/confirmed/na/problem，evidence/reason沿原1000字规则；confirmed 必须证据、na/problem 必须理由等全部由现 `A.apply/gate` 强制。item需read+review；close/reopen需read+close及密码，closure独立于review。closed禁item，关门须原gate.ready，重开须非空理由，均保原历史。客户端仅提交变化，不提交自由reviewer或完整record。每次均用 materialRevision+recordSha256+projectRevision CAS，绑定请求语义requestId，专用事件把新旧source eventNo与真实actor关联；原件bytes不变。

## 桌面十个窄接口

`getProjectMaterialAccess`、`listProjectMaterialMembers`、`changeProjectMaterialAccess`、`chooseProjectMaterialImport`、`discardProjectMaterialImport`、`importProjectMaterials`、`getProjectMaterialReceipt`、`getProjectMaterials`、`downloadProjectMaterial`、`changeProjectMaterials`。channel统一 `shenyi:project-material-` 后缀 `access,members,access-change,import-open,import-discard,import,receipt,record,download,change`；88→98窄RPC。无通用URL/SQL/签名/文件路径接口。

前三及GET record输入对应HTTP，主进程精确字段；permission/import/action确认多带 `confirmed:true` 仅main校验。choose输入 `{teamId,projectId,projectRevision}` 返回 `{canceled:true}` 或 `{handle,sha256,summary}`，summary复用M4D且仅当前获import权者可取。handle为main产生UUID/requestId，包与路径只存main；discard `{handle}`；import `{handle,teamId,projectId,projectRevision,sourceSha256,currentPassword,confirmed:true}`。main编排stage/chunks/commit，一个handle只一次可能提交；成功 `{status:'committed',receipt}`，可能已发但丢结果 `{status:'unknown',requestId}`，发出前公开查询ID。

change输入 `{teamId,projectId,requestId,projectRevision,materialRevision,recordSha256,action,currentPassword,confirmed:true}`，requestId为界面发送前生成且显示的UUID，main核ID并锁单发；成功/unknown同上。getReceipt输入 `{teamId,projectId,requestId}`；download输入 `{teamId,projectId,fileId}`；record只对获read者进入renderer，按原层级/五状态、原历史与旧身份声明显示，不执行HTML。UI可分页显示树/历史，不能给junior先下整树再过滤。

source取消、面板关闭、换actor/device、权限失效均清私有来源与旧正文，迟到401先核原上下文、不清新账号；未知写不能假称取消。discard 也允许 `{handle:null}`，仅取消当前尚未返回handle的选择／本次私有来源，不取消已发commit；返回 `{discarded:true,stageCanceled:boolean|null}` 如实说明本次未发布分块清理结果。到期stage不可续用；若仅后续请求触发物理清理，不承诺精确30分钟物理删除。

现设备gate每分钟120请求保持，main 分块按每分钟不超过80块节流，留心跳与控制请求余量；不在每块另发冗余能力GET，服务端每块仍fresh鉴权，main每边界核本地guard。材料-only读者可以在原项目选择器发现其获权项目，但原ProjectView八字段及canRead/canReview继续只表示collection，不因材料权冒充采集权。

下载main取真实GET核hash→OS Save→fresh HEAD/同scope版本→自有temp完整写/sync→guard原子发布，保旧目标；撤权/暂停/换人零发布，清理失败如实。旧主工作台CSP不放宽、不执行原件，不自动打开外部程序；完整Office内嵌预览后续以受限窗口单独推进。

## 分工与阶段验收

server agent独占 server/team（含schema/app接线、ACL失效与staging/action）及其新tests；UI agent独占desktop产品、新tests及新strict native；root独占旧preparedFile最小DI、Node admission adapter/相关tests、package/lock及docs、旧验收计数／名单窄适配。独立agent做权限/正文/真实工件验收，不改产品或旧断言。

先完成同源正文准入和schema/API/正常UI专题，再独立对抗及严格Windows真实旧包→M4F正常审批→self/他人材料授权→导入→树/历史/原件逐byte→核对／close/reopen→撤权挂起保存0发布。另测v1/v2、closed/prior/removed、坏正文/MIME/Office宏、crossscope/ABA/CAS/大包分片/回滚/unknown单发。旧schema/全部行与合法原件保持，共享预览升级前真RO在线备份。

所有运行/测试源最终固定后再跑原 `node scripts/test.mjs --unit --strict`，源码hash前后保持、失败及跳过如实；浏览器、原生、数据和纯测试分层。关键结果独审后本地提交，保明示未进main／未push／未上线；不得把本片或整个商业化Goal记complete。
