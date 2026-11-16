# M4N 团队资料完整保全导出执行合同

2026-11-17，TEAM-M4，base `5cb525645b9d0fd020ab3c5c765427b93ea58446`，branch `codex/team-material-preservation-export`。上一轮为 progress：M4M已本地提交，完整3672项及Windows原生/旧7组/独立验收通过。当前开工clean，远端main060a98e与report894078b保持。1067 tracked／50,826,670B逐raw备份在 `D:/codex-temp/shenyi-team-material-preservation-export-20261117/baseline/`；一次batch核全Git对象，仅9份既存CRLF差异，不规范化原文件。

## 结果与范围

正常材料read用户在当前资料区明确确认“当前record及全部历史引用原件（含已移除／旧代）”，选择保存位置后得到标准保全ZIP；原Q、record原文、UUID、closed、事件与所有原件字节保持。v2包可经旧端正常预检与明确确认，恢复到既有同Q/同namespace的空本机资料区，原空态／孤立文件／全局UUID冲突／原件正文准入检查保持。正常团队UI→服务端整包→原子保存→隔离旧端显式恢复是本片实际闭环。

权限沿已确认material.read（已涵盖完整record与全部历史原件逐件保存）；不加review/close/import/maintain/owner门槛，不给junior、技术身份或任意senior默认权限。active/frozen可按read导出，closed不阻止；archived拒绝。空资料区record:null不能制造空假包，合法record但0原件可导出。W是路由/授权/资源身份；Q留在manifest.projectId及record.project.quoteId，legacy要求W==Q，collection-workspace允许不等或相等，不能按字符串相等猜kind。

本包不包含formalization原source JSON／报价金额、其他模块workspace、底稿原包、合同/发票/成本、其他数据库、未引用文件、员工身份或团队授权。不是完整软件/数据库备份、实时业务证明、专业签发、服务器签章或自动团队恢复。立项资料的新查阅/导出政策已单独询问，待答只影响后续专业模块，本片不扩用材料五权。

不改专业公式、模板、编号、业务状态机、A存储结构或旧v1兼容语义；只为本出口改codec、旧恢复来源提示及新增受权I/O。无新DDL/业务表：70表217定义、全部旧业务行保持；正常nonce/HTTP限额写单独如实核验。现有team-import明确仍仅接v1，不能因inspect支持v2顺带开放新格式团队恢复。

## 固定协议

两个独立GET（无HEAD新增）：`/api/teams/:teamId/projects/:W/materials/export-plan`无query；`.../export-package?projectRevision=...&materialRevision=...&recordSha256=...&planSha256=...`恰四项，单值、canonical decimal/hash，拒重复/未知/非规范值。plan不是票据，binary重新授权；无scope/未知/无record统一404，快照变化409，超界413，资源忙有界拒绝且不自动重试。

plan精确18键：`teamId,projectId,sourceProjectId,resourceKind,projectStatus,projectRevision,materialRevision,recordSha256,recordSchema,recordRevision,generationId,recordByteLength,fileCount,originalByteLength,filesSha256,packageByteLimit,serverId,planSha256`。resourceKind仅legacy或collection-workspace，status仅active/frozen；serverId为既有公开服务UUID。版本是合法safe整数，读取允许MAX，不因无递增而错误拒绝。schema1 generationId为null，schema2为原UUID。packageByteLimit固定180MiB。filesSha256为P.filesFor(record)完整metadata数组的规范JSON SHA；规范JSON对对象键递归UTF16排序、数组顺序保持、紧凑UTF8。planSha256为其余17键规范JSON SHA。plan不含record正文、BLOB、凭据或临时URL。

