# M4E：单任务所选原件导出执行合同

2026-11-16，从 M4D `74e7b31520879909a7e8e044eb65ca07151ee8f6`、干净工作区接续，分支 `codex/task-originals-export`，关联 `TEAM-M4`。前 Goal 回合为 progress：旧端资料保全/本机恢复已验并本地提交；整个 M4/商业化 Goal 未完成。适用旧源改前备份到 `D:/codex-temp/shenyi-task-originals-export-20261116/baseline/`，未列旧文件须先追加。

## 交付与边界

正常团队桌面在“我的提交记录”和项目“采集资料核对”的当前任务列表中，明确选择已经显示的提交，导出所选原件及最小提交清单 ZIP。两入口保持独立授权：本人必须当前 task scope、本人提交及每原件有效个人 grant；项目核对必须当前合法 senior、当前项目 read＋review，manage/owner/技术管理员不代替。任一所选文件无权、缺失、变化或损坏，整个导出失败，不静默漏件。

这是当前单任务、显式选择的资料副本，不是全部任务历史/完整项目备份、资料迁入、专业核对通过或审计签发。不自动遍历未加载分页、不猜最新原件、不导出完整活动表或其他项目结构。历史可见不等于仍有原件下载权。冻结项目/关门任务保持原有可读可下载语义，archived 拒绝；不借 canSubmit 限制下载。既有正常项目创建和旧项目团队/首 owner 审核仍待答，本片不实现依赖动作，不改旧立项/编号/专业逻辑。

不改 `dist/`、platform/hosting、专业模板、设备/身份策略或 schema；团队库维持57表/127定义。只用隔离合成资料实现与验证，真实客户、生产、购买/申请/短信/微信、远程push/PR/main/上线不在本片授权内。现有共享库只在真实一键入口必要重启前先做真正只读保全，随后核原表/定义/行不变，不给共享身份自动加权或绑定。

## 固定接口与格式

共享 Node CJS `shared/task-originals-export.cjs` 由 root 编写，接口：

- `selectionIds(value)`：验证1–20个独立有效不重复submission ID，返回排序新数组；不改入参。
- `makePlan({scope,task,files})` → `{manifest,sha256}`；`validatePlan(plan)` → 经过严格字段/类型/范围/哈希复核的自有副本。
- `create(plan, originals)` → `{bytes,sha256,filename,fileCount,planSha256}`。`originals` 精确为所选 `{id,bytes}` 数组，逐件比实际大小/SHA，整包前核上限，不解释或执行原件内容。
- 常量 `MAX_SELECTION=20`、`MAX_FILE_BYTES=12*1024*1024`、`MAX_TOTAL_BYTES=64*1024*1024`、`MAX_MANIFEST_BYTES=128*1024`、`MAX_PACKAGE_BYTES=66*1024*1024`。超限明确拒绝、不截断。

`manifest` 精确字段 `format,schemaVersion,scope,task,files,policy`；format=`shenyi-task-originals-export`、schemaVersion=1。scope 本人精确 `{kind:'own',teamId,taskId,userId}`；核对精确 `{kind:'project-review',teamId,projectId,projectRevision,taskId}`。task 精确 `{id,title,instructions,status,revision}`，只含原已暴露任务上下文。files 按 id 排序，精确 `{id,attachmentId,filename,sha256,byteLength,createdAt}`；核对项另有原样 `{submittedBy:{id,displayName}}`。个人包不带他人身份或 projectId。UUID/opaque ID、原始文件名、时间、SHA和bytes不重编号或净化。

policy 精确 `{selectionOnly:true,completeTaskHistory:false,restorableBackup:false,professionalApprovalClaimed:false}`。manifest 规范UTF8 JSON（递归按key排序），plan sha256为该规范manifest字节SHA；不含实时导出时间/随机包ID等会使最终复核漂移的字段。标准 ZIP32 STORE，成员仅 `manifest.json` 和 `originals/<四位排序序号>-<submissionID>.bin`，序号从0001开始、对应manifest.files顺序；原ID原样保留，不改变提交身份。序号前缀使合法opaque ID的大小写差异及CON等设备名不造成Windows解包覆盖/歧义，内部路径不使用原文件名。固定合法DOS日期以稳定打包。CRC32、大小、SHA都实际计算；文件原始bytes逐字保持，不改变Office/公式/编码，也不把当前无类型限制的团队上传改套旧浏览器准入策略。

