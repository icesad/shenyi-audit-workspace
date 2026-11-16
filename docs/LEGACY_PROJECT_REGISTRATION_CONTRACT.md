# M4F 旧正式项目来源与归属审核

2026-11-16，关联 TEAM-M4，base `22cc2d8`。用户已明确：**产品负责人审核旧正式项目的目标团队及首位项目负责人**。历史自由填写经理姓名不产生账号权限。新项目是否可在中标前建立采集工作区仍待答，本片不开放一般项目创建。

本片完成可操作的治理登记闭环：旧项目登记表只读导出单项目来源 JSON；正常桌面中具有独立 `project.migrate` 权限的产品负责人选择文件，核对最小摘要，选择有效团队及合格经理/合伙人账号，显式确认初始 read/manage/review，并以当前密码和当前持钥设备会话审批。服务端同一事务登记旧 UUID、原编号、原来源、审核人与首位负责人。此处仅登记团队治理，不搬运客户原件、底稿、合同、清单或报价库，不改变旧库状态。

## 来源协议

`dist/legacy-project-source.js` 为浏览器/Node 共用 codec，格式 `shenyi-legacy-project-source`，schemaVersion 1，规范 JSON UTF-8 上限 128 KiB，最多 1000 条报价事件，超限拒绝而不裁剪。

- source 精确键：`format,schemaVersion,initiation,quote,numbering,policy`。
- initiation 保留既有完整、原样语义的 `ProjectInitiation` 已存记录，不调用 `ensureWon` 生成立项。
- quote 精确键 `id,createdAt,snapshot,events,lastEventNo`。snapshot 只含 `projectName,issuer,customerName,firmName,auditYear,quoteDate,totalCents,projectType` 八项来源投影；events 仅 `eventNo,recordedAt,outcome`，连续完整保留，outcome 沿旧 won/lost/cancelled。
- numbering 精确键 `identity,riskLevel,projectType,businessNumber,workspaceRevision,legacyManagerName`。identity 原固定 `{schemaVersion,projectId,year,sequence,firstWonAt}`；当前风险等级、项目分类和原显示业务编号严格复算，不补号、不重编号。legacyManagerName 取已存 workspace.projectRegister.manager 原文，原 initiation.form.manager 另保持原样，两处历史文字均不转成账号授权。
- policy 固定为 `governanceRegistrationOnly:true,includesCustomerOriginals:false,identityAuthenticated:false,originalCreatorKnown:false,professionalApprovalClaimed:false`。
- 校验沿用既有立项/固定编号 pure validators，并核 UUID、八项快照、立项 source 指向的真实 won 事件、首次 won 与固定编号、最新 won。三类中标时点可以不同。源 SHA 证明内容一致，不证明本机声明的业务真实性；可信团队归属来自人工审批。
- codec API：`validate(source)` 同步返回自有规范对象；`encode(source)` 同步返回 canonical Uint8Array；`inspect(bytes)` async 返回 `{source,sha256,summary}`；`summary(source)` 同步返回 `{projectId,title,businessNumber,legacyManagerName,initiationRevision,workspaceRevision,firstWonAt,initiationWonAt,latestWonAt}`；`create({initiation,currentQuote,identity,workspace})` 同步由已验证旧源构造 source。summary 不作为服务端校验替代。
- 旧端直接 `QuoteLedger.open().list()`、`ProjectInitiation.listSaved()`、`ProjectWorkspaceStore.get()` 与新只读 `getProjectNumber()` 读取；不走带 ensureWon/分号副作用的页面 lookup。导出前后完整重读所选来源，任何改变都拒绝本次下载；不序列化整个 workspace。未保存本行不能导出。

## 服务与桌面协议

服务 routes：GET `/api/auth/project-migration/access`→`{canReview}`；GET `/api/project-migrations/teams`→`{items:[{id,name}],total,hasMore}`；GET `/api/project-migrations/teams/:teamId/owners`→`{items:[{id,displayName,role,revision}],total,hasMore}`；POST `/api/project-migrations` 精确 body 为 `requestId,source,sourceSha256,teamId,ownerUserId,ownerRevision,read,manage,review,currentPassword`；GET `/api/project-migrations/receipts/:requestId` 仅同审核人当前独立权限可查，返回已登记的最小 receipt 或 404。两列表沿既有 q/after/limit 严格参数，q 最多80字符，默认20/max50，hasMore 时 after 为最后item.id，total 对应同q scope，不能静默截断。

POST 成功 receipt 为 `{requestId,projectId,teamId,ownerUserId,businessNumber,sourceSha256,read,manage,review,registeredAt}`。历史 UUID 全局唯一登记、同团队固定年度顺序号冲突拒绝；已有 team_projects 不收养/覆盖；requestId 重复返回 409，客户端不自动重发。未知结果保留 requestId 并只读核对 receipt。team/name 不推断归属。首 owner 当前必须具有有效单团队 senior 资格、管理员兼任须已有精确批准，且不是任何审核者历史身份；memberRevision/审核权/凭据/设备/身份 epoch 在异步正文、密码KDF后及事务发布前重验，不能 ABA 复活。read/manage/review 必须显式布尔值，manage/review 依赖 read；owner 本身不隐含这三项。

新增独立审核 ACL、不可变 provenance、专用 audit 三表。历史 created_by 在 team sidecar 仅表示本次经审核的首位团队治理负责人，另存 originalCreatorKnown=false，不冒称旧历史创作者；reviewed_by 与 legacyManagerName 分开。新第六审核权不能由旧五审核权推导；所有既有职级/邀请/首管理员/停用/恢复/换机/业务访问历史保护均覆盖它。

桌面仅窄方法：`getProjectMigrationAccess,listProjectMigrationTeams,listProjectMigrationOwners,chooseProjectMigrationSource,approveProjectMigration,getProjectMigrationReceipt,discardProjectMigrationSource`。精确 DTO 见 `desktop/PROJECT_MIGRATION_UI_DTO.md`。main 私有来源句柄与同 actor/device guard 绑定，renderer 只接摘要/SHA/handle，不接 raw source、原路径或凭据。main 在选择时生成的 handle 同时是本次唯一 requestId，界面在 POST 前已持有公开核对编号；一个handle只允许一次可能提交。取消/关闭/退出/换账号/设备失效清除来源，in-flight 旧结果不得污染新上下文；审批未知不假称取消、不重发，保留 receipt 查询途径。

旧资料 closed、底稿 locks 或已完成/已取消业务状态不擅映射 team frozen/archived；本片不迁它们，也不改变任何旧状态。审批后团队项目初始 active 只代表治理登记，不能宣称完成原件迁入、专业签审或解冻旧底稿。真实客户来源/材料上云仍需单独授权，测试仅用隔离合成数据。

## 完成证据

旧真实 IndexedDB/UI 只读导出、来源突变/缺项/编号拒绝；server 独立审核权/跨团队/旧五身份不可借权/重放/CAS/凭据及设备撤销/异步竞态/事务回滚/原号保全；main opaque 来源/取消/换号/未知 receipt，正常 renderer 流程。至少一轮严格 Windows Electron 合成闭环从旧 UI 文件到真实审批，再用首 owner 确认准确项目能力；原生文件选择若由 harness 拦截如实标记，不代替真人或 Mac 验收。相关检查后固定源再运行原可移植完整回归，独立 agent 审查。共享预览更新前做真正只读在线备份，旧表全部行/DDL保全。未推送、未进 main、未发布。
