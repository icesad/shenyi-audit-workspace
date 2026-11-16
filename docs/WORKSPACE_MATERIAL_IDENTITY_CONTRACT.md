# M4M 已确认工作区资料身份适配执行合同

2026-11-16，base `f623571f2cda9c33d23d744284ebb6cfc48f30e6`，branch `codex/workspace-material-identity`，TEAM-M4。上一轮属于 progress：M4L已本地提交并完成3586项完整回归及原生／独立验收。当前开工clean，远端main060a98e、report894078b保持。1055 tracked／50,630,586B逐raw备份在 `D:/codex-temp/shenyi-workspace-material-identity-20261116/baseline/`；同级manifest批读Git全部1055对象证明仅9份既存CRLF差异，不人为改写原文件。沿 codex-long-task-guard，仅本单项实现中，整体Goal active。

## 完成目标与授权边界

正常经理／合伙人创建W采集工作区→先完成任务及原件采集→按M4L核验已保存来源Q并密码确认→负责人通过既有五项资料权限逐项明确配置→获read+import者选择原Q正式资料包并密码导入→资料-only读者在W发现并读取完整清单／历史／原件→按独立review/close/maintain完成原规则核对、关门／重开、新增／移除关联、预览及保存→失权、冻结、版本冲突及未知结果仍严格处理。

W为团队资源身份，Q为专业业务身份；W≠Q及合法W==Q均可。旧M4F项目P==Q按原逻辑保留。URL、ACL、项目发现、task、材料行／文件行、staging、事件、回执及CAS全部继续使用team+W；只有资料包manifest.projectId、record.project.quoteId保留Q。不重键／搬文件／改包ID／改record原身份，不从Q反查或回退访问W，不按名称猜关联，不自动迁入客户资料。

既有read/import/review/close/maintain五权独立，owner只管配置，不自动得到读取或专业权限；维护依read及同一read授权代次，关门权与核对权分开。当前角色、管理员兼任批准、单团队、设备持钥、项目冻结／归档及原模型规则保持。不增加业务职级、独立审核员、收费或生产能力，不整体改UI，不改专业dist／公式／模板。没有需要重复询问的已定权限政策。

M4L确认是历史业务事实。映射不能要求原确认人现在仍active／owner／保原密码，也不能要求当前项目revision等于历史确认后的revision；否则正常授权和后续资格调整会错误阻止其他合法读者。当前actor及实际权限始终另外fresh检查。

## 唯一服务端身份解析

新增低层 `server/team/materials-identity.mjs`，避免依赖project policy造成循环；统一提供固定alias SQL资格、JS解析及稳定identity stamp。

- 非W保P作为专业ID；旧读取／配置不新增M4F前提，只有首次legacy import继续要求原M4F provenance。
- W必须有同team/W的真实creation及一致不可变formalization，Q只能从服务端source_project_id派生；未确认W即使误存五权也拒绝。不得接受renderer的Q、kind、source SHA或映射参数。
- 对实际不可变关联的team/W/Q、request/source摘要／origin关系进行一致核验；可信source JSON沿旧codec与其自身SHA检查，不把现actor绑定为历史确认人。身份stamp包含稳定映射事实，当前项目CAS另管。
- materialContext、materialSqlScope、materialVisibilitySql和projectContext的资料-only发现使用一致资格；不能只放开一个kind判断。SQL只用固定alias及绑定参数，不出现从Q猜测授权的分支。
- 所有fresh边界增加identity stamp比较，覆盖读取body、每块、全部历史正文准入、KDF、BEGIN、发布及最终审计／资源回读；映射失效或变化一律拒绝／回滚，不回退legacy。
- 导入严格 `manifest.projectId === record.project.quoteId === trusted Q`，保正式namespace、原包hash及全部历史原件准入。此后读取／核对／维护也核record的Q；files GET/HEAD仍只按team/W/fileId读取，交付前fresh身份及read。

formalization.source_sha256是立项来源JSON摘要，material.package_sha256是资料ZIP摘要，两者不同工件，绝不互比。Q相同加全包完整性仍不证明现实中标／专业签发或同一次立项快照。原记录只有quoteId/projectName/firmName，不能杜撰不存在的编号／财务字段；名称差异展示核对，不能重写原名称。

## 存储及精确DTO

无新表／trigger／HTTP／RPC／form／密码输入；当前70表217对象定义全部保持，114窄RPC／21form／26秘密输入保持。材料八表继续按W存；原source_record_json/SHA/revision/package SHA、原件UUID／metadata／bytes及历史完整保留，后续只沿原A.apply。旧所有immutable触发器不改、不绕开。

HTTP access保持精确7键 `{projectRevision,canManageAccess,read,import,review,close,maintain}`，不向无read的资料外成员泄Q。members、access-change、staging、actions、files、receipts接口不新增客户端身份字段。

GET materials record：

- legacy精确8键 `{projectId,projectRevision,materialRevision,recordSha256,record,packageSha256,importedAt,importedBy}` 原样。
- 已确认W精确9键，在上述8键增加 `sourceProjectId:Q`，**空资料区同样提供可信Q**；该接口始终要求独立material.read。outer projectId=W，record内部quoteId=Q；Q严格UUIDv4。
- 详细formalization回执、来源JSON、金额及历史确认人信息仍只按M4L owner接口，不因material.read扩送。资料read者取得Q是其已获权专业record的必要身份，不获得其他项目或采集权限。
- 客户端严格接受上述两种shape，未知／部分／异常字段、外层W错误、内部Q不符拒绝；新分支Q不能从record.project自选。读后fresh access仍须read与同projectRevision；main/UI对捕获的身份分支及Q再做fresh一致校验。normal server对confirmedW始终返回新9，包括W==Q。
- receipt仍10或13键、projectId=W；GET/HEAD私有4字段不变，原未知操作编号不变。

