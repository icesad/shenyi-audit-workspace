# 原件副本保存前置授权

日期：2026-11-15；M2本机候选。执行合同见[下载保存合同](DOWNLOAD_PREFLIGHT_CONTRACT.md)。

原件下载必须同时满足任务读取范围和本人独立附件授权。经理或合伙人的项目管理权不会自动赋予原件下载权。资料已经传到桌面主进程、但保存窗口还未确认时，也需要在实际保存前重新核验权限。

本轮独立复现了旧流程的缺口：在保存窗口打开期间撤销任务指派、附件授权、会话或禁用账号，下一次服务端请求已拒绝，旧流程仍可能把内存中的原件写成副本。修复后，主进程在用户选择保存位置后，对同一附件发送一次HEAD请求；当前授权仍成立且登录代次未改变时才写文件。取消选择、撤权、核验失败或切换登录均不写入，也不自动重试。

HEAD沿用原件GET的同一SQL授权范围，仅读取附件名，不把原件blob读入JS；所有成功和失败响应均无正文，其他采集接口未开放HEAD。GET原件字节、文件名、冻结可读和独立授权语义保持。没有新增schema，也没有增加renderer网络或路径访问能力：preload仍为49项窄操作，9个form、15个密码输入。

下载界面复用当前账号、团队、任务、视图及busy代次保护。旧下载的成功、错误、401或finally不能覆盖新账号的提示、误退登录或解锁尚在进行的新操作；正常保存、取消和错误提示保留。

这项复查减少撤权后的未完成保存，但网络授权与本地IO不是同一个原子事务；最后一次核验之后的瞬时撤权仍有边界，也不能收回此前已合法保存的副本。没有改变成员停用的管理分工：本轮用户已确认团队管理员处理本团队业务成员（含经理、合伙人），管理员本人由产品负责人处理；管理API/UI随后实现。

验证入口（Node24）：

```powershell
node --test tests/team-attachment-head.test.cjs tests/team-desktop-download-access.test.cjs tests/team-desktop-download-ui.test.cjs tests/team-download-preflight-security.test.cjs
node desktop/download-preflight-smoke.cjs
node desktop/upload-preflight-smoke.cjs
node scripts/test.mjs --unit --strict
```

证据保存在 `D:/codex-temp/shenyi-download-preflight-20261115/`。旧缺口的独立复现脚本和JSON保留，修后回归与原生验收分别记录；真实Electron测试使用隔离SQLite、随机loopback端口及合成文件，保存窗口为测试拦截，不等于真人操作OS选择器。实际结果、截图和演示库保持情况见[进度](../进度.md)。未推送、进入main或发布生产版本；Mac、真实供应商、首版设备绑定和商业化关卡仍需继续完成。

本轮结果：portable单元1332通过、0失败、0跳过（215.09秒），新增76包含在总数内；独立源码、安全及原生复核无P1/P2。新下载双窗口4场景/4图、旧上传及任务管理原生兼容、默认smoke全部通过。保存前后的两阶段及最终SQLite已分别只读核验；演示库启动时全部旧行保持，默认验收登录后仅review三张认证表正常变化，业务与schema保持。
