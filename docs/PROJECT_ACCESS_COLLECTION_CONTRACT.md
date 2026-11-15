# 项目授权与资料核对（M4B）执行合同

2026-11-15，base `f390502`，关联 `TEAM-M4`。用户已确认经理/合伙人均可创建项目、创建者管理本项目授权。旧版正式立项仅来自最新中标报价；是否允许先建采集工作区的选择仍在等待答复。**答复前只实现共同需要的项目授权/资料核对边界，不实现或启用新建采集工作区，不改旧立项。**

本片沿正常strict设备客户端/服务端、合成隔离库，保留全部旧UUID/CAS/冻结/原件/模板/公式/业务编号语义，不加载或迁移旧dist数据。正式报价中标来源、立项和专业签发不是本片新增的权限事实。

## 可信模型与权限

1. 新增项目授权sidecar、独立ACL和审计三表，旧51表/89定义和全部旧行不改；sidecar只由可信未来项目创建/来源验证流程登记，当前测试可显式登记合成项目，不自动从旧seed或created_by猜归属。共用server-only `registerManagedProject`，无公开登记/重归属/补owner接口。
2. `team_project_access_projects`以(team_id,project_id)关联真实project，immutable created_by/created_at以及可空的创建request_id/request_sha256，revision为服务端安全整数。不可改归属、creator或删sidecar重建；不把revision触发器当作创建sidecar。正式起项目路径未来复用此授权模型。
3. `team_project_access_grants`仅含`project.owner`/`collection.review`、status/revision，FK同时绑sidecar和本team membership。owner只能为immutable creator，禁止误授其他user；历史creator永远不是授权predicate，只有当前有效owner ACL＋当前manager/partner资格才可管理本项目授权。read/manage继续显式保存到原`team_project_grants`两行，owner不推断read/manage/review；初始化如需自带这三项必须明确插行，不能改旧scope谓词。
4. 本片处理当前有效、全历史一个team membership、无任何operator或四类reviewer历史的普通manager/partner；不凭技术管理员、付款身份、自由姓名或客户端role放行。管理员兼业务role的owner审核后续单独接入。junior始终仅走本人指派任务，不得见project目录、manager候选或他人历史。
5. 可见项目目录仅当前team＋上述senior资格＋显式read或有效owner交集，只读最小字段。任务列表/核对原件还必须read；review须read＋独立review ACL，manage不推review、review不推manage，不添加旧attachment grant、不扩旧本人history端点。
6. 授权创建者只可编辑本team其他有效普通manager/partner的read/manage/review。manage或review为true必须read=true；禁止self、owner转移、自授恢复、技术/特权/复杂/停用/跨team目标。target身份epoch和project revision参与CAS。所有高风险授权变更重新验证当前owner密码；body/KDF/txn重查actor、lease、credential、owner/grants、project状态/revision及target身份，观察ABA。
7. read=false称“撤销该员工的项目采集访问”：撤其该project read/manage/review及任何无效owner ACL，项目内有效assignment和attachment grants一并撤销、受影响task版本去重一次。不可清其其他project grant/owner或原件。每次实际权限变化撤target所有旧session/lease及未用device proof，避免旧legacy在途body在撤后重授时复活；原绑定、凭据/phone/wechat映射和其它项目授权事实保留。noop409，未知结果不自动重放。
8. M4A调职及成员停用必须同事务撤该员工新owner/review ACL，保留creator史；正常改密/同user换机不永久丢owner，不把持久ACL绑创建时identity epoch。其它有效成员已提交的project grants保持，不连坐。所有新mutation在最终事务重查其本人当前权限及project revision；既有合法任务操作仍按原policy。不提供孤儿owner自动恢复或所有权转移。
9. 新ACL及旧project grants的INSERT/UPDATE/DELETE、已有project状态/元数据UPDATE用仅命中新sidecar的revision触发器记录ABA。不能改旧表定义、改变无sidecar旧项目的row，触发器不得自动创建sidecar；creator/归属immutable guard单列。使用整数TEXT读取、前后safe/MAX复核；全部ACL、assignment/task CAS、session/lease撤销和审计原子，任何版本耗尽/审计失败全回滚。

## API、投影与任务

所有新增API处理器自身再核真实currentDeviceLease与中央strict deviceContext，关闭全局deviceProof的旧诊断也不能使用。Origin/HEAD/异常走application统一边界，不新增bootstrap。不存在/未授权对象同404；query精确单值、字面搜索、scope先于cursor/分页/count。最小ID继续沿现ID规则，未来新project/task必须server UUIDv4，不改旧opaque ID。

