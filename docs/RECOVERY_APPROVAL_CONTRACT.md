# M2 恢复审核本轮实现合同

日期2026-11-15。用户已确认员工由团队管理员审核、管理员本人由产品负责人审核，均须本人SMS；本轮只实现隔离候选，不启用真实SMS或生产账号，不修改旧dist/平台/客户资料，不推送/上线。

状态：本机候选已实现并通过对应独立及原生检查，使用流程及真实证据见[交付说明](RECOVERY_APPROVAL.md)。当前44项IPC、9form、15密码输入；本文件保留实现时的精确接口和边界。

## 固定接口

新增5个窄RPC，总44项；旧auth DTO和恢复reset输入保持。

| RPC | API与输入 | 输出 |
|---|---|---|
| getRecoveryReviewStatus() | GET /api/auth/recovery-requests/capabilities，unsigned | {reviewed:boolean,available:boolean} |
| createRecoveryReviewRequest({challengeId,code}) | POST /api/auth/recovery-requests，unsigned | {requestId,status:'pending',revision,expiresAt} |
| getRecoveryReviewAccess() | GET /api/account/recovery-reviews/access，authenticated | {canReview:boolean} |
| listRecoveryReviewRequests() | GET /api/account/recovery-reviews，authenticated | {requests:DTO[]}，最多50 |
| reviewRecoveryReviewRequest({requestId,decision,revision,currentPassword}) | POST /api/account/recovery-reviews/:id/review，decision=approve/reject/revoke | {request:DTO,recoveryProof?:43字符}，仅批准返回一次明文 |

DTO={id,teamId,teamName,displayName,phoneMasked,targetKind:'employee'或'administrator',status,revision,createdAt,expiresAt}。status=pending/approved/rejected/revoked/consumed/expired；正整数revision；时间safe整数。teamId/name来自可信目标团队，显示名最多80。列表无target userID/完整手机号/秘密。

## 权限与状态

- 技术管理员只审核本人团队active员工，员工必须恰好一个active业务归属且无任何技术或平台审核身份；普通经理/合伙人或member.invite不获得恢复权。误授operator的intern/assistant/disabled业务成员仍拒绝管理。
- 管理员目标必须当前active operator、team/user有效，无低职级冲突；只由独立team_recovery_reviewers授权的产品负责人审核。恢复审核授权与team.provision分表，不能推断。平台审核员本人等特权身份的自我/循环恢复默认拒绝，生产人工bootstrap另行实现。任何人不能自审。
- 申请必须先验证reset用途SMS、发码时phone snapshot/HMAC、有效期/attempt。未知、无效或无可审批归属的手机号在合法SMS后也返回同形pending回执，但内部不可路由/不可批准，不泄露账号存在位。请求不授予任何用户/业务/设备权限。
- challenge唯一申请，重复合法提交同票返回原pending回执；无需公开按ID查询状态。用户将申请编号交管理员，批准凭据人工转交，软件不发消息。正式易用性后续可加发起端安全轮询。
- 审批用当前密码、revision CAS和current actor；body/KDF后重查权限和target/phone/credential快照。批准随机32byte票仅存hash，期限不晚于原challenge（当前5分钟实验值），一次显示、关闭清。拒绝pending，撤销approved，已消费不可撤销密码结果。
- 批准人正常logout不废票；其账号/授权/密码版本、目标归属/账号/phone/密码版本变化、期限或revoke均使票不可用。不得把失效票因新授权而救活。
- reviewedRecovery===true 为服务端可信显式模式开关；SMS缺席available=false，默认不增加任何生产恢复审核员。旧external recovery.authorize测试路径保留，但reviewed模式不接受external always-true绕过。
- phone/reset在reviewed模式验证内部批准快照，并在KDF后的同一密码事务中再次核权、CAS消费批准票＋更新密码＋撤本人旧sessions/phone challenges。拒绝/并发/存储失败不能留下部分消费或变更。旧external boolean authorizer不替代该原子边界。

## 桌面与验证

恢复页保留SMS/code/proof/new/confirm，reviewed模式增“提交恢复审核”及只显示编号的回执，获批后填一次性恢复凭据。另有已授权审核面板，列表/密码＋批准拒绝撤销/一次性凭据。不能给管理员审计资料访问权；无业务membership不查询任务。

账号代次/面板代次/跨关闭写锁、秘密清理、queued toggle、不确定结果提示及旧界面行为保持。新form和password计数由UI实现后报告，不弱化精确白名单和原断言。真实Electron必须覆盖员工由own operator批准、管理员由owner批准、错密码/拒绝/撤销/错team/自审和原子重置；SMS明确合成，旧共享两库备份并核对原定义/每行保持。全量portable、独立security及截图/SQL/HTTP分层验收；Mac/真实供应商/生产不冒称通过。
