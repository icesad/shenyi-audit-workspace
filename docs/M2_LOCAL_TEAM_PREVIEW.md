# M2：本机团队采集桌面预览

日期：2026-11-15；工作项`TEAM-M2`。本文件记录实际本地实现及验收边界，不是正式产品上线说明。当前分支接续`16943ab`，未修改既有`dist/`应用、平台账号服务或客户浏览器库。

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

正式登录方式现已确定为手机号＋密码和微信扫码，见[正式身份方案](PHONE_WECHAT_AUTH_PLAN.md)；账号注册/验证、恢复流程和组织归属及供应商接入仍需实现。现在的定向邀请要求已有账号登录且身份与邀请匹配，不发送邮件或短信，不冒充已经验证真实手机号或微信身份。

## 关键服务端规则

- 登录限制每账号15分钟10次、全局每分钟60次，异步KDF并发最多2；这是本地防误用实验参数，不是用户已批准的生产锁定策略。错误密码/未知账号同错，不输出凭据。
- 会话有效期由服务端控制；退出、改密、禁用及过期后拒绝。异步校验完成前再次读取账号版本/状态，避免验证过程中被撤销后仍发会话。
- 指派和附件范围沿用M1；上传必须当前有效指派、项目可写、任务open/returned且revision一致。只读、已交或旧版本409，越权404。
- 单份文件上限12MiB；规范base64、合法文件名校验，字节/哈希、原件、个人下载grant、任务状态/版本和留痕同事务；失败不产生孤儿原件。
- 列提交记录仅返回当前用户自己提交的摘要；管理读取权限不自动取得他人原件。下载仍经任务范围和精确附件grant双重检查。
- 指派/退回需要manager/partner及该项目显式`collection.manage`；邀请需要独立`member.invite`，只可邀请intern/assistant，不能用邀请升为经理/合伙人，不能覆盖已有成员角色。
- HTTP只允许本机Host和指定Origin，拒绝跨站、不开放CORS、不提供项目目录或源码静态下载；未知模块和接口拒绝。生产必须另行配置HTTPS、身份恢复、设备和订阅约束，不能直接暴露本监听器。

## 当前验证层次与证据

1. 独立服务端测试：`tests/team-auth-workflow.test.cjs`23项、`tests/team-http.test.cjs`3项，真实SQLite与loopback HTTP。
2. 独立异步撤销：`tests/team-revocation-races.test.cjs`3项，验证读body或异步KDF期间撤销权限/账号仍阻止最终动作。
3. 桌面client/IPC/真实DOM：`tests/team-desktop-client.test.cjs`、`team-desktop-bridge.test.cjs`、`team-desktop-ui.test.cjs`，包含会话过期后的再次登录和正文不执行HTML。
4. `npm run test:unit`是可移植子集，不能代替原生桌面、Mac或客户业务测试。当前日志及精确数量见根目录`进度.md`，不得沿用旧数量冒充新执行。
5. 主进程客户端真实HTTP联调脚本：`node desktop/integration-smoke.cjs --local-demo`。它会修改明确的合成任务，不在生产运行；字节/hash/退出闭环不等于窗口交互通过。
6. 原生Electron验收必须另有真实运行版本、登录/任务/选择文件/保存/退出、截图和Windows记录。官方二进制未就绪或窗口未验时不能标M2桌面部分通过。

已修复的实际问题：服务端401触发退出页时旧busy状态可能使输入框永久禁用；现在退出页清空旧账号/任务DOM并解除busy，保留真实DOM回归。

## 尚未完成的能力

Windows安装/签名/升级、macOS原生、电脑绑定和离线规则、生产身份注册与恢复、生产库/对象存储、客户原件迁移、正式订阅/支付和国内上线仍在后续里程碑或外部关卡。测试账号、localhost服务或Electron窗口不能替代这些验收。