v2仍为 `format=shenyi-material-preservation`、schemaVersion=2，顶层原9键＋origin。policy精确原10键，仅teamImported=true，其余包括identityAuthenticated=false/professionalApprovalClaimed=false保持。origin精确12键：`teamId,projectId,sourceProjectId,resourceKind,projectStatus,projectRevision,materialRevision,recordSha256,recordByteLength,filesSha256,serverId,planSha256`。record的schema/revision/generation、文件数量/总bytes及固定limit从包内容导出，以此重建plan并核planSha；origin.recordSha等manifest及真实record字节hash。origin中的W与manifest中的Q明确区分，legacy W==Q；v2仅正式namespace、拒TRIAL。

新增专用 `MaterialPreservation.createTeam({record,origin,readFile,readCurrent,assertCurrent,createdAt?})`，原create精确选项及v1输出不变。readCurrent精确返回{record,origin}，初始/最终共同签名复核。inspect显式接受v1/v2；summary保持原14键不扩。两版同ZIP32 STORE/CRC、精确成员/UTF8 JSON/原record字段顺序；每文件12MiB、原件合计150MiB、record24MiB、manifest4MiB、包180MiB、最多5000文件，均不放宽。v2来源是未验签声明，不是认证或授权证明。

旧端只把v2 origin另存本次pending job用于预检/恢复提示，不写进专业record/文件/存储sidecar；原包须另留。本机以后再导出不保留团队origin。v1 teamImported=false只描述该本机包不提供团队迁入或归属证明，绝非lifetime never-team。直接v2团队导入拒绝是协议边界，不能承诺阻止持包人重新制作本机包；任何团队迁入仍须当时权限与Q归属审核。

## 后端与私有字节

复用projectActor/currentActor、materialContext(read)和materialSqlScope，不能由collection.read或owner放行；当前actor/strict lease/业务资格/模块grant/项目CAS/稳定WQ身份全fresh。先同步只读快照读scope record和全部metadata（不BLOB），释放BEGIN后才await，不能跨await共享事务。验证原record SHA/A模型/Q及raw JSON规范字节，P.filesFor包含全部历史且与数据库file metadata/数量一致；超界或遗漏在读BLOB前拒绝。

binary重建同plan比四项expected。每readFile前后fresh actor/lease/ACL/CAS/identity及current material_revision/record_sha256，BLOB查询自身带SQL scope/team/W/fileId，metadata各列与原引用精确相符，own copy并核实际长度/hash。完整record/metadata初始和最终重验；每个原件不重跑整个filesFor或24MiB JSON，避免O(N²)。createTeam内部每await前后调用assertCurrent，末尾完整record+origin/plan再核后才返回私有Response。不更改120/min或心跳；整包一次binary HTTP，不能用5000逐件请求方案。

binary响应须private/no-store/安全disposition、Content-Type精确application/zip、Content-Length规范十进制与实际bytes相同；X-Shenyi-Material-Export-Sha256为实际ZIP SHA64，X-Shenyi-Material-Plan-Sha256为捕获plan SHA64，拒多值/异常/不一致，不把错误body当包。单process最多1个build，无无界排队；授权/参数先核后占资源。昂贵生成额外每actor最多4/min，沿现auth限额表，不新业务表；未授权不能观察他人身份/资料，busy仅通用错误。180s生成/读取硬上限，取消/请求signal/资格变化及时退出并释放资源，不能谎称撤回已合法交付字节。

私有SDK固定两个方法：getProjectMaterialExportPlan仅teamId/projectId；downloadProjectMaterialExport输入固定teamId/projectId及binary query四项，私有hooks含assertCurrent与signal，不能把这些配置透传renderer。普通JSON/12MiB文件读取限制和超时保持，新binary方法独自使用180MiB/180s。

## 桌面闭环

仅新增两个窄RPC：`exportProjectMaterialPreservation`和`cancelProjectMaterialPreservationExport`；精确input含当前team/W、projectRevision、materialRevision、recordSha256、requestId、confirmed=true，cancel仅requestId。renderer不传Q、origin、record/BLOB、URL或任意路径；plan/binary私有SDK派生。main先私有getProject固定requiresMapping（W==Q也不降级），fresh plan核当前显示版本、kind/Q及摘要。

