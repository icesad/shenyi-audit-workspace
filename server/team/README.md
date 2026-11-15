# 团队采集授权原型（M1/M2）

M2新增独立账号、本机HTTP、定向邀请、原件提交与版本控制，以及手机号/微信的合成身份适配边界；最新运行说明见[本机桌面预览](../../docs/M2_LOCAL_TEAM_PREVIEW.md)和[正式身份方案](../../docs/PHONE_WECHAT_AUTH_PLAN.md)。下文读取范围描述M1模块，不能误读为M2没有写入接口；生产及设备/支付能力仍未完成。

后续新增[员工邀请与本人激活](../../docs/EMPLOYEE_INVITATION_ACTIVATION.md)：业务邀请要求当前manager/partner＋独立member.invite；技术管理员使用独立operator来源，低权限误授grant仍拒绝。新账号本人验证设密，既有孤立账号必须当前密码且复用ID，不自动发会话或业务grants。未配SMS如实关闭，真实供应商、多团队及恢复政策未完成。

[人工团队开通](../../docs/MANUAL_TEAM_ONBOARDING.md)由`provisioning-schema.sql`、`provisioning-api.mjs`和`administration-policy.mjs`提供：独立reviewer录入/当前密码及CAS审核，首管理员本人验证后才建team/profile/operator，不加审计membership。八张新表同事务追加，旧业务邀请表及外键保留；operator员工邀请独立表/挑战，不伪造partner。没有公开授予reviewer权的API，显式合成fixture在`provisioning-demo.mjs`，普通demo不增权；生产账号建立/主体审核仍需单独完成。

[个人会话管理](../../docs/ACCOUNT_SESSION_MANAGEMENT.md)由`session-schema.sql`/`sessions-api.mjs`提供稳定非凭据管理ID、本人有效会话分页及当前密码重验后的指定/其他/全部退出。旧会话不改token/期限/状态、不推算时间，所有登录方式统一发放元数据；不暴露摘要或同事数据。此项与业务角色授权、M3设备绑定分别验证。

[本人改密](../../docs/PERSONAL_PASSWORD_CHANGE.md)沿用`/api/auth/password`，错密403可重试，请求体后/事务中重查同一发起账号；CAS更新与全部旧会话撤销原子，不更换手机号/角色。没有新schema或真实用户密码操作；默认SMS缺席不影响当前密码验证。

[找回密码](../../docs/PASSWORD_RECOVERY.md)沿用独立authorizer默认关闭的`phone/reset`；`recovery-schema.sql`只追加手机号挑战快照表，reset HMAC绑定手机号版本/验证时间，SMS返回与异步授权/KDF后复查。旧无快照reset拒绝重发，bind语义保持。用户已选管理员审核员工、产品负责人审核管理员本人，审核签发/撤销链尚待接入，不以短信单独恢复或增加生产权限。

[内建恢复审批](../../docs/RECOVERY_APPROVAL.md)后续已接 `recovery-review-api.mjs`/`recovery-review-policy.mjs`。reviewedRecovery显式模式：员工own operator审、管理员独立owner审，current password/CAS批准拒绝撤销，票只存hash。KDF后同密码事务再次核权并消费，不用external true绕过。新增4表及20固定epoch触发器，不改原表定义；撤权后同值恢复不救活票。`recovery-review-demo.mjs`仅显式合成预览增加独立恢复审核员，普通seed与生产无默认权限；SMS缺席仍关闭。

[任务指派与退回](../../docs/TASK_MANAGEMENT.md)扩展现`collection-write-api.mjs`：新增management/assignees GET，仅任务read＋manager/partner＋项目manage交集有人员资料。候选/新assignment只本团队有效intern/assistant（用户确认），查询先SQLscope/role/active再搜索分页；旧assignment/return本轮要求revision，不留无版本通道。body后/事务中sameactor+CAS、closed/frozen拒绝，原件/历史不删，也不扩他人submissions或附件授权。无新schema。

状态：隔离的本机合成数据实验；没有挂载到既有网页/Sites服务，不对公网监听。不能用它声称生产登录、设备绑定、订阅或团队软件已经完成。

架构见 [ADR 0001](../../docs/adr/0001-team-runtime.md)，产品权限见 [团队需求](../../docs/TEAM_PRODUCT_REQUIREMENTS.md)。当前工作项为 `TEAM-M2`，M1为已交付读取原型。

## 文件与可信入口