## 桌面与正常界面

统一desktop身份helper `desktop/material-identity.cjs`，消费受权GETrecord外层server派生Q及target W，严格核view外层W、明确新旧分支、record内部Q；legacy fallback只来自严格legacy8分支，不从任意record内容／renderer自报kind决定。main每次涉及包／record身份的正常操作先通过现有私有client.getProject读取可信origin，捕获requiresMapping；confirmedW（包括W==Q）强制新9。只传输标量action的旧main分支不另读无用record，其W／Q对应关系由server执行时fresh核验。不让renderer提交Q或origin，也不按Q是否等于W猜类型。

main导入先核read+import及项目CAS，再取受权record（空区亦有Q）捕获W/Q／身份分支；现存资料仍拒覆盖。选择器前、picker后／真实读后、预检后及commit前fresh复核同一Q／分支／CAS。文件私有快照、包大小与完整历史准入、分片节流、单发／取消／unknown原ID GET保持；不为每块新增冗余main能力GET，服务端每块仍fresh核验。

client、preview、maintenance及保存复用同一身份helper替换旧Q==W检查，而非删除检查。维护snapshot绑定可信Q，预览交给受限reader的record仍原Q且无业务preload；Save前fresh HEAD与record／W/Q／CAS一致后才原子发布。失权／换actor／device／项目／关闭仍清秘密、关预览／零发布，迟到401不清新账号。

预览初始、open前、getSource／reveal数据交付边界fresh GETrecord比较Q／身份分支／CAS；已打开后的原5s复核保持HEAD4，不每5s重复下载最大26MiB记录。HEAD须在服务端fresh解析同一不可变W/Q、验证所属record SHA／模型／Q及现read，仍不读取原件BLOB。Q没有合法改绑／删除路径，后续合法record变更必推进materialRevision，原HEAD4的版本与文件hash／长度继续约束已开窗口；原5s／50s机制不变。

UI只有 `kind=collection-workspace` 且 `businessConfirmed=true` 才结束“未正式立项”硬锁，随后正常请求既有material.access；确认本身不授五权。资料-only项目可发现W，但collection canRead/canReview/canCreateTask保持false；junior及技术身份无新入口。renderer已获ProjectView10时必须要求新record9，不把缺身份的W==Q响应当legacy降级。

来源预检及清单明确展示“团队工作区W／原业务Q”，保持原包摘要、名称及人工核验边界；不泄路径或raw source／bytes，不把旧创建回执改写。沿现brand和Extension，无整体视觉变更。

## 分工与验证门

server agent独占新identity模块、materials policy/scope/API/maintenance及project发现必要适配、新server专题；不能改旧DDL。UI agent独占desktop helper/client/main/preview/maintenance/team-ui、相应新测试和新strict Windows driver。root独占本contract／使用说明／进度／GOAL／BACKLOG／STATUS、全部旧测试及旧native必要语义精确适配、full与共享收口。独立agent独占新独立安全测试和关键源码／工件复核，不改产品或旧标准。

先专题与相关旧测试：W≠Q正向全链、W==Q、legacyP==Q、未确认W、跨team/W/Q／直接Q路径／错包／无资格／伪造DTO拒绝；资料-only发现无采集权；全部await边界资格／lease／ACL ABA、CAS与映射冲突回滚；原source JSON／历史／BLOB exact，unknown恰一commit+原IDGET。frozen只读、archived拒绝、closed与schema1及原额度规则保持。

M4L旧“已确认W仍整模块404”断言仅在对应新能力边界精确更新：未确认仍404；已确认owner可看空权限配置但read/import/review/close/maintain默认全false；未授read的record/files仍404。不扩大到其他拒绝标准。旧native同理适配可见提示与无自动授予，不删除原业务断言；保存可逆原件及逐笔ledger，不动CFB／PNG／ZIP等无关数值。

固定源后实际Windows正常创建W/既有任务原件→M4L来源确认→正常显式资料五权→原Q旧UI包导入→树／历史／核对／关门重开／新增移除／预览保存→撤权heldSave零发布→实际COMMIT丢reply仅1POST原ID恢复；不以SQL直接给资料权替代正常流程。只用隔离合成账号和包，旧浏览器包仅fixture，不冒真实业务证明。独立验收后跑原Node24 `scripts/test.mjs --unit --strict`，预计约24分钟，以实际健康进展等待；旧原生相关组按影响一次运行，不重复全21组。

共享不需schema升级但仍做四真RO onlinebackup，旧70表217DDL及全部typed行／auth无豁免、ordinary9/review16／UUID全部保持，8材料＋creation＋formalization继续空。两个原cmd实启动／协议／窗口验证，普通正常关闭、审核保留；操作前fresh核进程，不用历史PID。不触8773用户资料，不push／main／上线，不把本片或整个Goal记complete。Mac／真人picker／客户资料／供应商／支付／国内生产／两负责人业务签收仍按完整路线逐项推进。
