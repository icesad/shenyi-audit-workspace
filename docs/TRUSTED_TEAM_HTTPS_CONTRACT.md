# M3D 受信HTTPS团队服务执行合同

2026-11-17，base `6ccfe68ee4ec26b4599e4e7f3feac22093cd375d`，branch `codex/trusted-team-https`。上轮M4N为progress：本地提交、3829严格回归及原生/浏览器/独审已交付。当前clean；main060a98e/report894078b远端核同。1082原tracked/51,040,313B已逐raw备份在 `D:/codex-temp/shenyi-trusted-team-https-20261117/baseline/`，Git一次batch核1082对象，仅11既存纯EOL，不规范化源文件。

## 本轮结果与边界

补齐Goal/M3阶段门明确未实现的受信服务地址、HTTPS和客户端配置装载。当前main虽读取SHENYI_TEAM_API，client却只接受固定loopback；正常客户端必须能用主进程持有的固定HTTPS origin及预期server UUID，完成现有账号/设备/采集/原件操作。真实TLS网关、真实数据库及实际Electron main入口构成本片闭环。

本轮唯一实现切片是M3D集成补缺。M4仍in_progress；剩余旧专业模块的立项查阅/导出等授权继续待答，未知权限保持拒绝，不把本片当M4完成或另起业务授权。本人设备信息/历史正常可见性仍为后续已发现缺口，当前ready界面未提供该入口，不借HTTPS偷偷增加操作。

保留原普通/审核本机一键、固定HTTP loopback技术预览和现有私有请求/设备协议。HTTPS配置不授予数据权、不配置真实SMS/微信、不创建生产团队或自动迁入旧库；身份服务仍合成预览时照实标识。无真实云资源、域名/证书采购、CA系统安装、客户上传、生产发布、push/PR/main。真正国内服务部署、公开CA/HTTPS、生产身份、签名/fuses和Win/Mac真机仍分别未验；server可保持只监听loopback，由同主机受信TLS网关接入，不因本片开放公网HTTP。

## 固定客户端配置

仅主进程读取可选 `SHENYI_TEAM_SERVICE_CONFIG` **本机绝对路径**，拒UNC/设备命名空间、相对和无盘Windows路径，不自动连接文件共享。打开普通文件后有界读取最多16KiB+1，超过16KiB即拒绝，不只依赖先前stat大小。文件为严格UTF8 JSON，拒绝包括转义同名键在内的重复键，精确三个键：

```json
{"schemaVersion":1,"apiBase":"https://team.example.invalid","serverId":"11111111-1111-4111-8111-111111111111"}
```

这是格式样例，不是已部署地址。schemaVersion固定1；apiBase必须规范HTTPS origin（可有末尾单个/再规范化），无userinfo/path前缀/query/fragment、控制符、反斜线或隐式转换；serverId必须小写UUIDv4字符串。拒未知字段（含CA、证书私钥、密码、TLS跳验、代理、redirect）、数组/原型/getter/Symbol字段。配置不含凭证，目标origin和UUID由有权部署者核定，不允许renderer或业务参数覆盖。

无该配置且未打包时保留原local-preview。`SHENYI_TEAM_API`仅作兼容一致性检查：无profile仅允许原API_BASE；有profile如提供该变量须与profile origin相同，冲突/显式空值拒绝，不静默回退。打包运行必须有remote profile；不存在或无效在创建profile/vault/窗口和发送网络前失败关闭。加载一次后冻结，本进程不热切换服务。

远程拒绝禁用TLS校验的环境（NODE_TLS_REJECT_UNAUTHORIZED仅未设置或1）；不引入生产CA覆盖、checkServerIdentity替代或ignore-certificate-errors。测试CA只通过自有Node/Electron子进程的NODE_EXTRA_CA_CERTS使用，不改变父环境和系统roots。

新helper `desktop/team-service-config.cjs` 公开内部函数：`validateTrustedTeamService(value)` 返回冻结的精确三键remote profile；`loadTeamServiceConfiguration({env,isPackaged})`异步返回冻结 `{mode:'local-preview',profile:null}` 或 `{mode:'remote-https',profile}`。profile来自可信部署配置不是网络JSON。`createTeamClient`新增私有参数 `trustedService`；未提供时原baseUrl限制保持，有profile时baseUrl不得另指目标、必须有有效deviceIdentity。API_BASE原导出和值保持，不把构造器选项透传preload。

## 可信连接与服务身份

使用现有Node fetch默认TLS验证、固定origin、redirect:error。所有网络路径（普通request、phone/WeChat、设备bootstrap、导出及detached取消/logout）都从同一冻结profile派生，不能仍硬编码旧API_BASE。已有JSON/原件/ZIP大小、超时和取消上限不变；无新HTTP路由、RPC、form、秘密输入，保持116/21/26。

remote在每个非methods请求发送前，以同一HTTPS origin单独GET `/api/auth/methods`，无bearer/lease/body/秘密，timeout15s/最多1MiB/no-store。该probe不调用原业务onDispatch，也不算写已派发；它验证正常TLS、非redirect/正确最终URL、严格响应身份头及body.deviceBinding `{required:true,serverId:预期,protocolVersion:1}`。methods请求自己不递归probe。已知身份不符、错误证书/主机/过期或redirect时，不发送后续密码、验证码、token、签名或原件。探测可合并相同在途只读工作，但每个后续派发须绑定自己的generation/guard，不跨代次复用。

