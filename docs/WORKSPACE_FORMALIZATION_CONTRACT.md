# M4L 采集工作区正式业务确认与来源关联执行合同

2026-11-16，base 50eb46516d16785537e0ccdbf3a1a863c87be12f，branch codex/workspace-formalization，TEAM-M4。上一轮为progress：M4K代码、Windows及3493完整回归已本地交付。开工clean；远端main060a98e/report894078b保持。1041 tracked／50,393,214B已逐SHA备份在D:/codex-temp/shenyi-workspace-formalization-20261116/baseline及manifest。沿codex-long-task-guard，一个实现单项。

## 用户决定与真实语义

用户本轮明确选择：项目负责人核验已保存的中标／立项来源，验证密码后确认，系统记录为其业务确认。不新增独立审核员，不借project.migrate或技术管理员资格；只当前有效本团队manager/partner、现工作区owner，管理员兼任仍须已有批准，其他身份沿现projectContext拒绝。源文件只能证明旧记录一致性，不能冒称服务端自动验证真实招投标、实时最新中标或专业审计签发。

旧正式业务身份Q=quote UUID，新团队采集资源W为server UUID。两身份分列关联，W、creator、不可变creation receipt/kind、任务／指派／原件／历史／已有权限均保持；不重键、不搬文件、不改源JSON里的Q。关联是负责人在确认时对已保存来源作业务确认；当前服务端无报价结果账本，不自动同步以后lost/cancelled/风险分类变化，历史快照不得伪装实时状态。

编号固定身份是首次won的year/sequence/firstWonAt；显示完整businessNumber沿当时riskLevel/projectType组合校验，原规则不改。首次won、立项引用won与latestwon可以不同；不能把立项引用强制改latest。报价snapshot.totalCents只展示“中标报价金额，非最终项目金额”，不自动设最终项目金额／合同。

本片实现正常桌面：新建采集W→已有任务/原件→负责人选已保存旧正式来源Q→核对W/Q、名称及来源→密码与业务核验明确确认→server不可变业务记录与回执→fresh项目显示已确认正式立项→原采集权限与原件仍可按原权使用。一次业务确认、W/Q一对一，首片不接改绑／撤销／覆盖或合并。后续源更新另立追加修订流程，不暗改本次记录。

材料仍保持既有namespace约束及独立五权限；本片不能改包内Q为W或放宽Q=包内projectId检查，不能因确认自动解锁材料。UI须说明已业务确认，但材料W/Q接入仍待下一单项。旧M4F登记项目材料行为保持。本片不称所有正式模块或整商业化Goal完成；下一M4M应接有证据的W/Q材料身份适配。

## 精确接口与投影

新增5窄RPC，原109→114，原顺序保留：
- getWorkspaceFormalization → workspace-formalization，input {teamId,projectId}。
- chooseWorkspaceFormalizationSource → workspace-formalization-source-open，input {teamId,projectId,projectRevision}。
- confirmWorkspaceFormalization → workspace-formalization-confirm，input {handle,sourceSha256,teamId,projectId,projectRevision,currentPassword,businessConfirmed:true,confirmed:true}。
- getWorkspaceFormalizationReceipt → workspace-formalization-receipt，input {teamId,projectId,requestId}。
- discardWorkspaceFormalizationSource → workspace-formalization-source-discard，input {handle}。

HTTP GET /api/teams/:teamId/projects/:W/formalization 返回 {context}，context精确 {teamId,projectId,projectRevision,canConfirm,confirmation}；confirmation为null或下述receipt，canConfirm仅active且未确认的现owner。GET可读frozen，archived拒绝。只对现合格owner开放，不由collection.read推导来源读取权。

HTTP POST 同路径，body精确 {requestId,source,sourceSha256,projectRevision,currentPassword,businessConfirmed:true}，201 {receipt}。GET同路径/receipts/:requestId返回 {receipt}；现合格owner同W/team当前scope才可查，未知/foreign/失权同404。查询不绑定旧lease，正常重连可核，404不证明在途永不提交。

receipt精确12键：{requestId,teamId,projectId,sourceProjectId,sourceTitle,sourceSha256,businessNumber,confirmedBy,confirmedAt,projectRevisionBefore,projectRevisionAfter,confirmationMode}。confirmationMode固定owner-attested-local-source；sourceTitle/原号来自规范已校验来源，confirmedBy/时间来自server；revisionAfter=Before+1且安全整数。receipt永久创建时快照，不替代当前capability。

main选择结果 {status:'selected',handle,sourceSha256,summary}；取消 {status:'cancelled'}。summary精确 {projectId,title,businessNumber,initiationRevision,workspaceRevision,firstWonAt,initiationWonAt,latestWonAt,quoteSnapshot}；quoteSnapshot沿LegacyProjectSource原8键 {projectName,issuer,customerName,firmName,auditYear,quoteDate,totalCents,projectType}，类型/边界遵旧codec，不自行补值或变金额。main返回必要摘要，不返回raw source、path、密码或token。

client/renderer成功value采用direct context5与direct receipt12；只有HTTP包外层。confirm main返回 {status:'confirmed',receipt} 或 {status:'unknown',requestId}；choose上述selected/cancelled，discard {discarded:true/false}。

旧ProjectView8保持，新未确认W9保持kind:'collection-workspace'；已确认W精确10键，仅额外businessConfirmed:true。kind仍为不可变origin，不改为formal或删creation记录。其他额外键、false/非bool标志、非工作区附该标志一律拒绝。高级授权项目列表与详情同scope显示最小业务确认状态，不泄Q/金额/来源；详细回执及本机来源只owner可见。

## 服务端与数据约束