界面复用现record/history计算全范围说明，独立checkbox+导出/取消按钮，不新增form或密码；预计116RPC／原21form／26秘密，若实际变化须回合同核。先有真实Save目标才生成/传整包；取消保存不读BLOB。Save返回后fresh plan→binary bounded读取/全部codec校验→fresh plan→wx临时文件/同步→rename前最终异步fresh plan及actor/device guard，原子发布。失败不截断旧目标、不留本次temp；成功只回必要receipt，不回绝对路径或私有字节。

RPC保存requestId与私有epoch，取消/换项目/换actor/暂停先失效并abort transport；迟到A不能取消/清除B。旧late401不清新账号，已发布不假称取消撤回。180MiB受限binary请求只对本私有方法开启；不得放大普通JSON/原件上限或接受任意renderer URL/timeout。网络每await/每块guard，包检查及临时写、rename前复核，清本次缓存与秘密。最后fresh+guard后、调用rename前同步置publishing，作为原子发布开始点；此后cancel=false，不删除目标或谎称零发布。rename成功后的会话失效仅回MATERIAL_EXPORT_PUBLISHED固定通用信息，不回旧filename/SHA/path，旧renderer epoch忽略；rename调用后报错按结果需核对处理，不自动重试或删除用户目标。0delta负例明确位于发布点前。正常成功精确{saved:true,requestId,filename,byteLength,sha256,fileCount}；保存/发布前取消精确{canceled:true,requestId}；cancelRPC精确{canceled:boolean}。用户已合法导出的副本不承诺远程收回。

## 分工、门禁与保全

codec agent独占dist/material-preservation.js、dist/audit-program.js、shared/material-admission.cjs及新codec/恢复测试；不改A专业状态机。server agent独占新materials-preservation-api.mjs及必要application-api接线/新server测试，零DDL。UI agent独占新desktop导出manager/private client、team-client/bridge/preload/main和team-ui必要接线/新client-main-DOM测试/新Windows driver；不改codec/server。root独占合同/使用/四checkpoint及全部旧验收适配、full/共享收口。独立安全agent不改产品，另审关键权限、codec/ZIP与TOCTOU。

先新专题与直接相关旧tests：v1不变/v2全历史/0文件/schema1/2/MAX/5000及边界、CRC/路径/重复成员/伪造origin/kind/WQ/plan/hash/版本拒绝；现team-import main/server拒v2；旧UI同Q空目标恢复原record/BLOB及globalID冲突不写。真实strict API跨team/W/Q、无read/角色/设备、archived拒绝、closed/frozen可导出；所有await revoke/ABA/CAS/超界/worker失败零业务发布。main取消/Save取消/held Save撤read/held binary换actor及lateA→B均旧目标保持、零temp/write/rename。

新strict Windows正常创建/确认W→独立read/import→旧v1包导入→material-only partner明确全历史导出v2→inspect及隔离旧端正常UI空同Q恢复；实际Word正文/表格/像素或原件byte/hash逐项核实。junior/tech/foreign拒、closed可读、取消/撤权/late回复与源变化拒；4新profile/vault、阶段SQLite、原文件/BLOB/history及schema保持，合法写出与撤权零增量分别计。独审后原Node24 scripts/test.mjs --unit --strict，按健康进展等待；新失败先审前提不弱化旧断言。旧原生组按影响选取，不把未跑全部组称全过。

共享仍四真RO onlinebackup，70表217定义/所有typed行包括auth无豁免，ordinary9/review16及两UUID、8材料+creation+formalization空。两原cmd真实启动、fresh进程/协议/窗口，普通正常关、审核保留；不得凭历史PID。无push/main/上线/购买/客户资料上云，Mac/真人选择器/客户业务/生产及两负责人验收未完成，M4/完整Goal继续active。
