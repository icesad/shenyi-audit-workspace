# 管理员兼任业务职级审核（M4C）执行合同

2026-11-15，从`fe5901c`接续`TEAM-M4`。上一Goal回合是progress：M4B实际代码、2202项回归、原生/保全验收和本地提交完成。当前同checkout新分支`codex/administrator-business-role-review`，234份旧源/测试/文档先备份`D:/codex-temp/shenyi-administrator-business-20261115/baseline/`。

## 结果与边界

用户已确认：团队管理员管理本团队普通员工四职级；管理员本人兼任业务职级由产品负责人审核。此次补齐后者，采用负责人在独立审核名单核对管理员、当前密码和明确确认后直接核准，不增加尚未要求的申请队列。管理员不能自授，原四类开通/恢复/停用/换机审核权不能替代本审核权。

可核准intern/assistant/manager/partner，或明确选择`role:null`收回业务兼任而保留技术管理员身份。核准后仍不赠任何项目/任务/附件/邀请或专业签发权。获批junior管理员须被明确指派才能采集；获批senior管理员仍逐项目授read/manage/review。技术管理与业务职级两轴独立，不能出现低职级一经批准便丢技术管理，或高职级虽存入数据库但所有项目接口仍拒绝的伪闭环。

正式项目创建政策仍待用户答复；本轮不实现项目创建、不改旧中标报价/专业编号/布局/模板/UUID/CAS/冻结/原件，不自动迁移旧资料、不push/main/部署或购买/发送消息。M4及完整Goal保持进行。

## 身份与持久事实

- 新独立审核权`administrator.business-role`，仅可信bootstrap/隔离演示可设；无公开自授接口。新增第五审核者的所有历史记录均参与旧恢复/停用/换机/普通职级/项目身份保护，其本人仍需独立人工bootstrap恢复，不降到teamadmin流程。
- 审核目标是当前有效账号/凭据/团队、全历史恰一有效本团队administrator operator、全历史最多一个同团队membership、无任何五类审核者历史，且不是审核者本人。查目标不能调用`canOperateTeam`形成无批准事实便不能审核的死锁；当前结构合格的未审核/失效混合身份可由负责人明确重新核准，不能自动采用旧membership作批准。
- 当前审批sidecar与membership精确匹配。role enum须membership active且role一致；role null须保留同team disabled membership历史，不能删除历史。纯技术管理员从未有membership时null是无变化409。sidecar status active是当前有效批准事实，包括null；revoked/missing/mismatch不能放行业务或恢复受限技术权限。
- 普通业务身份沿既有规则；operator兼任必须通过统一SQL/JS eligibility，不能只放宽某个列表。对有membership的技术operator，只有精确有效批准可使用技术管理；纯技术管理员无membership仍保留原行为。业务读取与账号投影、旧任务候选/指派、新项目actor/recipient/注册者/查询、提交与GET/HEAD均按同一资格执行。新项目senior仍保持普通身份的单team及无审核者历史约束。
- operator、membership、account或team资格发生实际变化/删除/重建时触发审批失效，撤后同值恢复不复活。正常密码、手机号、微信或设备变更不永久撤销已完成批准；永久批准不绑定旧identityEpoch/password/device或审核者未来会话。审核时snapshot/epoch仅保护在途动作。
- 新增三表：独立reviewer、当前审批sidecar、专用audit。需要的固定索引/失效与epoch触发器数以实际schema/迁移验证为准；旧54表/105定义和行升级保持，仅review专用合成审核者按显式demo流程增加至15，ordinary仍9，不给共享账号自动membership、批准或业务scope。

## 原子审核与撤权

处理器自身要求正常strict设备context/current lease。body读取前后、密码KDF后、最终BEGIN内重查同一个actor/token/lease、审核权及凭据stamp、目标结构/身份epoch/membership/sidecar，不只比较可回改的role。SQL范围先于搜索、cursor和LIMIT；非授权目标与不存在统一404。

body只收`revision,role,currentPassword`，CAS revision为可信目标identity epoch。有效批准下同role是409；未审批/失效混合身份同role的新明确批准有实际状态变化，可执行。首次role批准创建membership；其他批准调整或启停同一membership。事务先变membership、撤旧scope，最后发布精确新批准；不能在触发器失效之前发布。

