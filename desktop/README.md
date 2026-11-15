# 审易团队采集桌面预览（M2）

独立的Electron候选壳，沿用现有审易品牌。只连接本机`http://127.0.0.1:8774`合成服务；不接原浏览器业务库，不用于正式客户资料。生产HTTPS、电脑绑定、签名/安装/更新、Mac实机及商业化能力尚未验收。

## 本机运行

使用Node24.15以上24.x。根目录的团队服务启动入口和当前进度由主工程维护；先启动8774的明确`--demo`合成服务，再在本目录运行：

```sh
npm ci --ignore-scripts
npm run setup
npm start
```

Electron依赖固定为`45.3.2`并有独立锁文件。2026-11-15官方发布页显示45.3.3，但实际npm官方registry latest为45.3.2；采用实际可安装版本，不声称已安装45.3.3。首次安装需要下载官方Electron二进制。`setup`以系统curl下载同一GitHub官方release，并按锁定npm包内checksums核对SHA-256后解压，不使用第三方镜像；Windows缓存默认D盘，可设置`ELECTRON_CACHE`。标准Electron官方postinstall也可用；本机曾遇Node下载器极慢，因此保留此可复现替代入口，不关闭校验。npm缓存也建议设D盘。

演示账号`intern-a`或`assistant-a`，密码`ShenyiDemo!2026`；只在明确启用的纯合成本机服务存在。界面不会自动登录，也没有生产注册/找回入口。先登录→选择任务→核对要求→选择合成文件提交→查看我的提交记录→下载原件副本→退出。上传成功后任务为已提交，需受控退回后才能再次提交。

员工定向邀请和本人激活候选已实现，见[流程与边界](../docs/EMPLOYEE_INVITATION_ACTIVATION.md)。经理/合伙人还需独立邀请授权，低权限误授grant也不能管理邀请；受邀人验证码和密码确认后加入低权限角色，成功需另行手机号登录。默认SMS未配不能完成激活，不开放公共注册或自动授予任务/席位。

“我的登录会话”已支持查看本人有效登录、验证当前密码后退出指定/其他/全部登录，见[个人会话](../docs/ACCOUNT_SESSION_MANAGEMENT.md)。旧时间未记录时如实显示；会话不是已绑定电脑。错误密码可重试，已失效的会话在下次请求被拒绝并清退。

“修改账号密码”支持当前密码、新密码及确认，见[本人改密](../docs/PERSONAL_PASSWORD_CHANGE.md)。旧密码错误403可重试；成功后本账号全部旧登录退出，使用新密码重登。新密码不trim/normalize，短信未开通不阻断此项；忘记密码恢复仍独立未开放。

Windows预览用户数据默认放`D:/codex-temp/shenyi-desktop-preview`，可用`SHENYI_DESKTOP_DATA_DIR`指定独立目录；Mac默认系统应用数据目录。Chromium使用隔离的非持久分区，账号令牌仅在主进程内存，关闭窗口清除。当前为开发窗口，不是已签名安装包。

## 手机号与微信身份预览

登录默认仍为“合成演示账号”。客户端从固定本机服务的`GET /api/auth/methods`读取真实能力后，才开放“手机号＋密码”模式；这会调用`/api/auth/phone/login`，沿用当前账号、团队和权限，不创建另一套人员身份。正式员工方向为已验证手机号加密码，本机合成演示账号不等于正式员工已完成验证。

登录后可展开“账号手机号”，为当前账号首次绑定本人手机号。仅在服务端短信验证已配置时允许请求验证码；绑定还须填写本次验证码和当前账号密码。修改手机号会作废界面中原有验证上下文，绑定完成、切换登录方式、退出或登录失效均清除验证码与当前密码。界面只显示服务端返回的脱敏结果，不持久化手机号、验证码或密码；当前不提供换绑、找回或自助注册。

短信和微信默认未配置，界面显示未开通，不模拟发送、不生成假二维码。微信需服务端能力与桌面可信配置同时就绪才启用：主进程读取`SHENYI_WECHAT_APP_ID`、`SHENYI_WECHAT_REDIRECT_URI`（HTTPS且准确`/api/auth/wechat/callback`）；这些不是AppSecret，也不能由renderer参数传入。只有符合该配置、固定微信域名和路径、准确单值参数且不超过2081字符的授权URL才交给系统浏览器。当前启动器未注入真实供应商，因此默认不会发起微信授权。

微信事务ID、轮询秘密、S256证明及token只保留主进程内存。界面可以等待、取消、处理过期和失败；已关联身份自动取回同一员工账号。首次关联必须明确确认本人既有已验证手机号和密码，不自动建员工或入团队。临时手机号会话不采纳为当前账号，清理后再次校验事务才确认最终登录；取消/账号变化的迟到会话会尽力撤销。网络断开时撤销只能尽力完成，不能声称服务端必然收到；本地秘密立即丢弃，服务端到期和每请求状态校验仍生效。

## 权限与桌面安全边界

