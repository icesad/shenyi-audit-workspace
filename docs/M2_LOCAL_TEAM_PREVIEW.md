# M2：本机团队采集桌面预览

日期：2026-11-15；工作项`TEAM-M2`。本文件记录实际本地实现及验收边界，不是正式产品上线说明。当前`codex/personal-password-change`从会话提交`911b53a`接续，邀请激活为`d7ecc01`、微信桌面为`04a014b`、身份为`37476da`、桌面采集为`31b9369`，未修改既有`dist/`应用、平台账号服务或客户浏览器库。

## 可以验证什么

独立用户名/密码登录 → 读取当前团队和被指派采集任务 → 选择合成文件 → 带任务版本提交 → 服务端保留原件字节/哈希与提交记录 → 逐份下载 → 退出撤销会话。明确授权的项目管理接口支持重新指派与退回，独立团队管理能力支持定向邀请已有测试账号；这些不是审计核对或报告签发。

桌面端只通过窄IPC访问本机服务；token保留主进程内存，不传给renderer、不写localStorage；renderer无直接网络、Node和任意文件系统能力。当前为开发运行态，尚非安装包、签名版或带设备绑定的首版。

## 环境及启动

使用Node 24.15以上24.x。Windows优先D盘；macOS安装/运行与系统凭据/签名尚需实际设备验证，不因同一源码自动记通过。

```sh
npm ci --ignore-scripts
npm --prefix desktop ci --ignore-scripts
node desktop/node_modules/electron/install.js
npm run dev:team
```

前两条按已提交锁文件安装；第三条获取锁定Electron的官方运行时，首次联网可能较大。Windows可设置`ELECTRON_CACHE`到D盘缓存目录，不能通过关闭TLS、改未知镜像或省略校验解决下载问题。若官方安装器不可达，保留日志，验证同一官方release文件与官方校验值后再处理；不要将二进制或缓存提交Git。

`npm run dev:team`启动隔离演示数据库、本机`127.0.0.1:8774`和桌面窗口；关闭窗口后关闭其自己创建的服务。端口占用时报错，不自动换口、不结束已有进程。原版静态预览仍使用`8773`，不与团队模式混用。

Windows当前机器也可双击根目录`Start-Team-Preview.cmd`：优先使用已有Codex配套Node24，找不到才使用系统node并由启动器校验版本；不会修改系统Node配置。已有预览在运行时先关闭该预览窗口，避免重复占用8774。该cmd是开发启动入口，不是正式安装包。

默认合成资料目录：Windows为`D:/codex-temp/shenyi-team-preview`，其他系统为用户目录下`.local/share/shenyi-team-preview`；桌面userData另置子目录。不会读取或迁移旧浏览器IndexedDB。不要往这些目录或本机预览上传真实客户账表。

仅单独联调服务时：

```sh
node server/team/dev-server.mjs --demo --data-dir D:/codex-temp/shenyi-m2-20261115/demo-data
```

该入口要求明确`--demo`，只监听本机。与一键启动器共用8774，不能同时启动第二份；停止前核对是否本任务创建的进程，不能随意结束未知服务。测试使用随机端口独立内存库，不改演示或用户资料。

## 纯合成演示账号

`intern-a`、`assistant-a`、`manager-a`、`partner-a`属于合成`team-a`；`intern-b`等属于`team-b`，另有用于定向邀请的`invitee-a`。演示密码均为`ShenyiDemo!2026`。这是公开写明的本机测试凭据，不得搬进生产环境或用作用户真实密码。