新增单表 team_workspace_formalizations 保存完整规范source JSON/SHA、W/Q、当时显示号及固定编号身份、三个中标引用、确认人/时间、项目前后版本、语义request SHA和固定confirmationMode；该表同时是不可变业务留痕和永久回执，不复用M4F governance provenance冒充专业审批。原source policy的identityAuthenticated/professionalApprovalClaimed=false保持，认证的是本次负责人业务确认。

所有原69表209非内部DDL逐字保持；不重建旧表或旧CHECK。新1表，预计7新trigger（update/delete禁止、insert一致性、M4F反向冲突、creation请求反向冲突、team_projects INSERT及实际key UPDATE保留Q反向保护），预计70表217对象，以实际冻结DDL为准。确认时app只CAS推进W metadata revision一次，不改旧creation/权限/任务/附件/原件/活动/已存材料/账号/设备/identity epochs。正常设备请求nonce及技术频率桶增量单列，不当业务数据。

W现owner、未确认、active；source完整沿旧LegacyProjectSource validate/encode/inspect，canonical SHA匹配，原128KiB上限、三won时点/最新结果/快照/编号规则全保。业务核验checkbox和密码必须明确。body后、KDF后、BEGIN内、插入及最终metadata/source回读后重验actor/session/device/credential/identity epoch/team/owner stamp；ABA、MAX安全整数、审计失败、资源事实篡改全部回滚。最终metadata revision=Before+1，其他创建事实/标题/状态/caps保持。

同W只确认一次，Q全域仅关联一个W；同team年度/顺序号与现M4F及新关联双向冲突，不能靠改risk/type拼出不同显示号重复领号。Q若已属于其他team/project（包含已M4F登记或另一W）明确409，不自动合并/收养；Q等于本W仅在无其他归属时允许。后续新项目/旧迁入不得占用已保留的Q；newformal/creation/M4F这三类来源操作的requestId双向防重用。重复或未知提交不自动再POST，不泄其他来源内容。

getProjectAccess团队、旧ProjectView8/未确认9、材料namespace拒绝与五权及M4F正常流程保持。这里只投影新businessConfirmed:true，不能向其他高级成员泄露金额、Q或raw source。device-policy历史检测需包含新表，缺失serverId仍fail-closed。

## 桌面、UI及结束验证

main新独立manager复用已验M4F模式：文件私有句柄、确认时重解析main私有bytes快照及SHA（不二次读磁盘、不保path）、单flight/已用requestId、actor/device/projectCAS绑定，beforeSend/onDispatch/assertCurrent；renderer不能提供source/path/creator/确认时间/自定mode/任意URL。选择前及held dialog返回后fresh owner context，失权0文件读；源码/密码仅main私有内存，关闭/换actor/device/project清秘密和选源。确认后known拒绝可显式重新选择发起新请求；实际可能发出后unknown仅查询原ID，404不能释放重试锁。

selected.handle就是选源时main生成、POST前公开的requestId，不新增第二个编号。所选来源依据同一私有bytes快照，磁盘后续修改不自动跟随，变更须重新选择；不声称确认时已拒绝磁盘文件TOCTOU。

同actor/team/W关开面板保留pending/unknown公开ID与锁；新actor不显示旧资料，迟到401不清新账号。手动回执查询不覆盖当前搜索或新选择，不把receipt当当前caps。成功但刷新失败保“已确认”，不能重复确认。正常新项目创建receipt保持创建时未正式立项事实，fresh currentProject可显示businessConfirmed，不能把旧receipt改写。

沿现brand/Extension，21form/26密码，项目owner详情内新增一个确认表单、当前密码与明确业务checkbox。W、Q和名称差异/三个时点及报价金额限定说明必须可核；不显示文件真实路径。已确认时显示确认人/时间/原显示号/SHA/来源身份，强调人工业务确认与非实时同步，不开放本片材料适配或专业签发。

分工：server agent独占新schema/policy/API、database/application/project-access kind投影与M4F/creation跨冲突、device history及新server test；UI agent独占team-ui.js/index/newUItest/新native；root独占client辅助/main manager/bridge/preload、client/main/entrytest、contract/docs/进度与全部旧精确适配；独立agent独占新安全测试与关键审查。需要新增shared pure source helper时先与root约定文件，避免循环依赖。

先新专题及直接旧相关，固定源后实际Windows正常W创建/任务原件→旧保存来源选择→负责人确认→fresh10投影/原件与权限保持/误用材料仍拒绝、COMMIT丢reply恰1POST+重连只GET；旧来源历史证据仅作为fixture，不冒真实业务核验。独立role/team/owner/request/Q/yearseq/lease/KDF/body/BEGIN/audit/CAS回滚、schema旧209DDL和typedrows保全。相关旧原生按影响选定一次，不无故重跑全21组。

完整沿原Node24命令 scripts/test.mjs --unit --strict；旧固定RPC/表单/密码精确更新109→114、20→21、25→26，CFB DIFAT109/PNG24/ZIPoffset等业务数字绝不改。完整catalog与所有历史DROP/before数量夹具开跑前审计；维护历史66/189夹具必须额外移除本片新schema以重建真旧库，不抬历史期望、不删断言。最终full源冻结，首失败保留不覆盖，唯一外部out各轮wx。

共享升级前四真RO onlinebackup，旧69表209DDL全typedrows含auth无豁免、ordinary9/review16及两UUID保持；新formal表空、旧材料/创建表保持空。不自动创建业务确认或授权。两个原cmd真实验证、普通正常关闭/审核保留；不碰8773旧端用户数据。仅本地提交，main/一键/线上单列，M4与完整Goal继续active。Mac/真实客户/正式供应商/支付/国内生产/两负责人业务签收仍未完成。