- renderer只加载`shenyi://app/index.html`，资源映射限固定HTML/CSS/JS/原标识；严格CSP，不开放网络、iframe、动态外链和通用文件协议。
- `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`，不关闭webSecurity；权限请求、新窗口、外部导航、webview和renderer下载拒绝。
- preload共暴露37个窄操作：8个账号/采集、4个手机号/能力、4个微信事务、8个邀请/激活、4个个人会话、1个本人改密及8个人工开通/首管理员操作。每个IPC均检查当前窗口、主frame与固定页面来源；没有通用fetch/IPC、路径读写、URL打开或命令执行。renderer无法指定外链。
- main固定API地址、禁止重定向、超时/响应体限额。token不回renderer、不写localStorage；响应只保留账号/任务/提交的明确字段。迟到的旧账号响应拒绝。
- 上传文件只能来自用户原生对话框选择，读取前检查常规文件及12MiB上限，按原始字节提交；renderer不能传本机文件路径。下载只在授权后通过原生保存对话框指定路径，不向renderer下发原件字节或路径。
- 对话框期间账号变化会取消旧账号操作。退出/401清空账号、团队、任务与输入状态，登录表单解除busy。已合法保存的文件不能承诺远程追回。

## 可执行验证

```sh
node --test ../tests/team-desktop-client.test.cjs ../tests/team-desktop-bridge.test.cjs ../tests/team-desktop-ui.test.cjs ../tests/team-desktop-identity.test.cjs
node integration-smoke.cjs --local-demo
node smoke.cjs
node wechat-smoke.cjs
node activation-smoke.cjs
node sessions-smoke.cjs
node password-smoke.cjs
node provisioning-smoke.cjs
```

第一项需要根项目锁文件的jsdom；覆盖HTTP客户端和IPC/文件边界、真实DOM的撤销后再登录及XSS文本呈现，并检查身份能力、首绑状态清理、37项白名单及未配置入口。微信专项另见`tests/team-desktop-wechat.test.cjs`和`team-desktop-wechat-ui.test.cjs`。第二项只对本机合成服务，用`assistant-b`执行一次真实上传/下载/哈希/退出，会改变该合成任务状态，应使用新演示数据目录。第三项需要根项目Playwright和已安装Electron，运行真实Electron renderer的登录/任务/退出和安全偏好检查；截图/报告写到`D:/codex-temp/shenyi-desktop-runtime`或`SHENYI_DESKTOP_EVIDENCE_DIR`。

第四项以Node24运行真实Electron＋隔离内存SQLite/随机端口HTTP，供应商明确合成；仅测试bootstrap重写client transport映射和浏览器opener，生产main/preload/renderer及服务处理器沿用。记录opener调用收据、直接派发合成HTTPS回调，再走真实HTTP轮询/关联/兑换；不访问微信、不展示假二维码、不修改共享demo。默认结果在`D:/codex-temp/shenyi-wechat-desktop-20261115/real-electron-synthetic/`。首次关联、再次登录、取消回调拒绝和过期通过也不等于OS浏览器、手机或微信平台验收。

第五项验证邀请/撤销、本人激活后无自动会话和资料权限、手机号登录及明确fixture指派后的单任务范围；SMS为合成捕获，真实Electron＋loopback HTTP/SQLite证据见邀请文档。不发送真实短信，不把fixture指派冒充管理员UI。

第六项验证本人多会话的密码重验、退出范围、另一端撤销后本端下次请求清退及他人会话保留；独立内存SQLite、随机端口HTTP与合成账号，不修改共享demo。默认目录`D:/codex-temp/shenyi-sessions-20261115/real-electron/`，不是设备/生产验收。

第七项在独立内存库中改合成账号密码，验证确认不一致不提交、错密保持、成功全部旧登录撤销、旧密码拒绝与新手机号密码同身份/范围重登；默认`D:/codex-temp/shenyi-password-20261115/real-electron/`。共享默认smoke仅填写清空，不提交演示账号改密。

第八项按[人工开通流程](../docs/MANUAL_TEAM_ONBOARDING.md)验证录入/密码批准/首管理员激活/技术管理员邀请员工。随机端口真实HTTP、内存SQLite及明确合成SMS，无真实供应商。当前8个form、11密码输入。Windows `Start-Team-Review-Preview.cmd`显式开启独立合成审核账号 `reviewer-demo / ShenyiDemo!2026`，单独库及profile在 `D:/codex-temp/shenyi-team-review-preview/`；普通入口9用户/8业务成员不增权。两入口固定8774不可同时启动，缺SMS时不提供假成功。新管理员没有审计职级，详情及精确证据见流程文档。

原生对话框、真实短信/微信、完整安装升级、Mac、设备绑定和生产服务仍需各自验收；单元/DOM通过不能替代这些检查。

官方来源：[Electron安全](https://www.electronjs.org/docs/latest/tutorial/security)、[protocol](https://www.electronjs.org/docs/latest/api/protocol)、[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[发布记录](https://releases.electronjs.org/release?channel=stable)，2026-11-15核验。
