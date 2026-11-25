# 单项目资料保全与本机恢复（M4D）执行合同

2026-11-16，从M4C本地`eb8ac66`接续，分支`codex/material-project-preservation`，关联`TEAM-M4`。前Goal回合是progress：管理员兼任代码、2407回归、原生/保全及本地提交已完成。12个拟改旧源/文档/相关测试先备份`D:/codex-temp/shenyi-material-preservation-20261116/baseline/`；新增旧文件须改前追加备份。

## 本轮真实结果与尚未具备的前置

旧清单JSON只含元数据，旧归档ZIP不含已移除/旧代附件，不能作完整资料迁移源。本轮补可用的旧端单项目资料保全包：完整清单记录及事件中每个attachment-add引用的原件，包括已移除和旧generation文件；正常旧端UI可导出、选择包预检并明确恢复到同UUID的空本机资料区。目标选择仍来自既有正式立项或独立试用，不创建报价、立项、编号或团队项目。

这是一条真实的旧端保全/恢复闭环，为后续团队显式迁入准备可靠来源；**不是整个软件备份、团队迁入、资料云同步或M4完成**。不含旧版未保存的清单导入Word原文、底稿原包、报价/合同/发票/成本、其他数据库或未在资料事件中引用的外部文件。包中reviewer/confirmed/closed作为原有历史保存，不证明当前员工签审、不自动生成结论。

团队正常项目创建政策仍待答。另已向用户询问既有项目迁入时由谁审核团队与首owner；未答前不实现或偷开团队登记/迁入、不给scope、不从自由经理姓名推断归属。真实客户上云另须授权。当前只用隔离合成数据验证，不读取用户浏览器资料，不触共享team数据库/设备/生产/报告PR，不push/main/发布。保留整个商业化Goal。

## 格式与完整性

新增UMD/CJS `dist/material-preservation.js`，复用原样`AuditChecklist.validate/leafNodes`，不修改专业状态机、模板、公式、UUID、revision、generation或关门/重开语义。

格式为`shenyi-material-preservation`、schemaVersion 1，标准ZIP32仅STORE方法（不解压任意压缩包）。成员精确为`manifest.json`、`record.json`、`originals/<原fileUUID>.bin`。manifest记录sourceNamespace、projectId、record schema/revision/generation、record SHA256、包ID/本机导出时间、各原件ID/entry/bytes/hash和明确范围政策；原件元数据以通过旧validator的完整record为准，不重新编号、不改名或重写Office。

正式namespace `hengdu.audit.materials.v1`与试用`hengdu.audit.materials.trial.v1`分开，试用仅原TRIAL_ID；目标UUID及namespace必须精确匹配，不能试用/正式混入。JSON采用工具生成的规范UTF8 JSON（无BOM/空白/重复键歧义），拒未知字段/成员、坏类型/控制字符及不匹配元数据。record必须保留旧validator依赖的字段顺序，使用原对象紧凑JSON.stringify并以raw===JSON.stringify(parsed)复核；不能递归排序原record。manifest独立固定排序，不改变旧记录语义。

逐个核ZIP local/central/EOCD一致、版本/flag/method、边界/offset/CRC32、大小与SHA256；拒绝重复/路径穿越/绝对路径/符号链接属性、重叠区域、加密、ZIP64、多卷、注释/尾随垃圾、额外文件、缺件、同ID异内容。包的一致性校验不证明第三方签名或来源真实性。

沿旧资料约束：每原件1–12MiB、全部引用历史原件最多150MiB、最多5000原件；record最多24MiB UTF8（覆盖旧8MiB字符树记录），manifest最多4MiB，包最多180MiB、最多5002成员。超出明确拒绝且不截断，旧数据不变。只用标准内建API，不引入库或更改Node/Electron依赖。

## 核心与数据库接口

Codec固定接口：`filesFor(record)`返回全部历史引用元数据；`create({record,readFile,readCurrent,createdAt?})`返回`{blob,manifest,sha256,summary}`，从项目UUID推正式/试用namespace，readFile(meta)返回`{blob,metadata}`，末尾readCurrent再核完整record signature；`inspect(blobOrUint8Array)`读取并完整验证，返回`{manifest,record,files,sha256,summary}`，files为`{metadata,blob}`。文件bytes不返回UI HTML或当脚本执行。输入typed array须复制，Blob为不可变源。

summary至少包含`projectId,projectName,firmName,sourceNamespace,recordSchema,revision,generationId,closed,nodeCount,fileCount,currentFileCount,historicalFileCount,totalBytes,packageSha256`；只作本机预检，不成为团队授权事实。结构由codec agent尽早固定，UI不猜字段。

`AuditChecklist.open/openTrial`增加两个窄本机方法，旧数据库版本2与两store不变：

- `exportPreservation(key,{assertContext?}={})`：一个readonly事务获取一致record及精确历史文件ID/Blob快照，拒绝本项目未关联孤立文件，避免逐文件重复验证整份历史；原件wrapper/project/node/generation/metadata及Blob/type/size/hash均核验，末尾复查原记录，源更新/缺件/损坏/上下文变动拒绝且不触发下载。只读，不修改源revision/历史/Blob。
- `restorePreservation(key,blob,{expectedSha256,assertContext?})`：确认过的包hash必填；方法内部重新inspect不可变文件/自有字节，不信任调用者提交的parsed record。必须目标相同UUID/namespace且没有任何checklist row（包括损坏/关门记录），也没有该项目孤立file row；任一原fileUUID在其他项目/现有store存在也拒绝，不覆盖/合并/去重猜归属。

