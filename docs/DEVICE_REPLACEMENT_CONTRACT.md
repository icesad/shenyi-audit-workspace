# M3C 换机申请、审核与激活合同

2026-11-15，从M3B `e37eaab` 接续，分支 `codex/device-replacement-approval`。本轮实现完整本地员工/技术管理员换机闭环，不改专业审计规则/旧平台/dist，不接真实资料/供应商，不push/main/部署。26旧源/文档先备份 `D:/codex-temp/shenyi-device-replacement-20261115/baseline/`。M3/完整Goal仍active；Mac、正式身份/HTTPS/安装更新和更高特权owner自身恢复保留未完成。

## 权限与状态

1. 业务员工仅本团队technical administrator审核；技术管理员本人仅独立产品负责人ACL `team_device_replacement_reviewers.permission='device.replace'`审核。不能复用审计职级、member.disable、account.recover或team.provision，不自审、不跨团队给员工批准。技术管理员/产品owner没有默认审计资料。
2. target须账号/团队active且有设备历史。employee仅唯一历史membership、四业务role active、完全无operator史；administrator仅唯一历史operator且当前active administrator，membership至多一条同team且active/非junior。任何历史platform/recovery/access/device reviewer都是保护身份，不进普通换机目标链；owner自己的设备恢复需另行manual bootstrap，不能自批。复杂归属默认拒绝。无历史走原首次绑定，active同key走原prove；revoked历史允许受审恢复（同key也允许），不再走enroll。
3. 新电脑以本人实际账号token、当前密码、新key持钥证明创建request。`pending → approved → claimed`；可`rejected/withdrawn/revoked/expired`，stale为派生状态。每用户最多1条pending/approved，重复不覆盖；创建时事务终结过期/陈旧旧申请再新建。批准不影响旧绑定/旧会话；只有新电脑再次明确点击激活、完成签名后才原子撤旧并发新binding/15min authsession+lease。不得poll自动领取。
4. request候选TTL24h；approve后有效期缩至min(原expiry,批准时间+30min)。期限由server判断，后期可改政策，不由client时钟放行。审批本身不是Bearer，不向renderer发approval secret。所有request/challenge/审核写均CAS、body/KDF/事务后重查；未知提交不自动重放。
5. 审批事实绑定server/user/newkey/targetKind/team/旧binding完整快照/target identity与credential epoch，以及批准人当前权源/credential/identity stamp。申请bootstrap token只约束该次request挑战；批准后允许同user同key重新密码登录，经专门activate-challenge绑定**当前真实token**恢复领取。此为显式会话恢复协议，不把原挑战挪到新token、不以requestId当能力；不同账号/key或跨token挑战重放拒绝。新登录不重写request的target/approval stamp。

## 独立证明协议（root独占）

`shared/device-replacement-proof.cjs`重用M3A canonical Ed25519/SPKI、signature/nonce/sessionBinding解析，但不扩旧proof目的/CHECK。新domain为 `SHENYI-DEVICE-REPLACEMENT\0v1\0`（运行时实际NUL）＋UTF8固定JSON数组，精确15字段顺序：

`purpose,serverId,userId,sessionBinding,keyFingerprint,identityEpoch,oldDeviceId,oldBindingRevision,oldBindingStatus,requestId,requestRevision,challengeId,nonce,issuedAt,expiresAt`。

purpose仅`request/withdraw/activate`；UUIDv4用于server/oldDevice/request/challenge，userId沿用ID，两个hash hex64，nonce32bytes/base64url43，expiry-issued恰120000ms；revision safe整数，old≥1，request目的requestRevision=0，其余≥1，oldStatus仅active/revoked。server从存储重建验签。不同domain不能互用；opaque id/nonce变更最终由server存储重建拒绝，不虚称main知道所有随机值。

vault新增仅main的 `signReplacementChallenge(fields,context)`，context精确为 `{purpose,serverId,userId,sessionToken,oldDeviceId,oldBindingRevision,oldBindingStatus,requestId,requestRevision}`；逐项核对当前可信上下文、实际token hash和本key fingerprint，再用上述codec签。无私钥导出/通用签名IPC。旧接口保持。

## API 与投影（server agent独占新replacement模块）

本人路由均精确bootstrap，未知query/额外字段拒绝：

- GET `/api/auth/device-replacements` → `{canRequest:boolean,request:DTO|null}`。仅本人最新申请，flags按当前资格/期限/stamp计算，不下发成员/项目目录。main用request新fingerprint与本机匹配后才开放动作。
- POST `/api/auth/device-replacements/request-challenges` body `{publicKey,displayName,platform,currentPassword}` → `{challenge:<15字段>}`。无可用open请求、本人资格有效、active同key拒绝；KDF后重验。server预分配requestId/revision0、固定保存key/name/platform/旧binding/target快照。
- POST `/api/auth/device-replacements/request` body `{challengeId,signature}` →201 `{request:DTO}`，签名后同事务CAS挑战消费并创建pending/event。
- POST `/api/auth/device-replacements/withdraw-challenges` 与 `/activate-challenges` body均 `{requestId,revision,publicKey}` → `{challenge}`。必须本人、request绑定key、当前request/target/旧binding；withdraw允许pending/approved，activate仅approved且批准人权源/stamp仍有效。
- POST `/api/auth/device-replacements/withdraw` 与 `/activate` body均 `{challengeId,signature}`。withdraw→`{request:DTO}`，撤该申请及未消费相关challenge，不动旧设备；activate→原M3A leased session形状 `{token,account,memberships,expiresAt,device,lease}`，只由main采纳，renderer只安全session+device status。