- `schema.sql`：新建隔离测试库的模型，包含复合团队外键；不是旧平台或客户数据库的升级脚本。
- `access-policy.mjs`：四角色允许读取的采集范围和返回字段白名单。
- `repository.mjs`：服务端会话查询、成员状态和参数化数据查询；范围条件先于搜索、计数和分页。
- `collection-api.mjs`：Web `Request/Response` 处理器；只接受服务端存储的有效opaque bearer会话。
- `auth-api.mjs`、`application-api.mjs`：密码/会话、统一分发、限流及来源边界；`collection-write-api.mjs`、`invitations-api.mjs`提供M2的受限写入。
- `identity-schema.sql`、`phone-api.mjs`、`wechat-api.mjs`：手机号映射/SMS挑战及微信事务。`identityProviders`只从服务端注入；无配置时明确503，`GET /api/auth/methods`如实返回能力。只给标记正确的M2实验库增加表，旧客户库不自动迁移。

测试用 `DatabaseSync(':memory:')` 执行schema，不读旧IndexedDB或平台资料库。生产仓储接口与数据库选型尚需验证；同步SQL实验不等于生产并发/容量测试。

## 已实现的读取范围

所有路径前缀为 `/api/teams/:teamId/collection`，仅GET。

| 路径 | 响应/条件 |
|---|---|
| `/tasks` | `{tasks:[{id,title,instructions,status}],hasMore}`；最多100项，支持`limit`、`after`及标题/说明字面搜索`q` |
| `/tasks/:taskId` | 同样白名单的单任务；不返回项目、客户、财务或完整目录字段 |
| `/summary` | `{taskCount}`，只计当前可访问任务 |
| `/tasks/:taskId/attachments/:attachmentId` | 同时拥有任务范围和该附件的有效个人grant才返回字节；强制下载、固定octet-stream |

实习生/助理只能通过有效任务指派取得范围，数据库中即使错误给予project grant也不放行。项目经理/合伙人除自己的任务外，可通过明确的`collection.read`项目grant取得该项目采集范围；不自动给本团队全部权限。所有角色下载原件仍需独立附件grant。这是最小授权实验，不是米老师已经签收的完整经理/合伙人业务权限。

`q`不把`%`和`_`当作查询通配符。未知/重复查询参数、非法limit或游标拒绝；未知模块、树、历史、导出、管理路径默认拒绝。M1模块本身只读；M2写入/上传/退回和邀请规则见本机预览，不包括审计核对/签发或通用授权管理。

## 认证与撤销

只从`Authorization: Bearer`读取标准32字节base64url会话凭据，计算SHA-256后查服务端会话表；凭据不在表中、已过期/撤销、用户已禁用，均返回401。不读取请求中的用户ID、角色、平台身份头或本机角色配置。

每次请求重新查当前成员、团队及授权；禁用成员/团队、移除指派、撤销grant或降职在下一请求生效。不在会话中缓存角色。项目冻结只读仍可查，归档项目不在当前采集范围。

M1测试预置会话不等于账号注册/密码登录。M2已加入合成账号的异步scrypt、登录限流、会话发放/撤销和桌面入口；正式手机号验证与微信供应商仍须另验。手机号登录复用内部员工ID，微信首绑必须当前已验证手机号账号、当前密码及事务发起端证明，不自动新增人员/团队/权限。账号恢复默认关闭，不能只凭短信取回客户权限。M3及订阅阶段增加设备和权益约束。生产服务必须使用HTTPS，令牌和私钥不能写日志或前端持久配置。

## 返回边界

未知资源与已存在但无权资源使用同一404内容，避免泄露对象存在性。错误只给通用代码和说明，不输出SQL/路径/凭据。所有响应`private,no-store`、`nosniff`，不开放CORS；跨站请求拒绝。

项目标题/财务/结构列专门存入合成秘密标记以验证未下发。任务标题/说明本身必须由有权人员仅填写所需采集上下文；DTO白名单不能自动脱敏一段人为塞入的敏感正文。正式数据进入前需按任务材料范围审核。

## 验证命令与证据边界

在Node 24.15以上24.x执行：

```sh
node --test tests/team-collection-access.test.cjs
node --test tests/team-collection-access.test.cjs tests/account-profile.test.cjs tests/account-client.test.cjs scripts/dev-tools.test.cjs
```

该测试无需额外npm依赖。新增文件会被现有`npm test`和可移植子集runner发现；没有为通过测试改旧断言。检查结果、独立审查和下一里程碑写在根目录`进度.md`。

上述M1命令提供处理器/真实SQL证据；M2另有真实loopback HTTP、Windows桌面及合成身份专项，见本机预览与进度。真实密码找回/短信/微信、生产数据库、对象存储、客户端/系统密钥、支付和Mac仍未验收，也不代表客户审计业务验收。未来对象存储预签名票据、搜索索引、异步导出和共享缓存需要延续同一范围规则，不能绕过这里的判定。