底层各账号仍分别生成随机salt、异步scrypt密码摘要，数据库不存明文密码；会话为随机32字节opaque token，库中只留SHA-256摘要。密码参数选用当前OWASP列出的scrypt配置，正式身份组件仍须结合上线栈评估Argon2id及其他运营条件。[OWASP密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Node异步scrypt](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

正式登录方式现已确定为手机号＋密码和微信扫码，见[正式身份方案](PHONE_WECHAT_AUTH_PLAN.md)。本地已实现手机号首次验证绑定/密码登录、默认关闭的额外证明恢复边界，以及微信短期事务/回调/强关联/单次兑换的服务端适配契约；测试供应商均为明确合成。桌面可切换手机号模式、展开当前账号首绑面板；默认SMS未配，无法发送或绑定。微信桌面已有受限浏览器入口和主进程事务取回/首次关联界面，必须服务端与桌面可信配置同时就绪才开放；默认仍禁用，未接真实微信。另有手机号定向邀请/本人验证激活候选，支持新员工自行设密或无团队既有账号当前密码复用；旧username邀请仍要求已有账号登录。生产启用、恢复政策、正式组织建立及真实供应商未完成，不发送真实邮件或短信，不冒充已验证真实身份。

## 关键服务端规则

- 登录限制每账号15分钟10次、全局每分钟60次，异步KDF并发最多2；这是本地防误用实验参数，不是用户已批准的生产锁定策略。错误密码/未知账号同错，不输出凭据。
- 会话有效期由服务端控制；退出、改密、禁用及过期后拒绝。异步校验完成前再次读取账号版本/状态，避免验证过程中被撤销后仍发会话。
- 指派和附件范围沿用M1；上传必须当前有效指派、项目可写、任务open/returned且revision一致。只读、已交或旧版本409，越权404。
- 单份文件上限12MiB；规范base64、合法文件名校验，字节/哈希、原件、个人下载grant、任务状态/版本和留痕同事务；失败不产生孤儿原件。
- 列提交记录仅返回当前用户自己提交的摘要；管理读取权限不自动取得他人原件。下载仍经任务范围和精确附件grant双重检查。
- 指派/退回需要manager/partner及该项目显式`collection.manage`；业务邀请需要独立`member.invite`，技术管理员另走独立operator来源；均只可邀请intern/assistant，不能用邀请升为经理/合伙人或覆盖已有成员角色。
- HTTP只允许本机Host和指定Origin，拒绝跨站、不开放CORS、不提供项目目录或源码静态下载；未知模块和接口拒绝。生产必须另行配置HTTPS、身份恢复、设备和订阅约束，不能直接暴露本监听器。

## 当前验证层次与证据

1. 独立服务端测试：`tests/team-auth-workflow.test.cjs`23项、`tests/team-http.test.cjs`3项，真实SQLite与loopback HTTP。
2. 独立异步撤销：`tests/team-revocation-races.test.cjs`3项，验证读body或异步KDF期间撤销权限/账号仍阻止最终动作。
3. 桌面client/IPC/真实DOM：`tests/team-desktop-client.test.cjs`、`team-desktop-bridge.test.cjs`、`team-desktop-ui.test.cjs`，包含会话过期后的再次登录和正文不执行HTML。
4. `npm run test:unit`是可移植子集，不能代替原生桌面、Mac或客户业务测试。当前日志及精确数量见根目录`进度.md`，不得沿用旧数量冒充新执行。
5. 主进程客户端真实HTTP联调脚本：`node desktop/integration-smoke.cjs --local-demo`。它会修改明确的合成任务，不在生产运行；字节/hash/退出闭环不等于窗口交互通过。
6. 原生Electron验收必须另有真实运行版本、登录/任务/选择文件/保存/退出、截图和Windows记录。官方二进制未就绪或窗口未验时不能标M2桌面部分通过。
7. 身份专项：`node --test tests/team-phone-identity.test.cjs tests/team-wechat-identity.test.cjs tests/team-identity-http.test.cjs tests/team-identity-races.test.cjs tests/team-desktop-identity.test.cjs`。真实Electron的`desktop/smoke.cjs`还检查手机号模式、未配短信/微信禁用和密码清空，报告分开记录未验的真实SMS/微信和Mac。
8. 桌面微信专项：`node --test tests/team-desktop-wechat.test.cjs tests/team-desktop-wechat-ui.test.cjs`；`node desktop/wechat-smoke.cjs`另验证真实Electron与随机端口真实HTTP/SQLite合成往返。后者拦截OS opener且直接派发合成HTTPS回调，不能称真实系统浏览器/微信验收。后续24项preload与4处密码清空见第9项。
9. [员工邀请激活](EMPLOYEE_INVITATION_ACTIVATION.md)：新增8个窄操作，总计24项preload、4处密码清空。`node desktop/activation-smoke.cjs`以真实Electron/HTTP/SQLite和合成SMS走创建/撤销/本人确认/手机号登录，激活本身不授予任务、项目、附件或管理权限。新旧邀请均要求当前经理/合伙人＋独立邀请授权；误授低权限grant和降职后旧邀请均拒绝。
10. [个人登录会话](ACCOUNT_SESSION_MANAGEMENT.md)：再增4个窄操作，当前共28项preload、5处密码清空。`node desktop/sessions-smoke.cjs`验证本人多登录、稳定非凭据ID、未知旧时间、当前密码重验和退出指定/其他/当前/全部；另一端撤销后桌面下次请求清退，他人不受影响。不是电脑绑定或生产验收。
11. [本人改密](PERSONAL_PASSWORD_CHANGE.md)：该阶段29项preload、6个form、8密码输入。`node desktop/password-smoke.cjs`在独立内存库验证旧密码错误可重试、成功全部旧会话退出、新手机号密码同身份/范围重新登录，其他用户不受影响；默认共享预览只填写清空，不提交改密，不改变演示密码。
12. [人工团队开通](MANUAL_TEAM_ONBOARDING.md)：当前37项preload、8个form、11密码输入。独立平台审核员录入/密码审核，首技术管理员本人验证后仅有员工邀请权，不建立审计membership或资料授权。`node desktop/provisioning-smoke.cjs`验证真实Electron/HTTP/SQLite与合成SMS闭环；`Start-Team-Review-Preview.cmd`单独启用本机审核演示，普通9用户demo不增权。真实SMS缺席时激活如实禁用。
13. [找回密码](PASSWORD_RECOVERY.md)：当前39项preload、9个form、14密码输入。登录页手机号验证码＋独立恢复授权和新密码确认，成功撤本人旧登录且不自动登录；新快照封住同值重绑旧挑战。`node desktop/recovery-smoke.cjs`真实Electron/HTTP/SQLite验证，SMS/authorizer明确合成。用户已选团队管理员审核员工、产品负责人审核管理员本人，审批签发链继续实现，默认恢复保持禁用。
14. [内建恢复审批](RECOVERY_APPROVAL.md)：当前44项preload、9form/15密码输入。短信验证提交申请，own operator审核员工、独立owner审核管理员，密码/CAS批准拒绝撤销，内建票消费＋重设同事务。`node desktop/recovery-review-smoke.cjs`双窗口真实Electron+HTTP/SQL及明确合成SMS验证，自审/撤销票拒绝，业务范围保持；真实服务缺SMS仍available=false。旧external恢复路径单独作兼容，不等同内建审批。
15. [任务指派与退回](TASK_MANAGEMENT.md)：当前48项preload、9form/15密码输入。可读任务＋manager/partner＋该项目manage交集才可操作，候选仅本团队intern/assistant（用户已确认），改派/退回必须当前版本，旧无版本调用400。三窗口真实Electron/HTTP/SQL验证改派撤旧范围、新人不继承旧原件、退回重交及stale409；文件picker仅拦截选合成fixture。默认预览不写任务管理，不改共享历史；本轮无schema变化。

已修复的实际问题：服务端401触发退出页时旧busy状态可能使输入框永久禁用；现在退出页清空旧账号/任务DOM并解除busy，保留真实DOM回归。

## 尚未完成的能力

Windows安装/签名/升级、macOS原生、电脑绑定和离线规则、生产身份注册与恢复、生产库/对象存储、客户原件迁移、正式订阅/支付和国内上线仍在后续里程碑或外部关卡。测试账号、localhost服务或Electron窗口不能替代这些验收。