捕获generation/actor必须早于probe await；任何迟到probe或响应不得清除/暂停后来账号。正常HTTP响应及错误响应均先检查context，remote再验精确单值 `X-Shenyi-Server-Id` 与配置相同、response.redirected=false且response.url为所请求HTTPS URL；不接错服返回的token/lease/record。当前代次身份不符则清退/失效当前会话与私有缓存；旧代次仅SESSION_CHANGED。网络/证书故障按既有断网暂停处理，不自动重试写入。

detached清理可能晚于账号切换，仅可对固定origin通过同样无秘密probe后发送原清理请求，核返回身份，不修改新账号状态、不把错服响应中的token再次发送。已派发写的网络故障仍保留原unknown/原编号查询语义；本片不擅自重放。

后端在 `handleTeamApplicationRequest` 的统一Response边界为strict-device模式添加上述公开server UUID头，包含成功/错误/HEAD；从已存在metadata只读读取，不初始化或新增schema/业务事实。读取失败返回固定503，不泄露SQL/path或异常；HEAD在所有路径仍零body。UUID本已在public capabilities中公开，不输出用户、团队或秘密。诊断模式不伪造strict身份头。HTTP开发listener/health/Host gate不放宽；TLS网关测试必须原样保留method/path/query/body/认证头，并把上游Host设成后端真实loopback地址，不信任互联网转发身份头。

这不是额外的服务器签名：TLS认证配置origin，UUID防止误接其他数据库，仍不能抵御可信origin/服务自身或被攻陷客户端。origin+UUID不是越权通行证，每个业务API继续原当前身份、设备、团队/项目/任务授权。

## 正常界面与实现归属

main在可信配置加载后，通过自有受限index响应中固定的两项meta（shenyi-team-service-mode、shenyi-team-service-origin）仅投影mode和规范origin；UUID、配置绝对路径和原JSON不下发。值须属性转义/固定替换，CSP及五资产白名单/协议/Node隔离不变，不写inline script或通用配置RPC。静态index默认仍为local-preview供旧诊断DOM；真实main remote用冻结profile生成meta。renderer只用于显示“配置的HTTPS服务”及正确连接说明，不将这些meta当权限或网络地址；原合成预览身份/生产未完成提示保持真实。无整体UI升级。

- config/startup agent：仅新team-service-config.cjs、必要main/index/team-ui.js及新前缀team-service-config*和team-desktop-service-config*测试；不改client/backend/旧测试。
- client/identity agent：仅team-client.cjs、必要新private trust helper、application-api.mjs统一头与新team-trusted-service-client/identity测试；不改配置loader/main/UI/旧测试。
- TLS agent：证书及正常Node/Electron预检、随后只新TLS helper/integration tests和新native driver。所有private PEM在仓库外，root唯一允许正式native UI运行；预检无BrowserWindow不冒称GUI验收。
- root：合同/使用/四checkpoint/M3真实未完项、全部旧fixture必要适配、full/共享保全/提交；独立agent只读关键逻辑/证据，不修改产品来迁就测试。

## 结束测试与保全

先配置/客户端/身份头专题及直接旧测试：canonical profile、打包无配置、空env/冲突、非法URL/UUID/字段、renderer注入、错误TLS/证书/域名/过期、UUID/header/body不符、同/跨origin redirect、所有入口及detached固定目标、probe和body/KDF的代次/撤权/ABA、超时/取消/unknown不重放。正常HTTP preview和旧认证/设备/原件/ZIP上限保持。

真实TLS端到端使用现有Git OpenSSL生成合成CA/leaf；自有高位随机loopback端口+strict HTTP后端，真实账号/设备/采集/原件hash允许拒绝，不以mock fetch替代证书验收。节点和Electron均须有不信任CA失败、信任CA通过、badhost/expired失败及redirect目标0请求的证据。测试CA无系统安装、不关闭校验、不修改Electron fuses。

正式Windows native在产品冻结/预检/独审后由root单独启动实际 `desktop/main.cjs`，使用D新profile/vault/配置+测试CA子env；正常UI确认绑定→本任务采集/原件保存及跨team拒绝→断网暂停恢复，验证HTML实际显示配置HTTPS origin和正确预览语义、renderer无Node/任意网络或秘密、私有key/原件不漏profile。错UUID或不信CA必须阻止秘密派发。记录实际URL/握手、原件byte/SHA、SQL/auth及业务变化，不声称实际客户/公网/真人picker/Mac。

之后原 `scripts/test.mjs --unit --strict`、按影响旧原生兼容、四真RO onlinebackup/两原cmd一键及独立复核。保70表217定义/全部typed数据与9/16账号/UUID/10业务空态；nonce/限额只在自有合成fixture如实计。所有旧改先备份、精确改旧fixture只弥补新前提，不弱化guard，失败前件保留。资料/公式/模板/A状态机不改，M4N源包和当前review用户资料不触碰。

本轮预检依据：`tls-probe/verification.json`七项真实Node/Electron通过；初次证书日期格式失败留根failure.json。官方机制见[Node 24额外CA](https://nodejs.org/docs/latest-v24.x/api/cli.html#node_extra_ca_certsfile)、[Node fetch](https://nodejs.org/docs/latest-v24.x/api/globals.html#fetch)、[Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)。当前Electron测试确证子进程CA可用；发布fuses/签名仍须M7另验，不据文档泛推生产可用。
