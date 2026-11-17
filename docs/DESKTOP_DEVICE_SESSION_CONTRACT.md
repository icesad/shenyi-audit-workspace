# M3B 正常客户端设备会话执行合同

本合同是M3B历史范围；新增换机权限/证明/接口和后续验收以[M3C合同](DEVICE_REPLACEMENT_CONTRACT.md)及[说明](DEVICE_REPLACEMENT.md)为准。原协议/设备状态投影保持，正常接口后续增加为64项。

2026-11-15，从M3A `77f6c1d` 接续，分支 `codex/desktop-device-session`。本轮唯一实现里程碑仍M3，交付正常main/登录/业务逐请求设备证明、在线续接与暂停；M3C换机审批及正式身份/HTTPS/Mac验收仍保留。本轮不改dist/旧平台/专业规则、不接真实资料、不push/main/上线。改写前19份备份在 `D:/codex-temp/shenyi-device-client-20261115/baseline/`。

## 冻结接口与职责

- client agent独占 `desktop/device-session.cjs`、`team-client.cjs`、`wechat-login.cjs` 和新 `tests/team-desktop-device-client.test.cjs`。root独占main/bridge/preload、每机目录helper、launcher、服务能力/connection路由及其测试、文档。UI agent独占team-ui三文件、新DOM测试及 `desktop/device-client-smoke.cjs`；security独占新独立安全测试。改其他既有测试先备份并告知root，不改弱断言。
- `createTeamClient`新增可信main注入 `deviceIdentity:{vault,platform,displayName}`；main始终注入，不能从renderer参数/环境开关禁用。无该注入只用于既有隔离M2测试/诊断，不作为正常入口；正常两一键server始终 `deviceProofRequired:true`。缺vault/旧server/缺设备能力时拒绝，不自动降级。
- 严格server的GET `/api/auth/methods`新增顶层 `deviceBinding:{required:true,serverId:<UUIDv4>,protocolVersion:1}`，保持原methods字段；旧非严格合成处理器不加该字段。client在持钥握手前验证，challenge/server/lease均须与该serverId一致。root新增GET `/api/auth/devices/connection`，只在严格设备门验证得到当前context后回 `{connected:true}`；直接handler或非strict请求拒绝，不进bootstrap名单，不携带业务资料。
- 公共设备状态精确投影：`{required,state,epoch,device,localFingerprint,expiresAt}`。required为boolean；正常true，state仅 `signed_out,enrollment_required,different_key,revoked,ready,paused,vault_unavailable`；epoch单调safe整数，状态/会话轮转变更，不能复用；device为M3A最小本人设备DTO或null；localFingerprint为hex64或null；expiresAt为当前business lease到期或null。诊断required=false允许 `diagnostic`。无token/lease secret/publicKey/privateKey/路径/自由签名字节。
- 登录返回原安全session投影并加 `device:<上述状态>`；未ready时memberships强制空，不加载业务cap/tasks。`getSession()`未ready返回最小session或null，不能凭bootstrap的GETsession200变ready。username、phone、Wechat统一异步finalize；samekey必须prove并验证新session/lease才ready；无history只进入enrollment_required；不同key/revoked保留历史阻断，无自动换key/enroll。
- 新3窄RPC：`getDeviceStatus()`只读本地main权威状态，不发网络；`enrollDevice({displayName,currentPassword,confirmed:true})`仅enrollment_required、密码最长512bytes、明确同意、单飞；成功返回ready session；`reconnectDevice()`无参数，fresh持钥续接成功才返回ready session，否则保持暂停/清退。preload总57项，不开放raw请求、签名或目录API。现logout用于取消设备步骤，清临时上下文、密码和迟到结果，尽力注销迟到minted token。

## 主进程生命周期与并发

所有受保护请求由main对同一份JSON serialization字节、method、准确path/query和新32byte nonce签名。bootstrap只允许固定内部路由，Wechat temporaryBearer及cleanup不得误用当前业务lease。sign或网络await后复查账号/transport代次；新minted响应的account/key/device/revision/serverId/sessionToken/leaseId/expiry必须完整一致才采纳，异常/取消尽力撤回该响应token，不能注销新账号。

续接单飞，当前业务authsession与lease约15min，提前60s以内可由当前持钥session的prove轮转；不得保留原bootstrap反复抢占，不缓存密码。一次轮转使旧请求和picker guard失效，迟到旧401/网络错误/成功不能清新会话或污染新界面；不自动重发业务mutation。旧在途写仍依M3A最终事务认证拒绝。自然到期要求重新登录，不能用client时钟或离线宽限放行。

