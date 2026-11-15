# 审易团队采集桌面预览（M2/M3/M4A/M4B）

独立的Electron候选壳，沿用现有审易品牌。只连接本机`http://127.0.0.1:8774`合成服务；不接原浏览器业务库，不用于正式客户资料。[正常设备会话](../docs/DESKTOP_DEVICE_SESSION.md)与[员工/管理员换机审批](../docs/DEVICE_REPLACEMENT.md)已通过Windows本地验收；生产HTTPS、签名/安装/更新、Mac实机、最高审核账号自身恢复及商业化能力仍未完成。

## 本机运行

[普通员工业务职级管理](../docs/BUSINESS_ROLE_MANAGEMENT.md)已接入Windows本地候选：团队管理员选择本团队普通员工、新职级、确认收回旧任务/项目权限并验证当前密码；员工须重新登录，升职不自动获取项目或原件。M4B已接入受信任登记项目的创建者授权、采集任务创建及独立资料核对，见[执行合同](../docs/PROJECT_ACCESS_COLLECTION_CONTRACT.md)。管理员本人兼任职级的产品负责人审核，以及正式项目/采集工作区创建仍是后续切片，不在本入口自授。

使用Node24.15以上24.x。在本目录安装固定依赖后，从根目录一并启动严格设备服务和桌面：

```sh
npm ci --ignore-scripts
npm run setup
cd ..
npm run dev:team
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

M3A [OS密钥库与底座](../docs/DEVICE_IDENTITY_FOUNDATION.md)已由M3B接入正常main/preload/renderer，Windows两一键入口固定开启设备门，缺vault或旧服务不降级。首次绑定须重新输入密码并明确同意；同key持钥登录后才进入，异key/撤销历史只能走M3C受审换机。main逐请求签名、5秒心跳、租约单飞续接及断网暂停，key目录独立于业务profile/漫游userData。`node device-identity-smoke.cjs`仍只验证无窗口底层；`node device-client-smoke.cjs`验证正常绑定/在线会话，`node device-replacement-smoke.cjs`验证员工/管理员申请、审核及激活。批准不立即停旧机，明确激活才原子切换。Mac与正式服务仍待完成。

- renderer只加载`shenyi://app/index.html`，资源映射限固定HTML/CSS/JS/原标识；严格CSP，不开放网络、iframe、动态外链和通用文件协议。
- `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`，不关闭webSecurity；权限请求、新窗口、外部导航、webview和renderer下载拒绝。
- preload共暴露76个窄操作：M4A的67项加M4B的9项项目操作。每个IPC均检查当前窗口、主frame与固定页面来源；没有通用fetch/IPC、路径读写、URL打开、自由签名或命令执行。renderer无法指定外链，token/lease secret/私钥不进入renderer。当前13个表单/19个密码输入，阶段专项的旧数量仅为引入时历史。
- main固定API地址、禁止重定向、超时/响应体限额。token不回renderer、不写localStorage；响应只保留账号/任务/提交的明确字段。迟到的旧账号响应拒绝。
- 上传文件只能来自用户原生对话框选择，读取前检查常规文件及12MiB上限，按原始字节提交；renderer不能传本机文件路径。下载只在授权后通过原生保存对话框指定路径，不向renderer下发原件字节或路径。
- 对话框期间账号变化会取消旧账号操作。退出/401清空账号、团队、任务与输入状态，登录表单解除busy。已合法保存的文件不能承诺远程追回。

## M4B项目采集与资料核对

独立项目面板只按当前strict设备会话和服务端能力显示操作。9个新增窄RPC为`getProjectAccess`、`listProjects`、`getProject`、`listProjectMembers`、`changeProjectAccess`、`listProjectTasks`、`createProjectTask`、`listProjectSubmissions`、`downloadProjectSubmission`；精确参数与HTTP路径见[执行合同](../docs/PROJECT_ACCESS_COLLECTION_CONTRACT.md)。

当前有效创建者owner可验证当前密码、明确确认后调整其他普通经理/合伙人的读取、采集管理与独立核对权限；owner不自动获得读取，manage不自动获得review。读取权限允许列任务，read＋manage允许创建采集任务，新任务获得服务端UUID、open状态及版本0，随后仍须通过现任务分工明确指派实习生或助理。实习生/助理保持本人获派任务与本人提交范围，不看到项目目录或他人记录。read＋独立review才可查看项目提交及保存原件副本，不构成审计通过或专业签发。

