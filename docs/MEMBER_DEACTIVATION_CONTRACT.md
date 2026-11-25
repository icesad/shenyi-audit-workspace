# M2 成员停用执行合同

2026-11-15，从cf68127接续。用户已确认技术管理员可停用本团队业务成员（含经理、合伙人）；技术管理员身份由产品负责人处理。Codex仅实现/测试，产品负责人权限不等于Codex可擅自操作真实账号。本轮仅本地合成候选，不删除资料、不提供重新启用、恢复原授权或所有权移交。

## 权限及目标

- 技术管理员由既有`canOperateTeam`与`team_operators`事实判断，业务职级、member.invite、team.provision、account.recover不能替代。产品负责人用新`team_access_reviewers`独立`member.disable`授权，不从其他review权限继承。不自停用，不管理其他特权reviewer；此类身份继续独立人工bootstrap。
- 业务目标仅单条历史business membership且属于当前团队、无任何operator或platform/recovery/access reviewer记录。技术管理员目标仅单operator归属；其business membership至多1且同团队，无其他历史团队归属或特权reviewer记录。所有历史状态行都计入，不能仅过滤active；不把未确认的多团队身份全局停用。单归属事实必须在KDF后事务内重新验证。
- 列表展示账号status（active/disabled）；停用会同步收回团队权限。既有membership disabled/operator revoked但账号active仍可由对应负责人完成账号停用。账号已disabled不重复执行，返回409，不自动重试。foreign/unknown/self/protected/unapproved affiliation统一404；真正session失效401；错误当前密码403保留当前登录。

## API与RPC（总54窄IPC）

1. `getMemberManagementAccess()` → GET `/api/auth/member-management/access` → `{teams:[{teamId,teamName}],canReviewAdministrators:boolean}`。只返回本人active technicaladmin团队；owner独立布尔。低role无权是空teams/false。按服务端权源，不依赖audit memberships。
2. `listTeamBusinessMembers({teamId,q?,after?,limit?})` → GET `/api/teams/:teamId/business-members` → `{members:[{id,displayName,role,status,revision}],hasMore}`。
3. `listTeamAdministrators({q?,after?,limit?})` → GET `/api/administration/team-administrators` → 同页DTO，但行另有`teamId,teamName`，role固定`administrator`。只有新owner授权可读。
4. `disableTeamBusinessMember({teamId,userId,revision,currentPassword})` → POST `/api/teams/:teamId/business-members/:userId/disable`，body仅`{revision,currentPassword}` → `{disabled:true}`。
5. `disableTeamAdministrator(同参数)` → POST `/api/teams/:teamId/administrators/:userId/disable` → 同body/结果，仅新owner授权。

GET参数严格白名单，q最多80字符且禁Cc/Cf、LIKE转义；默认20/最多50、稳定userId游标，SQLscope/目标资格先于搜索/分页/游标。未知/越权游标拒绝，无跨团队总数。人员只返回完成停用所需字段，无手机号/凭据/原件/项目结构。teamName/displayName作安全文本投影（wellformed、去控制字符、最多80码点，空则ID），不改存储原名。所有ID/请求/响应严格投影。

## 原子停用与schema

- 复用`team_recovery_identity_epochs`作为target revision（缺行0，非负safe整数），actor stamp同时包含epoch、当前credential hash/revision及当前operator/owner权源。owner ACL用新表与INSERT/UPDATE/DELETE三trigger递增同epoch，抵抗撤销后同值重授ABA。新特权reviewer也加入`recoveryTarget`特权排除，不能被普通团队恢复链接管。
- 新`member-access-schema.sql`只追加ACL及专用`team_member_access_events`审计表（eventId/team/actor/target/targetKind/beforeRevision/createdAt，可含固定action），不把userId塞入旧activity.task_id。无生产bootstrap/API自授权。初始化在recovery-review schema之后、既有BEGIN事务中，拒未知库原则保持。无alter旧表。
- POST先授权和目标版本，再限流与当前密码KDF；读取body后、KDF后及事务内再确认同一actor/session/权源/credential/epoch、目标资格/epoch。错误/冲突或任何写入失败整笔回滚。各受影响active assignment task版本必须安全可递增，缺行0→1，每任务只增一次；MAX/非法版本整笔拒绝，无部分停用。
- 同一事务：account disabled；目标团队membership disabled/operator revoked（存储角色不删除）；所有目标user既有会话revoked；同团队assignment/project/attachment/admin grant撤销；受影响任务版本递增，任务status/项目冻结/原件/提交history保持。
- 同团队由目标发出的未用邀请失效：legacy invitation缩短expires_at（不伪造accepted_at）；两类employee邀请revoked_at及其未消费activation challenge delivery failed。保留其他发行人及已接受邀请历史。本人未用phone challenge消费、本人pending/approved recovery request撤销、已知本人ready微信事务取消（按现真实列/状态处理）；未知user的pending授权仍由既有fresh user检查拒绝。保留phone/wechat/credential映射，不能当孤立新用户重新激活。
- 审计与停用同事务，密码/hash/token/phone不进入审计或renderer。结果只disabled true，不假定epoch恰好+1。没有重新启用或自动恢复旧授权入口；以后恢复需另定策略。

## 桌面与合成预览

- 一个`member-management` details面板，在enter独立加载access，不依赖audit membership。仅使用access.teams；owner无teams仍可进入administrators模式。分页/搜索/模式/团队/刷新清selection和密码。目标明确显示后以当前密码确认停用；共10form/16password，仍沿用当前视觉，不做M6改版。
- actor/panel/mode/team/read代次在解释401前核对；跨关闭的mutation锁保留，同actor新面板不误报成功/取消，不确定结果要求刷新核对、不自动重试。关闭/退出/换身份/401清秘密和人员列表；旧finally不能解锁新操作。成功刷新列表且已停用目标不能重复提交；刷新失败不能误报停用失败或重新放行。
- review预览显式新seed独立`access-reviewer-demo`（仅新owner权限）与`administrator-demo`（team-a technicaladmin，无audit membership/grants），公共合成密码沿用。普通9用户不增权；review由11增至13，仅追加新身份。marker幂等、collision拒绝、重启不复活disabled/revoked/改过的账号。不用于生产权限。

## 验证与交付

独立agent验收跨团队/四业务职级/技术管理员与owner、误grant、保护身份/历史多归属、无phone目标、body/KDF/事务中的撤权与ABA/并发/回滚、MAX任务版本、旧session/phone/reset/recovery/wechat/invitation在途失效、原件/历史hash保持。真实Electron隔离HTTP/SQLite：techadmin无audit资料可停业务成员；其原窗口下一请求401清空，上传/保存选框中撤权不落盘；techadmin自停/停其他管理员拒绝；owner停管理员，错误密码可重试，普通审计角色入口隐藏。合成供应商/选择器明确标注，不作真人SMS/OS/Mac/生产证据。

完整portable回归、默认及相关旧原生兼容；两demo在线备份，升级保留原39表定义/旧行，普通不加账号，review仅增加两合成身份及ACL/operator/epoch/marker；新schema单列。验证后本地commit，更新进度/BACKLOG/STATUS，明确main/一键/线上。原dist/platform/hosting及真实客户/生产不改，不push/deploy。M2/完整Goal继续active，M3设备仍首版必需。
