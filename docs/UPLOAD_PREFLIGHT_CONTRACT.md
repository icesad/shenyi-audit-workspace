# M2 上传前置能力合同

日期2026-11-15。本轮只补“读取任务不等于可提交”的桌面与main检查，沿用现有最终POST权限/CAS。无角色或专业规则扩权、无schema迁移、无真实客户资料/外部供应商/上线。成员停用分工仍等待原问题答复，不重复问。

## API和RPC

新增 `getTaskSubmissionAccess({teamId,taskId})` → GET `/api/teams/:teamId/collection/tasks/:taskId/submission-access` → `{canSubmit:boolean,revision:非负safe整数}`。共49窄IPC，9form/15密码输入保持。需要当前有效session、team成员和任务可读；无读scope/不存在同404，失效401。只有本人active assignment、active project、task open/returned、可安全递增版本才canSubmit=true。已提交/closed/frozen/可读但未获指派均false，不返回人员或项目结构。

保持现有上传语义：不能因manager/partner/operator/read/manage grant自动提交；已有合法高职级assignment不静默移除（本轮不追改旧数据）。新指派仍按已确认仅intern/assistant。GET不改数据库，未知query400/method405，不接受伪造身份或role。

## 主进程上传顺序

1. 检查sender/精确输入/revision，捕获main会话generation。
2. 发起fresh提交能力查询，必须canSubmit=true且revision与renderer已展示版本一致；否则不打开文件选择器，不读文件、不发提交。revision冲突用409指导刷新，无权限使用固定安全提示。
3. 原生选择取消直接返回canceled；若选择文件，先核对同会话，再fresh检查同一提交能力和版本。变化则不读取文件。
4. 仅读取用户选择的常规文件，保持现有12MiB/字节/hash/文件名合同；读取后同会话＋第三次fresh能力版本检查，通过才发POST。读取期间撤权不会继续把字节交给upload transport。
5. 最终服务端POST继续fresh权限/同actor/CAS事务校验，不能把GET预检当永久授权；网络传输与权限变化之间不承诺跨机器绝对原子，只能以最终可信写入为准，不自动重试。

client只投影canSubmit/revision，GET不接renderer自由URL/用户标识。低角色无资源权限时不因能力返回泄露元数据。所有报错不转发SQL、目录、供应商正文。

## renderer

选任务时读取能力，在核验中/缺窄接口/失败/false/版本不符时禁用上传按钮，并显示清楚状态。仅cap与当前展示revision一致才可选择文件；不能从任务status或role猜。重新选择/刷新任务/团队/账号、上传成功/401等清旧能力。即使renderer绕过禁用，main仍执行上述三步fresh检查。

cap/task/actor代次隔离，迟到401或上传结果不能清退/污染新登录；同账号不同任务也不能沿用旧能力。UI上传catch/finally只影响原actor/view，不能恢复旧按钮或破坏新页面busy。原任务管理/历史/邀请/安全表单不重构，缺cap接口真实禁用；相关旧UI测试仅在确实需要上传时补真实允许cap fixture，保留原成功/取消/错误断言，不假设缺接口可写。

## 证据

独立服务端/主进程对抗需要覆盖不允许时dialog/read/upload全0，dialog期间撤权/冻项/版本变化前置拒绝，file-read期间撤权不上传，会话generation变化拒绝，取消无读，最终POST仍拒绝race。真实Electron至少覆盖只读manager按钮禁用且强行窄RPC也不弹选择器、assigned低角色能上传，选框期间版本变化拒绝；若拦截picker须标记，真实文件字节/历史保持。完整portable、既有task-management三窗口兼容、两旧demo在线备份及schema/行不变，独立验收后记录。Mac/真实供应商/设备/生产仍不称完成。