| 接口 | 合同 |
|---|---|
| `GET /api/auth/project-access` | `{teams:[{teamId,teamName}]}`，只返回本人有效senior团队，最多50，无项目全貌 |
| `GET /api/teams/:teamId/projects?q=&after=&limit=` | `{projects:[ProjectView],hasMore}`，q最多100、limit1..50默认20；cursor须在同scope/query内 |
| `GET /api/teams/:teamId/projects/:projectId` | `{project:ProjectView}`；ProjectView仅 `{id,title,status,revision,canRead,canManageAccess,canCreateTask,canReview}`，canRead独立表示任务读取，不能从manage/review推断，owner-only治理不授read。title保留最多300字符，不套姓名80上限；active/frozen可读，archived拒；frozen或revision耗尽时所有mutation能力关闭 |
| `GET /api/teams/:teamId/projects/:projectId/members?q=&after=&limit=` | owner-only，本team当前可选普通senior，q80/limit1..50；`{members:[{id,displayName,role,status,revision,read,manage,review}],hasMore}`，含未授权候选，但不泄露其他team/角色/手机号 |
| `POST /api/teams/:teamId/projects/:projectId/access` | body仅 `{revision,userId,memberRevision,read,manage,review,currentPassword}`；成功 `{changed:true,revision}`实际新project版本 |
| `GET /api/teams/:teamId/projects/:projectId/tasks?q=&after=&limit=` | read-only scope，`{tasks:[{id,title,instructions,status,revision}],hasMore}`；q100/limit1..50，task当前只读投影与原字段不变 |
| `POST /api/teams/:teamId/projects/:projectId/tasks` | read＋manage＋active；body仅 `{revision,title,instructions}`，title1..160字符trim且拒控制/隐形字符；instructions0..4000字符允许常规CR/LF/Tab并保留原文/缩进，拒其它Cc/Cf。server UUID新task/open/版本0/无assignment，project版本递增，返回 `{task:{id,title,instructions,status,revision:0},revision}`。本人指派、上传/退回复用现有API，不自动生成专业程序 |

共同处理器export `handleProjectAccessRequest`。server-only登记helper无HTTP/RPC公开；候选起项目路径未答前不新增POST projects创建路由，调用须404，不在normal shared demo自动登记sidecar。

## 独立的资料核对出口

root负责`project-review-api.mjs`，共用project policy的strict actor、scope和project权限，避免另造授权源。

- `GET /api/teams/:teamId/projects/:projectId/tasks/:taskId/submissions?after=&limit=`：read＋review且project active/frozen，实际project/task/submission/attachment同scope；`{submissions:[{id,attachmentId,filename,sha256,byteLength,createdAt,submittedBy:{id,displayName}}],hasMore}`，最多50默认20，先scope再cursor/limit，不返回phone、路径、secret或原件全文。
- `GET/HEAD /api/teams/:teamId/projects/:projectId/tasks/:taskId/submissions/:submissionId/file`：同一个fresh scope，不能用仅manage、旧attachment grant或猜ID代替。HEAD不读取blob、任何结果body为空；GET返回原始bytes及安全文件名/private headers，不改原件。新客户端保存前再fresh HEAD＋同actor/device guard，撤review/移出/降级/停用/换机/断网/切账号后的挂起保存0写盘。旧本人submission与GET/HEAD语义保持。
- 这是查看与人工核对采集资料，不新增“审计通过”/专业签发动作或自动核对意见。

## 客户端公共合同

已确认的共同方法如下，prefix IPC `shenyi:`，主frame/来源和精确keys校验。当前67项加9项为76窄RPC；新增创建路径若获确认必须再冻结其合同与计数，不把无参数成功循环误套需参数操作。

| main/preload方法 | channel |
|---|---|
| `getProjectAccess()` | `project-access` |
| `listProjects({teamId,q?,after?,limit?})` | `projects` |
| `getProject({teamId,projectId})` | `project` |
| `listProjectMembers({teamId,projectId,q?,after?,limit?})` | `project-members` |
| `changeProjectAccess({teamId,projectId,revision,userId,memberRevision,read,manage,review,currentPassword,confirmed:true})` | `project-access-change` |
| `listProjectTasks({teamId,projectId,q?,after?,limit?})` | `project-tasks` |
| `createProjectTask({teamId,projectId,revision,title,instructions,confirmed:true})` | `project-task-create` |
| `listProjectSubmissions({teamId,projectId,taskId,after?,limit?})` | `project-submissions` |
| `downloadProjectSubmission({teamId,projectId,taskId,submissionId})` | `project-submission-download` |

`confirmed:true`仅main验证，不进HTTP。下载client的`getProjectSubmissionFile`/`authorizeProjectSubmissionDownload`是main-only，不通过preload公开；公共download由bridge组合受控Save dialog/原件GET/HEAD/写盘。不得暴露通用签名、SQL、URL或路径。

UI按既有extension方向，只有ready＋server teams可打开独立项目面板；list/detail/授权/任务/核对按服务端boolean显示。共同新增授权form（一个password）及task-create form，总13form/19秘密；所有actor/device/team/project/task/read代次在迟到401前核对、关闭/重开mutation锁保留、清秘密及旧原件字节，不清后来账号。unknown无自动重发，确认提交后刷新失败分清，旧server/缺方法failclosed。正常无sidecar事实时不得冒充已有项目可管理。

## 验收和待确认部分

结束证据包含实际SQLite/API跨team/project/role/owner/附件/搜索分页/统计，owner降升/停用不复活、正常改密/换机不误丢owner，owner/权限/冻结ABA、KDF/body/BEGIN、MAX/audit/taskCAS全回滚；授权变化拦旧collection在途写/GET→HEAD保存与未知结果不重放，原件/身份/UUID/旧schema/其他成员保持。common可用明确合成可信登记的项目验证，不把它当正常创建入口。

用户若确认允许先建采集工作区，再追加创建及幂等协议，并跑真实Windows“经理创建→授权→新task→junior上传→scoped review/合法副本→撤权0write”。若未答，本轮只交共同授权/核对候选，创建待决策，完整Goal继续；不得把旧本机won quote或合成登记当新建功能已经实现。普通9/review14共享库不增加owner、ACL、项目/任务或新账号，只做空schema升级及全部旧行/DDL保全。Mac/真实身份/跨电脑/生产与正式立项另留。
