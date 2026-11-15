# M2 原件副本保存前置授权合同

日期2026-11-15。接续a06293a。本轮补原件在main获取后、原生保存窗口打开期间撤权的空档，不改变本轮已获用户答复的成员停用分工，不改变审计规则、原件存储或既有合法导出文件。M2仍唯一进行中。

## 服务端与main

- 原附件GET路径增加HEAD，仅附件允许GET/HEAD；其他采集读取接口仍GET。HEAD与GET共用当前session/user/team/member/task/project/独立attachment grant范围；未知/越权均404、失效401、跨站403、无效query400。HEAD任何结果都没有响应正文，错误不泄露资料。HEAD成功使用与GET相同的安全/文件名headers，不取出blob字节到JS。GET原件字节、文件名及冻结可读语义保持。
- repository复用同一SQL授权谓词，HEAD只投影所需附件名/长度等最小metadata，不读完整blob到JS，不额外返回目录/人员/项目全貌。没有schema变更。
- main client增加内部`checkAttachmentAccess({teamId,taskId,attachmentId})`，固定当前附件路径HEAD，严格精确参数、main bearer、generation检查及固定错误提示；成功仅`{canDownload:true}`。不增加preload/RPC，仍49项。禁止renderer提供URL/路径/角色。
- download顺序：捕获guardSession；GET原件；同generation确认后才打开saveDialog；取消不写文件；选择路径后同generation＋fresh HEAD核权＋同generation确认，通过才调用fs.writeFile。HEAD失效/拒绝/网络失败时不写文件，不自动重试，不返还本地完整路径或正文。原件保持GET所得精确字节。
- 此检查减少撤权后的未完成保存；网络核权与本地IO并非原子事务，不保证阻止最后一次核权之后的瞬时撤权，也不能收回此前已合法取得的副本。

## renderer与验证

- downloadItem使用当前actor/team/task/view与busyEpoch隔离迟到结果和finally；旧下载错误、401、保存提示不能清退/污染新登录或解锁新请求。正常成功/取消/错误提示保留。表单、密码字段、上传和任务管理合同保持。
- 先用现有代码仓库外确定性repro记录保存窗口期间撤权仍写文件；修复后同场景必须零写入。独立SQLite/API/client/bridge验证session/user/team/member/task/附件grant撤销、generation变化、取消、HEAD失败/超时、安全错误和原字节；HEAD成功/失败均空body，非附件不开放HEAD，不能绕过GET授权，查询只读。
- 真实Electron＋隔离HTTP/SQLite＋合成文件验证正常保存hash一致，saveDialog挂起时撤会话/附件授权拒绝且零写入；picker为明确合成拦截，不冒称真人OS操作。旧upload/task管理及默认原生兼容、完整portable回归、两演示库在线备份及startup数据保持，独立agent验收后本地提交。
- 普通源文件改写前备份在`D:/codex-temp/shenyi-download-preflight-20261115/baseline/`。不push/main/deploy、不使用真实资料或供应商、不改原dist/platform/hosting。