复用M4A撤旧访问机制：清目标本团队任务assignment、project/attachment/admin grants及M4B owner/review、旧session/lease/未用device proof，实际撤assignment逐task版本只增加一次；失效三路未完成邀请及激活挑战、SMS、ready微信、pending/approved恢复/换机及未用挑战。作为审核者发出的旧proof通过actor epoch失效，不因降升和重授旧grant复活。保留技术operator、账号/凭据/phone/WeChat mapping、绑定/key、其他成员/项目合法scope、原件/提交历史/合法副本。

role、审批sidecar、全部撤销、task CAS、实际新epoch及audit同事务。任一MAX、安全整数、CAS、审计或约束失败全部回滚；不假定epoch固定增量。收回兼任后技术管理仍可用，业务全拒；重新核准后业务scope仍须重新授予。

## 接口、客户端与归属

| HTTP | 精确输入/输出 |
|---|---|
| `GET /api/auth/administrator-business-role/access` | `{canReview:boolean}` |
| `GET /api/administrator-business-roles?q=&after=&limit=` | `{members:[{id,displayName,teamId,teamName,role,status,revision,approvalStatus}],hasMore}`；status固定active，role nullable，approvalStatus为unreviewed/approved/withdrawn/invalidated；默认20、最多50、80字符字面搜索及scoped cursor |
| `POST /api/administrator-business-roles/:userId` | `{revision,role,currentPassword}`；成功`{changed:true,role,revision}`；team由目标可信结构取得 |

3个窄RPC：`getAdministratorBusinessRoleAccess()`→`administrator-business-role-access`，`listAdministratorBusinessRoles({q?,after?,limit?})`→`administrator-business-roles`，`changeAdministratorBusinessRole({userId,revision,role,currentPassword,confirmed:true})`→`administrator-business-role-change`。main仅校验确认，不把confirmed发HTTP。总79RPC、14form/20密码输入；无raw URL/SQL/令牌/私有stamp。

独立审核面板沿用批准视觉，ready设备和服务端canReview才显示；明确选管理员/团队/目标role（含收回），显示撤旧scope和退出影响、核对确认及当前审核账号密码。401/actor/device/read代次先于迟到结果，mutation锁跨关闭保持，关闭/退出/暂停/unload清秘密，unknown不重发，成功刷新失败明确已完成待核对。null之后admin重登无business membership仍显示技术面板。

文件归属：server agent独占`administrator-business-role-schema.sql/policy.mjs/api.mjs`及新helper/core测试；root负责中立`business-role-transition.mjs`撤权复用、旧入口eligibility与第五owner保护、app/db/demo/bridge/preload、旧精确fixture和文档。UI agent独占team-client/UI及新client/DOM/native脚本。security独立新安全测试/仓库外审查。不得交叉编辑或提交。

低层新policy不依赖administration/member/project/auth/device模块，避免auth→repository循环；供root复用`approvedAdministratorBusiness(db,userId,teamId,{technical=false})`、`administratorBusinessEligibilitySql(memberAlias)`（仅固定内部alias）、`administratorTechnicalEligible(db,userId,teamId)`。API导入root的`revokeBusinessRoleAccess(db,{actorId,teamId,userId,at,reason})`，它只撤旧scope/票据、不改membership或新approval，须在同一外层事务调用。

## 结束证据

真实SQLite/API覆盖初次0membership四role、全部角色变化/null收回重批、合法junior采集/senior项目闭环、无scope拒绝、未审/失效/ABA/五owner历史/self/跨team/多归属拒绝；密码/lease/authority/target body/KDF/BEGIN竞态、SQL分页范围/MAX/taskCAS/audit回滚、旧票不复活及原件/非目标保持。main/client/DOM来源与参数/秘密/迟到/unknown验证，Windows strict Electron新审核者核准管理员、角色重登、明确指派/授权采集或核对、收回时旧端/heldSave零写入、技术能力保持。全量portable、相关原生兼容、独立验收及两共享库RO在线before/startup/after保全。Mac/真实身份/跨电脑/生产不编造通过。