恢复在开启写事务前，串行对全部历史原件（含已移除/旧代）复用原上传`preparedFile`的内容准入，包括真实格式签名、有效UTF8、XML/Office结构及原宏/加密/实体限制；规范name/type/size/SHA必须与历史元数据完全一致，不静默改名或降级跳过。每次await前后核上下文，返回Blob保持原bytes，不重写Office。该检查不是完整恶意软件扫描；codec预检与导出仅证明结构/完整性，预检通过不保证能通过最终入库准入。旧资料若不符合现行原上传策略，恢复明确拒绝，原包和源数据保留，不偷偷净化原件。

所有恢复检查和add在一个`[checklists,materialFiles]`readwrite事务中完成：现存record、孤立target行、每个全局fileID冲突先检查，再写完整record及全部原件wrapper；任一Quota/DataClone/冲突/注入故障/上下文变更全部abort，不能留半条记录或少文件的历史。并发两个窗口只有一次可恢复，另一个明确冲突；重复包不会自动覆盖现存资料。恢复不追加伪专业审核事件，原revision/generation/events/closed逐字语义保持，原件byte-identical；当前已存在或关门资料完全不动。

assertContext在读取/解析前后及事务最终写入前同步执行；UI项目/视图代次变化取消旧操作。不是跨数据库的全局冻结操作：不写工作区/底稿冻结或其他项目；原资料关门状态保留，后续编辑仍走原有重开理由规则。

## UI与文件归属

沿旧AuditProgram样式增加“导出资料保全包”“恢复资料保全包”及独立预检区，不替换旧JSON导出。导出说明范围，完成时复核当前项目/版本再触发本机下载。恢复先File picker（可取消、不写业务记录或原件），只显示文本摘要/包hash/同UUID匹配/目标空态/历史身份说明；勾选明确确认并确认对话框后才恢复。目标不空/不匹配无继续按钮，直接调用DB方法也必须拒绝。预检/取消不写业务记录或原件；打开目标可能初始化空IndexedDB schema，不冒充完全无文件系统活动。

选择/刷新/切项目/试用或过期异步返回清pending file/摘要/确认，不污染后来项目；busy锁覆盖parse/事务，取消不谎称已提交操作可撤回，成功后刷新失败明确已恢复待核对，不自动重放。所有外来标题/文件名/历史姓名用textContent，不预览或执行附件正文。原试用入口会自动创建模板，因此另有明确的“恢复到独立试用空资料区”动作，才跳过模板初始化并只读空目标；普通试用按钮语义不改，取消恢复不顺便创建模板。正式包仍须手动选择既有立项UUID，不从包中创建项目。

归属：codec agent只写`dist/material-preservation.js`及`tests/material-preservation.test.cjs`；root只改`dist/audit-checklist.js`本机窄DB方法和index脚本接线/文档；UI agent只改`dist/audit-program.js`、新UI测试和`tests/browser/material-preservation-smoke.cjs`；security独占`tests/material-preservation-security.test.cjs`、`tests/browser/material-preservation-security.test.cjs`、`tests/helpers/material-preservation-security-fixture.cjs`及仓库外审查。不得交叉编辑或提交。team server/main/preload/client、旧专业逻辑与其他dist文件不改；旧JSON及已有流程保留。

旧测试必要兼容：`workspace-navigation.test.cjs`仅沿既有环境变量选已安装Chrome，保留原断言；`accounting-label-rename.test.cjs`原固定哈希和标签断言不变，只严格断言本片新脚本exact tag一次、紧接audit-checklist依赖且无另一引用，再移除该唯一48字节标签继续全部原检查。独立逐byte证明移除后index与eb8ac66相同，20项缺失/重复/调序/属性/其他改动突变均拒绝。该旧源改前追加baseline；不直接更新固定哈希或泛化去除脚本。

## 结束证据

真实旧validate与ZIP正反/重复键/边界/CRC/SHA/缺件/extra/巨大输入验证；原gen与已移除附件完整导出、源变化拒绝；真实隔离IndexedDB恢复并逐record/history/Blob字节hash比对，v1无附件也不冒充正文，closed保留/重开仍原规则。已有记录/孤立行/foreign fileUUID/坏包零写入、两个窗口一次成功、事务中途故障整笔回滚、选错项目/取消/迟到无污染。旧相关测试、完整portable和必要真实浏览器UI下载/选择/预检/确认/刷新验证及截图，独立agent验收；headless/合成OS选择与人工选择分开写明。

本轮不需要重做无改动的M4C team native或升级共享team schema；结束验证其HEAD外的70依赖哈希未变、原一键team预览仍可达。旧端实际一键静态入口须验证新asset/源码hash与运行服务一致，不能只凭8773监听。完整Goal/M4继续active，分列main/一键/上线状态。
