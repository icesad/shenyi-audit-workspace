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

Windows预览用户数据默认放`D:/codex-temp/shenyi-desktop-preview`，可用`SHENYI_DESKTOP_DATA_DIR`指定独立目录；Mac默认系统应用数据目录。Chromium使用隔离的非持久分区，账号令牌仅在主进程内存，关闭窗口清除。当前为开发窗口，不是已签名安装包。

## 手机号与微信身份预览

登录默认仍为“合成演示账号”。客户端从固定本机服务的`GET /api/auth/methods`读取真实能力后，才开放“手机号＋密码”模式；这会调用`/api/auth/phone/login`，沿用当前账号、团队和权限，不创建另一套人员身份。正式员工方向为已验证手机号加密码，本机合成演示账号不等于正式员工已完成验证。

登录后可展开“账号手机号”，为当前账号首次绑定本人手机号。仅在服务端短信验证已配置时允许请求验证码；绑定还须填写本次验证码和当前账号密码。修改手机号会作废界面中原有验证上下文，绑定完成、切换登录方式、退出或登录失效均清除验证码与当前密码。界面只显示服务端返回的脱敏结果，不持久化手机号、验证码或密码；当前不提供换绑、找回或自助注册。

短信和微信默认未配置，界面显示未开通，不能模拟发送、生成假二维码或报告假成功。微信即使在服务端配置完成，当前桌面入口也会保持禁用并显示“桌面待接入”；外部浏览器授权、扫码事务取回及正式平台验收仍需后续实现。当前版本不会打开外部授权网站。

## 权限与桌面安全边界

- renderer只加载`shenyi://app/index.html`，资源映射限固定HTML/CSS/JS/原标识；严格CSP，不开放网络、iframe、动态外链和通用文件协议。
- `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`，不关闭webSecurity；权限请求、新窗口、外部导航、webview和renderer下载拒绝。
- preload共暴露12个窄操作：原有8个账号/采集操作，以及身份能力读取、手机号密码登录、请求首绑验证码、确认首绑4个操作。每个IPC均检查当前窗口、主frame与固定页面来源；没有通用fetch/IPC、路径读写、外部浏览器或命令执行。
- main固定API地址、禁止重定向、超时/响应体限额。token不回renderer、不写localStorage；响应只保留账号/任务/提交的明确字段。迟到的旧账号响应拒绝。
- 上传文件只能来自用户原生对话框选择，读取前检查常规文件及12MiB上限，按原始字节提交；renderer不能传本机文件路径。下载只在授权后通过原生保存对话框指定路径，不向renderer下发原件字节或路径。
- 对话框期间账号变化会取消旧账号操作。退出/401清空账号、团队、任务与输入状态，登录表单解除busy。已合法保存的文件不能承诺远程追回。

## 可执行验证

```sh
node --test ../tests/team-desktop-client.test.cjs ../tests/team-desktop-bridge.test.cjs ../tests/team-desktop-ui.test.cjs ../tests/team-desktop-identity.test.cjs
node integration-smoke.cjs --local-demo
node smoke.cjs
```

第一项需要根项目锁文件的jsdom；覆盖HTTP客户端和IPC/文件边界、真实DOM的撤销后再登录及XSS文本呈现，并检查身份能力、首绑状态清理、12项白名单及未配置入口。第二项只对本机合成服务，用`assistant-b`执行一次真实上传/下载/哈希/退出，会改变该合成任务状态，应使用新演示数据目录。第三项需要根项目Playwright和已安装Electron，运行真实Electron renderer的登录/任务/退出和安全偏好检查；截图/报告写到`D:/codex-temp/shenyi-desktop-runtime`或`SHENYI_DESKTOP_EVIDENCE_DIR`。

原生对话框、真实短信/微信、完整安装升级、Mac、设备绑定和生产服务仍需各自验收；单元/DOM通过不能替代这些检查。

官方来源：[Electron安全](https://www.electronjs.org/docs/latest/tutorial/security)、[protocol](https://www.electronjs.org/docs/latest/api/protocol)、[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[发布记录](https://releases.electronjs.org/release?channel=stable)，2026-11-15核验。