新增只读 GET：

- `/api/teams/:teamId/collection/tasks/:taskId/export-plan?revision=...&ids=...`
- `/api/teams/:teamId/projects/:projectId/tasks/:taskId/export-plan?revision=...&projectRevision=...&ids=...`

ids 是按ID排序的逗号分隔单值query；仅这些参数，拒重复/未知/空/重复ID/非安全revision，最大20且完整签名路径不超过既有4096限制。两入口自身要求strict deviceContext及当前持钥lease，诊断全局关闭设备门也不能绕过。SQL在取任何任务/原件元数据前做当前 scope，个人项还核submitted_by及attachment grant；不能先全量读后过滤。统一未知/无权404；已获权任务版本变更409。用一致只读业务快照取所选元数据，核任务版本，核对另核projectRevision；读完再次检查同一当前actor/lease与范围。只返回 `{manifest,sha256}`，不读BLOB，不新增业务事件、schema或“已成功落盘”假事实；正常设备nonce/限流状态照旧。

正常preload仅增加两个窄操作，共81项，原14form/20密码不增：

- `exportTaskOriginals({teamId,taskId,revision,submissionIds})`
- `exportProjectTaskOriginals({teamId,projectId,taskId,revision,projectRevision,submissionIds})`

client新增内部 `getTaskExportPlan` / `getProjectTaskExportPlan`，沿既有签名请求、严格响应及当前session/device guard；renderer不能传 URL、本地路径、原件字节或任意manifest。未知结果不自动重发。

main 导出全程捕获同一guard：初始当前计划 → 逐件既有授权GET → 实际长度/SHA校验与打包 → OS保存框 → 相同选择的fresh计划 → SHA/版本完全一致且当前guard → 本地发布。中途任一失败整包拒绝，取消不写目标。原件及包的bytes/路径/token/lease/密钥不进入renderer；仅返回 `{canceled:true}` 或 `{saved:true,filename,byteLength,fileCount}`（basename）。对新导出采用同目录自有随机临时文件、完整写成后原子发布，失败仅清本次自有临时文件、不截断既有目标；不重构旧两条单件下载。权限与本地发布不是分布式原子事务，不能承诺撤销已经合法保存的副本。

## 界面与并发

仅当前任务已加载提交可勾选，最多20份/64MiB，按钮展示当前所选份数和大小。选定列表不是全部历史或专业审签。关闭/换任务/换项目/账号变化/暂停清选择；沿现有actor、view、device、operation代次及跨关闭锁，迟到401先核上下文，不能污染新账号或解锁后来的操作。OS对话框取消不自动重试，已知成功而刷新失败如实提示已保存待核对。原列表、逐件下载、业务规则和已批准视觉保留。

## 归属与验收

- root：共享打包器及其纯核心测试、合同/文档/检查点/分支保全；其他旧验收适配只作独立审查后的确切新增RPC及计数，不删旧断言。
- server agent：`server/team/task-originals-export-api.mjs`、`application-api.mjs`接线、`tests/team-task-originals-export.test.cjs`；不交叉编辑共享/desktop。
- UI agent：正常 `team-client/bridge/preload/team-ui`、新 `desktop/task-originals-export.cjs` 导出编排/原子发布、专题client/bridge/DOM测试及 `desktop/task-originals-export-smoke.cjs`；必要旧桌面精确白名单适配改前已备份，额外旧源先通知root追加。
- 独立agent只负责另一个真实SQL权限/撤销测试文件及外部终审，不改产品。实现/测试人不能代替root及独立验收；不提交或push。

结束必须有纯ZIP/格式/容量/原件完整性、真实SQL跨账号/团队/任务/项目/个人grant/read＋review/技术身份及strict设备正反、scope先于查询/无BLOB计划、版本/权限变动整包拒绝，真实main GET/打包/保存框挂起撤权或换账号/暂停零发布、取消、同名原件、文件坏hash、落盘失败不损既有目标、临时文件清理。实际strict Electron/OS vault/HTTP/SQLite/正常UI，独立标准ZIP解包核原件逐byte及截图，明确合成文件选择不等于真人OS/Mac。直接相关回归通过后跑原portable完整命令，记录真实失败/跳过，源先冻结，失败即时观测，原验收不弱化；相关旧原生兼容按实际影响执行。最后保留main/一键/上线与Goal未完成状态。
