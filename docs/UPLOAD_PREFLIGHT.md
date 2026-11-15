# 采集资料上传前置授权

日期：2026-11-15；M2本机隔离候选。执行合同见 [UPLOAD_PREFLIGHT_CONTRACT.md](UPLOAD_PREFLIGHT_CONTRACT.md)。

任务可读不代表可以提交资料。经理或合伙人只有项目读取或管理权限、没有本人有效任务指派时，可以查看获准的任务及管理分工，上传按钮禁用；即使绕过按钮调用桌面接口，也不能打开文件选择框。技术管理员不会因此取得业务资料权限。

桌面新增 `getTaskSubmissionAccess({teamId,taskId})`，固定请求 `GET /api/teams/:teamId/collection/tasks/:taskId/submission-access`，只返回 `{canSubmit,revision}`。服务端先检查当前会话、团队状态及任务读取范围，只有本人有效指派、项目可写、任务处于 `open/returned` 且版本可递增时才返回 true。不可读或未知任务统一404，失效会话401。没有新增人员、项目结构、原件或他人提交信息；接口不写数据库。

renderer加载任务时默认禁用上传；只有能力查询成功、允许提交且版本与当前显示的本人历史一致时才能启用。缺接口、查询失败、迟到结果或版本不同步都保持禁用，要求刷新。账号、团队、任务和视图代次隔离迟到响应，旧请求的401或finally不能误退或解锁新身份的操作。管理分工后重新读取本人历史与提交能力。

主进程保留Bearer和本地路径，执行三次新检查：打开文件选择框前、选择完成且读取文件前、读取完成且发送资料前。每次核对同一登录代次和原显示版本。取消选择不读文件；不允许提交或版本变化不自动重试。选文件期间撤销指派、冻结或版本变化会阻止文件读取；读取期间变化会阻止上传请求。错误只返回固定提示，不返回本地路径、服务端原始错误或文件正文。

这三次检查减少不必要的本地文件读取和传输，不能让网络和文件IO成为同一个原子事务。最终 `POST submissions` 仍重新授权、确认同一账号并进行版本CAS，在事务内保存原件、hash、历史与审计记录。既有本人高职级指派仍遵守原提交语义；新任务指派目标只允许本团队实习生与助理。没有新增schema或放宽附件权限。

当前preload共49个窄操作，9个form、15个密码输入；没有通用网络、IPC或路径读取接口。Windows/Mac、真实供应商、设备绑定和生产发布继续独立验收；本轮不修改真实客户资料、不代发消息、不推送或上线。

验证入口：

```powershell
node --test tests/team-submission-access.test.cjs tests/team-desktop-submission-access.test.cjs tests/team-desktop-upload-access-ui.test.cjs tests/team-upload-preflight-security.test.cjs
node desktop/upload-preflight-smoke.cjs
node desktop/task-management-smoke.cjs
node scripts/test.mjs --unit --strict
```

使用Node24。原生专项只使用隔离SQLite、随机loopback端口和明确合成文件，main拦截picker选择这些fixture，不能冒称本轮人工操作OS文件选择框或真实客户业务验收。实际命令结果、数据保持和截图证据见根目录[进度.md](../进度.md)。

本轮验收：portable单元1256通过、0失败、0跳过（214.05秒），新增98项包含在总数内；独立复核无剩余P1/P2。双窗口原生专项、旧任务管理三窗口兼容及默认服务smoke均通过。原生专项report与4图在 `D:/codex-temp/shenyi-upload-preflight-20261115/real-electron-synthetic/`，仅read经理的阶段库和最终原件库已分别只读复核。默认smoke有8图；启动时两演示库全部旧行保持，随后验收登录仅使review三张认证表正常变化，全部业务表与schema保持。未推送、进入main或线上发布；本机一键入口可达，M2与完整Goal仍进行中。
