# M4I 团队资料原件维护执行合同

2026-11-16，base `12b9213a5ca6e64b5b667e4aa9312ab697288f32`，分支 `codex/team-material-maintenance`，仍仅 TEAM-M4 实现中。前片 M4H 已本地提交、完整3184及20旧原生兼容和独审通过；本片开始前1006个tracked文件全部原字节备份至 `D:/codex-temp/shenyi-team-material-maintenance-20261116/baseline/`，同级manifest及Git等价报告。开工1003 raw与base一致；viewer、STATUS和旧project-access-client三份既存换行差异均canonical一致，保原样，不把它们当新改动或重写旧测试。

## 用户决定与目标

用户已明确确认：项目负责人验证当前密码后，单独授予自己或本项目合格经理／合伙人“新增原件／移除关联”维护权。移除保留原件及全部历史。维护权独立于read/import/review/close，维护还必须有read；owner、技术管理员、审核身份、职级及其他模块权限不自动附送维护权。

本片仅做正常桌面明确授权 → 当前叶标题选择一份原件并真实正文准入 → 明确确认发布 → 按原规则重置该叶核对状态 → 明确理由移除当前关联 → 全历史原件仍可按read保存／预览 → 撤权、停用、设备／账号变化和版本冲突零发布。实际可信actor另存服务审计，旧历史姓名不映射账号。客户端不提交自由reviewer、完整record、任意命令、URL或文件路径。

不增加标题模板／整树换代、覆盖文件、采集提交自动并入、正常项目创建、报告签发、客户资料迁入、支付或整体UI重做。不存在原件“替换覆盖”动作，同名也只能新UUID原件；原件表与原始source记录不得UPDATE/DELETE。不因本片为旧schema1自动创建标题或升级专业格式。

## 沿用原专业规则

原 `AuditChecklist.apply` 的 `attachment-add`／`attachment-remove` 原样复用，不改dist专业代码：仅当前schema2叶节点及generation、每叶当前最多10份、单份1B..12MiB、全部历史累计150MiB且移除不释放额度，原5000事件及8MiB模型文字等边界继续有效。closed拒新增／移除，必须由独立close权按原规则说明理由重开；team frozen拒写但依read可看，archived全拒。

新增／移除后按原receipt重建状态：还有原件为received，最后一份移除为pending；confirmed或na不会保留，需有review权者另行核对。必须在操作确认中说明这个影响，不自动核对、重开或关门。每次专业record revision及独立materialRevision各+1，原sourceRecordRevision、package SHA和首次导入事实保持。

## 信任与存储

优先两张加法表保存独立维护授权及真实attachment-add/remove事件，保旧66表189DDL及全部旧行；存量维护默认false，不重建原immutable audit表。维护grant绑定当前旧read授权代次，自有revision/eligibility，旧read／业务资格失效不能在角色ABA或重新read后自动复活。所有新旧requestId（包括import tombstone）统一冲突检查，不伪装为核对item，不重放已发mutation。

单文件base64加受限元数据的一次签名JSON小于原17MiB设备gate，不新增chunk staging或放宽gate。bytes、归属node/generation、版本及requestId都在已签名body/path内。server生成新fileUUID、可信显示姓名与时间；实际字节/长度/SHA及同源旧prepareFile校验通过后，file INSERT＋当前record CAS＋维护审计与回执在一个事务发布。任何await／KDF／最终事务／审计触发后重新核账号、设备、团队、业务资格、五项模块权及project/material/recordSHA版本。回滚不得残留原件或半份记录。

root负责 `shared/material-admission.cjs` 仅新增 `prepareMaterialFile(file,{assertCurrent})`：复用旧 `Checklist.prepareFile` 和原inert DOMParser，返回原{name,size,type,sha256,blob}，处理前后guard；原inspectMaterialPackage行为不变。main与server均使用它，不复制格式规则、放宽宏/XML/大小检查或执行外链。以真实bytes计算SHA，不信renderer摘要。

## 桌面与分工

沿批准desktop/brand-spec方向，复用现有材料面板，明确勾选维护权、选择当前叶、预检单份来源、确认新增及说明理由移除。主renderer不接收路径／原件bytes／正文模型之外的通用接口；来源在main内存私有句柄，选择、取消、换项目／actor／device／面板、过期／失权均清理，A迟到不得清B，unknown只能查原requestId回执。既有预览及fresh HEAD／原子保存链保持。

server agent独占server/team产品及其新专项；UI agent独占desktop产品、新client/main/UI专题及新strict native；root独占shared admission、对应新正文测试、docs/进度/BACKLOG以及旧精确RPC/DTO/schema计数适配；独立agent只增独立安全测试和读验工件，不改产品或旧断言。所有旧文件已有全量备份，不重置／清理／覆盖无关WIP。以下HTTP、RPC和精确DTO已由三方只读调查汇合并由root冻结，可按归属开始实现。

## 冻结的 HTTP／授权契约

令 M 为现有 `/api/teams/:teamId/projects/:projectId/materials`。四旧权限保持，GET M/access在旧字段外增加maintain:boolean。GET M/members每个row增加maintenanceRevision:safe integer>=0、maintain:boolean。POST M/access新精确body为旧字段再加maintenanceRevision、maintain；后四项包括maintain均依赖desired read。旧exact四flag body可保留严格legacy分支，仅操作旧四权，不暗授维护；新两字段必须成对出现，不允许半套或未知字段。