审核路由永远不在bootstrap，必须strict设备context＋当前实际actor：

- GET `/api/account/device-replacement-reviews/access` → `{canReview:boolean}`。
- GET `/api/account/device-replacement-reviews` → `{requests:[DTO最多50],hasMore:boolean}`。带 `?paging=1` 时使用分页响应 `nextCursor`。后续页追加 `&after=<上一页末条申请编号>`，以录入时间和申请编号倒序读取。每次都先按当前权源限制可见范围；无权和未知的游标均返回 404。旧客户端可继续读取原格式首页。
- POST `/api/account/device-replacement-reviews/:requestId/review` body `{revision,decision,currentPassword}`，decision仅approve/reject/revoke；密码重验、fresh authority/target/oldbinding/request及CAS，→ `{request:DTO}`。pending可approve/reject，approved可revoke，不重复批准或回pending。

DTO精确11字段 `{id,teamId,teamName,displayName,targetKind,status,revision,createdAt,expiresAt,oldDevice,newDevice}`。targetKind employee/administrator；status含pending/approved/claimed/rejected/withdrawn/revoked/expired/stale；oldDevice为 `{id,displayName,platform,keyFingerprint,status,revision}`，newDevice为 `{displayName,platform,keyFingerprint}`；无publicKey/token/hash/private审查stamp/phone/正文。正常文本安全限制沿用80字符，名称非空、platform win32/darwin、revision安全。server opaque错误沿用400/401/403/404/409/410/429/503，错误签名最多5次，不回原始异常或秘密。

## 数据和原子性

新增四表：`team_device_replacement_reviewers/requests/challenges/events`，必要唯一open请求/index；reviewer和device_bindings各3个identity epoch insert/update/delete触发器，不改旧20+3 trigger定义。绑定变化跟踪用于拒绝撤销再还原ABA，不把普通prove/会话续接误判成binding改变。safe MAX溢出/未知clock/audit失败整笔回滚。

旧API本人设备读取优先active，再按boundAt/id取最新history，避免同毫秒新旧排序错选。serverId缺失/损坏检查涵盖新request/challenge/event/ACL历史，不重建或覆盖。新device reviewer同时纳入现recoveryTarget/memberAccessTarget任何历史保护排除。

activate在同一事务fresh验证→消费request与challenge→撤旧active binding/revision+1（revoked旧历史保持）→撤该user全部旧session/lease/device challenge/其它replacement challenge→新binding/rev1、新15min session/lease及设备/换机events。DB单active绑定/单live lease兜底。应复用原device business-session发放helper（可由server agent窄export），不改期限/secret语义。target credential/phone/wechat、memberships/operators/grants、task revision、submission/原件逐行保持；不得误用成员停用清权限。新binding触发epoch后再验证safe状态，任何失败回滚全部。

新显式review demo helper仅review入口追加 `device-reviewer-demo / ShenyiDemo!2026`，独立device.replace、无audit/operator/其他owner权限；碰撞拒绝、marker幂等、不复活disabled/revoked或改过密码。普通9不变，review13→14；不自动给任何账号登记设备，不是真实产品owner授权。

## 客户端与文件归属

root：新codec/tests、vault窄方法、database/app/gate接线、既有protected-identity排除、bridge/preload/launcher、文档和旧夹具适配。server agent：新schema/policy/api/demo及core/demo tests；可窄改device-api导出原session helper及优先active选择。UI agent：新 `desktop/device-replacement.cjs`、team-client/device-session小接线、team-ui三文件、新client/DOM tests及strict `desktop/device-replacement-smoke.cjs`。security独占 `tests/team-device-replacement-security.test.cjs`与独立验收。其他源改前找owner，旧文件已备份。

新增7窄RPC，总64：`getDeviceReplacementStatus()`、`requestDeviceReplacement({displayName,currentPassword,confirmed:true})`、`withdrawDeviceReplacement({requestId,revision})`、`activateDeviceReplacement({requestId,revision,confirmed:true})`、`getDeviceReplacementReviewAccess()`、`listDeviceReplacementReviews()`、`reviewDeviceReplacement({requestId,revision,decision,currentPassword})`。本人前三写返回`{request}`，激活返回安全ready session；状态/审核按API安全DTO，无自由payload。激活通过device-session私有验证/采纳接点设置新token/lease/epoch，不放开旧enroll。取消/换actor/关窗的迟到minted token只撤本次，不回滚已COMMIT换机，也不清后来账号。

申请端在device-gate复用原name/password/consent，只显示本人申请与刷新/撤回/明确激活，不轮询自动激活。审核为独立details，按ready＋服务端canReview显示，兼容无audit membership管理员；新一reviewer密码输入，预计10form/17密码，不M6改版。actor/device/view/read/action owner代次、跨关闭锁、旧401/finally清理和unknown mutation指导保持M3B标准。

## 验收结束条件

Node24完整portable、原核心/DOM及必要native兼容；新codec/domain/15域、grant/credential/binding ABA、批准后撤权/停用/过期、原子回滚/双并发唯一、挑战跨user/key/server/token、显式重新登录resume、审批不撤旧/领取才撤、revoked恢复、迟到领取/unknown commit不重放、旧body/KDF/heldOpenSave拒绝与原件/全部审计权限保持。新真实Windows strict多actor/多OSvault/随机HTTP/落盘SQLite、截图与阶段DB独立核验，不用diagnostic替代。两shared库先online backup、原schema/全部旧行保持，review仅精确新synthetic owner/ACL/epoch/marker，设备仍空。M3C仅本地候选；Mac/真实供应商/HTTPS/生产/特权owner恢复不编造完成，Goal保持active。