main每5秒调用一次单飞 `checkDeviceConnection()`，ready用带签名connection核验，近到期续接；网络错误立即标paused并使业务guard失效。暂停后main可每5秒尝试持钥恢复，或用户显式reconnect；仍须当前session有效、fresh在线验证并证明后才ready。旧实例被另一持钥登录取代后，自己的已撤业务token必须401清退，不允许用任何残留bootstrap抢回。轮询不是实时推送：正常本机响应下最长约5秒发现替换，网络超时另受既有15秒上限约束；真实验收记录实际结果，不作绝对延迟承诺。

任何网络/有界响应读取失败都不能授予ready；已发mutation失败须明确结果未确认，联网后人工核对，不自动重放。主进程在系统resume时先暂停/失效旧guard再在线核验；关闭window停止timer、清会话并dispose内存vault。断网时强RPC也拒绝，不仅禁按钮；Open/Save对话框期间失效仍不得继续读/上传/写，HEAD及原业务preflight保持。

## 目录、界面与证据

root的目录helper默认Windows `%LOCALAPPDATA%/ShenyiTeamPreview/device-vault`、Mac本机 `~/Library/Application Support/ShenyiTeamPreview/device-vault`；拒相对路径/明显UNC/不支持平台，不从userData或业务profile推导，不静默迁旧key。main调用helper，测试仅通过隔离bootstrap依赖注入新D:目录，不能加生产降级开关。路径名称不能证明受管机器没有网络home/管理员同步，Mac实机及这类边界保留；OS加密不等于硬件不可复制。

UI沿用现视觉，普通/phone及Wechat都统一设备门；首次绑定复用原login form/password，原登录密码立即清空，重新输入密码、设备名及未默认勾选确认。不同key/revoked只说明员工联系teamadmin、管理员本人联系productowner，不假设审计职级。设备状态由getDeviceStatus轮询本地权威投影，旧epoch/账号/视图结果丢弃；paused隐藏并清业务内容/输入，仅留最小身份和重连/退出；ready后重新读取业务cap/tasks，不自动重放原操作。恢复无需renderer的navigator.onLine授予权限。

验收：三种登录入口、显式首次确认/取消、同key重登、异key/撤销阻断、挑战12域篡改、签名字节/路径/查询/空HEAD、租约续接/自然到期/新实例清退、取消/账号变化各await点、旧401/响应及文件picker竞态、断网暂停/恢复/未知mutation不重放、57IPC/无秘密泄漏。Node24完整portable和相关旧回归；新真实Windows Electron用隔离fresh DB/OSkey/profile、strict HTTP及原件hash和截图验收。当前两旧共享演示库只备份/保全/启动，不自动绑定其9/13账号；Mac/真实SMS/微信/HTTPS/生产缺席分别记未完成。独立关键审查后本地提交并更新进度/BACKLOG/STATUS，Goal继续active。

## 2026-11-18 补充：在线证明配额隔离

已签名请求在原签名验证后分桶：仅规范化URL的href严格等于origin＋`/api/auth/devices/connection`且method为GET，使用本人独立`device-connection`桶，每60秒24次；其他签名请求仍使用本人`device-request`桶，每60秒120次。带query／fragment（包括空分隔符）、其他method和实际未归一的路径别名不享该例外。WHATWG URL已经归一成同一href的路径属于同一规范路由，不声称保留未暴露的原始请求字节。

业务桶满不再单独耗尽在线证明；connection仍不是bootstrap，仍须当前token／租约／绑定、准确方法路径签名、body hash、fresh lease复查、nonce重放与每租约2048上限、usage事务检查。control第25次、断网或真实失效仍按原客户端规则暂停，不把429视为在线成功，不提高业务上限。两个桶的理论满额不保证可持续耗尽整份15分钟租约，2048 nonce上限仍独立有效。

本次配额补充不改变会话轮转、自然到期或原stage的session_hash／lease_id绑定。已暂停的分块只能由同一仍有效上下文核对原状态并明确续传；未知发布不能自动重发。验证范围见[当前进度](../进度.md)，不替代真实HTTP、Windows／Mac、原生文件选择、最大包或生产容量验收。


## 2026-11-18 补充：真实loopback HTTP验证

新增共享合成HTTP fixture使用实际监听器、真实fetch、固定origin／UUID及Ed25519设备证明，不再以直接dispatch代替被测流量。5项完整新增场景与35项原HTTP／transport回归通过，并由独立审查者重跑、逐请求复核及检查测试服务关闭。覆盖120业务配额下心跳继续、原ID／lease明确续传、实际撤权退役来源、已提交后真实socket丢响应只查原回执，以及control第25次429仍暂停。

本轮仅测试与证据增加，设备gate、客户端、来源管理、renderer、旧测试和专业规则原字节保持。文件选择为注入合成路径，页面为JSDOM，测试时钟和poll可控；不是正常Electron、OS Open／Save、TLS、Mac或530MiB容量验收。两个现有预览不重载，实际共享库及原一键保留；详细计数、源码与证据见[当前进度](../进度.md)。