维护grant自身revision与read-grant revision绑定；有效条件包括同一旧read代次、旧read/eligible、维护eligible及can_maintain。memberRevision、grantRevision、maintenanceRevision、projectRevision全部CAS。旧四权未变就不无故更新旧row，maintain=false且无维护row时不创建空row；正向或撤销维护变更自有revision及projectRevision。组合授权可能使projectRevision增加多次，审计记录实际前后值，不把实际+2/+3伪记+1。完全相同且无需失效处理的授权请求为no-op，返回409并保持全部业务row、授权版本、项目版本及审计不变；不为成功ACK制造空row或虚假递增，成功ACK仍严格要求项目版本增长。密码/KDF及最后事务后再次核业务资格与三个授权版本。存量升级两新表空，旧row/DDL不变。

- POST M/files：精确 `{requestId,projectRevision,materialRevision,recordSha256,nodeId,generationId,filename,mimeType,byteLength,sha256,contentBase64}`，签名body上限原17MiB。canonical base64、1..12MiB、实际字节长度/SHA/旧正文准入及规范filename/type全核对；generationId必须与当前record精确一致。server生成fileUUID、可信actor和时间后A.apply，原子新增original、更新record、追加维护审计。
- POST M/files/:fileId/remove：精确 `{requestId,projectRevision,materialRevision,recordSha256,nodeId,generationId,reason}`；fileId必须为当前leaf当前代关联，reason沿原1000字符非空规则。只改record关联及审计，不改原件或原source。
- 两项都需read+有效maintain+active+open schema2，不额外要求操作密码，也不复用review/close/import作为资格。
- GET M/receipts/:requestId仍须当前read、同项目、原发起人；旧四kind保原10字段。新kind attachment-add／attachment-remove的精确回执为旧10字段加fileId,nodeId,generationId，共13字段。importedAt/packageSha/sourceRecordRevision等来源事实保持；recordRevision/materialRevision本次各+1。
- requestId不可跨任何旧material events、新maintenance events或imports永久tombstone复用，首次与最终事务都核。import commit只可消费其当前已绑定active stage自己的slot。旧动作不接受attachment-*，新维护不接受item/close/reopen/tree-replace或自由record/reviewer。

## 冻结的桌面 RPC／来源契约

新增四个窄method／channel，100→104；只加一个无密码维护form，18→19，密码框仍24。channel为 `shenyi:project-material-attachment-open`、`-discard`、`-commit`、`-remove`。

1. `chooseProjectMaterialAttachment({requestId,teamId,projectId,projectRevision,materialRevision,recordSha256,nodeId,generationId})`。requestId在picker前由renderer生成且用于取消和后续单发，main精确校验。返回 `{canceled:true}` 或 `{requestId,filename,mimeType,byteLength,sha256}`。先核权/快照再picker，返回后、真实读文件后、同源prepare后核当前guard/权限/快照；最终保存名（可能按旧safeName规范化）要显示给用户。路径和bytes不离main。单份source TTL10分钟，最多一份，判过期时清可控缓冲。
2. `discardProjectMaterialAttachment({requestId})` → `{discarded:boolean}`，只取消此ID尚未发布的来源／picker，不接受null，不清后来B、不伪称撤回已发mutation。
3. `commitProjectMaterialAttachment({requestId,teamId,projectId,projectRevision,materialRevision,recordSha256,nodeId,generationId,sha256,confirmed:true})`。必须匹配main私有同一来源及快照，fresh检查后单次真实POST；bytes/meta仅main内部client组body，renderer不传它们。无权或CAS失败零发布。
4. `removeProjectMaterialAttachment({requestId,teamId,projectId,projectRevision,materialRevision,recordSha256,nodeId,generationId,fileId,reason,confirmed:true})`。仅当前关联、明确理由与确认，按同一快照及guard单发。

新增/移除正常返回 `{status:'committed',receipt}`，发出后可能已提交但丢回复／上下文变更返回 `{status:'unknown',requestId}`；保已知ID，只GET原回执、不自动重发。来源、bytes及可控Buffer在取消/过期/面板关闭/换项目/actor/device/失权/成功后清理或释放；A的迟到错误/返回/取消不能清B。并发锁必须覆盖旧导入／核对／关门与新维护的UI；server CAS和签名device是最终裁判，不能只靠renderer禁用。

## 验收与结束门

先单文件真实正文及server/client/main/UI专题，再独立权限/ABA/CAS/跨团队项目/旧read和历史原件/闭门与冻结/回滚/unknown单发。真实Windows从正常界面grant→导入合法旧包→确认项add→重置→预览／保存新旧原件→remove保留历史→held上传撤权0发布，禁止SQL直接给维护权替代正常链。来源延用M4H实际旧UI的合法合成包，不改旧本机或客户资料；真人picker、Mac和生产分别保留。

最后冻结所有运行/测试源，原Node24 `node scripts/test.mjs --unit --strict` 完整通过并记录前后hash；旧原生兼容和实际浏览器/原生/数据验收分层，不把纯测试当真人验收。共享预览任何schema升级前先真RO在线备份并逐表核旧行/DDL保持，新表空、不自动增权或写业务数据；未获根agent授权不得操作当前共享窗口或库。关键结果独审后仅本地提交，单列main／一键／线上状态；M4与整个Goal仍active。