项目/成员版本参与CAS；冻结项目保留获授权读取、关闭修改。完整移出采集访问须明确确认与当前密码，收回该项目任务/附件权限并退出目标旧登录。保存原件在main中依次GET、选保存位置、fresh HEAD及会话检查后写盘，原件字节不进入renderer。关闭面板、换账号、设备暂停和迟到响应不会解锁或污染后来的操作；未知结果不自动重发，应重连后刷新核对。

**正式项目或先行采集工作区的创建路径仍待用户决定。**当前无创建项目按钮或RPC，`POST /api/teams/:teamId/projects`返回404；无sidecar的旧项目不补owner、不出现在新列表。严格原生验收使用显式受信任合成登记，不能把它当成正常创建功能或旧中标报价正式立项已迁移。当前隔离schema为54表/105个非sqlite对象；M4B升级保全原51表/89对象的定义和全部旧行，不给共享普通9/review14演示账号自动增加项目、ACL或任务。

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
node recovery-smoke.cjs
node recovery-review-smoke.cjs
node task-management-smoke.cjs
node upload-preflight-smoke.cjs
node download-preflight-smoke.cjs
node member-deactivation-smoke.cjs
node device-client-smoke.cjs
node device-replacement-smoke.cjs
node business-role-smoke.cjs
node project-access-smoke.cjs
```

第一项需要根项目锁文件的jsdom；覆盖HTTP客户端和IPC/文件边界、真实DOM的撤销后再登录及XSS文本呈现，并检查身份能力、首绑状态清理、76项白名单及未配置入口。微信专项另见`tests/team-desktop-wechat.test.cjs`和`team-desktop-wechat-ui.test.cjs`。第二项仅适用于独立M2诊断合成服务，用`assistant-b`执行上传/下载/哈希/退出，会改变合成任务；不适用于当前严格设备一键服务。第三项需要根项目Playwright和已安装Electron，现自建随机端口strict HTTP、fresh SQLite、真实OSvault与D盘key/profile，明确首次确认后继续全部原登录/任务/会话/密码清理/退出/导航断言；不会接触已有8774或14演示账号。证据默认`D:/codex-temp/shenyi-device-client-20261115/default-smoke/run-*/`，可用`SHENYI_DESKTOP_EVIDENCE_DIR`改证据根目录。

第四项以Node24运行真实Electron＋隔离内存SQLite/随机端口HTTP，供应商明确合成；仅测试bootstrap重写client transport映射和浏览器opener，生产main/preload/renderer及服务处理器沿用。记录opener调用收据、直接派发合成HTTPS回调，再走真实HTTP轮询/关联/兑换；不访问微信、不展示假二维码、不修改共享demo。默认结果在`D:/codex-temp/shenyi-wechat-desktop-20261115/real-electron-synthetic/`。首次关联、再次登录、取消回调拒绝和过期通过也不等于OS浏览器、手机或微信平台验收。

第五项验证邀请/撤销、本人激活后无自动会话和资料权限、手机号登录及明确fixture指派后的单任务范围；SMS为合成捕获，真实Electron＋loopback HTTP/SQLite证据见邀请文档。不发送真实短信，不把fixture指派冒充管理员UI。

第六项验证本人多会话的密码重验、退出范围、另一端撤销后本端下次请求清退及他人会话保留；独立内存SQLite、随机端口HTTP与合成账号，不修改共享demo。默认目录`D:/codex-temp/shenyi-sessions-20261115/real-electron/`，不是设备/生产验收。

第七项在独立内存库中改合成账号密码，验证确认不一致不提交、错密保持、成功全部旧登录撤销、旧密码拒绝与新手机号密码同身份/范围重登；默认`D:/codex-temp/shenyi-password-20261115/real-electron/`。共享默认smoke仅填写清空，不提交演示账号改密。

以下第八至第十四项保留分阶段验收记录，账号/表单/IPC数量描述各自引入阶段；当前为76操作、13表单/19密码输入，普通9/review14合成用户。

第八项按[人工开通流程](../docs/MANUAL_TEAM_ONBOARDING.md)验证录入/密码批准/首管理员激活/技术管理员邀请员工。随机端口真实HTTP、内存SQLite及明确合成SMS，无真实供应商。该阶段引入时8个form、11密码输入。Windows `Start-Team-Review-Preview.cmd`显式开启独立合成审核账号 `reviewer-demo / ShenyiDemo!2026`，单独库及profile在 `D:/codex-temp/shenyi-team-review-preview/`；普通入口9用户/8业务成员不增权。两入口固定8774不可同时启动，缺SMS时不提供假成功。新管理员没有审计职级，详情及精确证据见流程文档。

人工原生对话框、真实短信/微信、完整安装升级、Mac、跨物理电脑和生产服务仍需各自验收；Windows本机设备绑定已由M3B/M3C专项验证，单元/DOM通过不能替代这些检查。

第九项验证[找回密码](../docs/PASSWORD_RECOVERY.md)，该阶段引入时9form/14密码输入。真实Electron和HTTP/SQLite，SMS与按user/challenge/期限绑定的单次authorizer明确合成；验证确认不一致零请求、无独立授权拒绝、成功仅撤本人旧会话、phone/成员/任务范围保持及新密码重登。默认真实服务未配恢复仍禁用；用户选定的审批签发链需继续实现。

第十项验证[内建恢复审批](../docs/RECOVERY_APPROVAL.md)，该阶段引入时9form/15密码输入。两个真实Electron窗口，SMS明确合成，内建批准核权/消费，不使用external authorizer；员工由own operator审核、管理员由独立owner审核，撤销票拒、自审404、scope保持和未自动登录均验。当前review入口新增独立 `recovery-reviewer-demo / ShenyiDemo!2026` 合成恢复审核员（无其他权限）；普通9用户不变，显式review为11用户。真实SMS缺席仍不能申请/重置，不作生产身份。

第十一项验证[任务指派/退回](../docs/TASK_MANAGEMENT.md)，该阶段引入时49操作、9form/15密码输入。三个真实Electron窗口＋随机HTTP/SQLite；main拦截OS picker仅选三份合成fixture，不冒称人工选文件。改派旧人task/history/download拒、新人无旧原件，退回重交保留三份字节/hash/history，陈旧页409需刷新且不自动重试。`manager-a / ShenyiDemo!2026`仅有team-a显式项目权限，可在预览选择任务体验管理；自动默认smoke只读不改分工。

第十二项验证[上传前置授权](../docs/UPLOAD_PREFLIGHT.md)：只读管理者按钮禁用且强制RPC也不打开picker；本人指派可提交。三次fresh能力/同版本/同账号检查分别在选择前、读取前和传输前执行，最后POST仍核权/CAS。真实Electron专项只拦截明确合成fixture的picker，记录取消、选择期间版本/撤权/冻结和原件hash证据，不接共享演示库。

第十三项验证[原件副本保存前授权](../docs/DOWNLOAD_PREFLIGHT.md)：main GET后只在确认保存路径、fresh HEAD仍有附件权限且同一登录代次时写副本；取消/撤附件权限/撤会话均零写入。双窗口Electron＋隔离落盘SQLite及合成原件，normal服务/main/disk三方字节与hash一致，401回登录并清资料，保存框为明确测试拦截。网络核权和本地IO非原子，不能收回已合法副本；该阶段仍49窄IPC。

第十四项验证[成员停用](../docs/MEMBER_DEACTIVATION.md)：独立technicaladmin管理本团队业务成员，独立member.disable owner处理管理员。审核入口显式增加administrator-demo、access-reviewer-demo，合成密码同ShenyiDemo!2026；普通9用户不增权，review13用户。两身份都无审计membership或资料grant。四窗口原生验证错密可重试、停intern阻止挂起保存、停partner、owner停管理员及旧登录401清空，原件/历史保留，3专用audit事件一致；保存框明确为测试拦截。该阶段引入时54操作、10form/16密码输入，重启不会自动复活已停用账号。

## M4B专项验证

从仓库根目录执行：

```sh
node --test tests/team-desktop-project-access-client.test.cjs tests/team-desktop-project-access-ui.test.cjs tests/team-desktop-project-entry.test.cjs tests/team-project-access-core.test.cjs tests/team-project-access-security.test.cjs
node desktop/project-access-smoke.cjs
```

严格原生专项自建随机端口HTTP、fresh落盘SQLite、14个合成身份及4个真实Electron/Windows OSvault窗口，验证可信登记项目中新建任务→明确指派→junior上传、owner/独立review合法副本、撤review挂起保存零写入及COMMIT丢回复仅一次POST。5张图、6阶段SQLite和report默认保留在`D:/codex-temp/shenyi-project-access-20261115/real-electron-synthetic/run-*/`。Open/Save仅拦截本次合成文件和路径；不触共享服务、不发送真实短信，不证明正常项目创建、人工OS对话框、Mac或生产部署。最终全量2202通过、0失败/0跳过，15项旧原生兼容通过；完整证据与分层边界见[进度](../进度.md)。

官方来源：[Electron安全](https://www.electronjs.org/docs/latest/tutorial/security)、[protocol](https://www.electronjs.org/docs/latest/api/protocol)、[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[发布记录](https://releases.electronjs.org/release?channel=stable)，2026-11-15核验。
