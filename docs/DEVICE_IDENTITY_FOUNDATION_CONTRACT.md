# M3A 设备身份底座执行合同

本合同保留M3A当时范围；正常客户端和强制入口的后续实现见 [M3B合同](DESKTOP_DEVICE_SESSION_CONTRACT.md)及[验收说明](DESKTOP_DEVICE_SESSION.md)，不据下文历史“尚未接入”否定后续实际交付。

2026-11-15，从8ea2f73接续。M2本地候选通过阶段门，正式供应商/配置和生产仍未完成。M3是当前唯一实现里程碑。M3A交付持钥/单绑定/单业务会话的后端基础、严格模式设备签名门及OS加密key vault；M3B还须把它接入main/renderer正常登录与一键入口，M3C完成换机审批。**本轮不把现有54IPC桌面称已强制绑定，不把诊断模式当正式交付**。

## 已确认规则与边界

- 同账号Windows/Mac合计最多1绑定、1业务会话；完成新持钥业务登录后撤销旧业务登录。仅有密码、未完成设备证明的临时登录不能踢掉合法旧实例。断网无团队业务操作或离线许可。
- 每次换key（含原key遗失/重装产生新key）都不能通过“无active绑定”重新首次登记。历史绑定不能删除；换机员工由teamadmin、管理员本人由productowner审核。审批M3C实现，M3A无自助替换入口。
- OS保护不是硬件不可复制证明；DPAPI不防同OS账号恶意程序，漫游/系统克隆有边界。私钥不入Git、不进入renderer/日志、不同于更新签名和发行证书。普通审计授权仍按当前数据库判断，设备证明只能收紧，不能扩业务权限。

## 共享签名字节规范（root独占shared/device-proof.cjs）

- Ed25519；publicKey是canonical DER/SPKI的base64url，必须44bytes/59chars、算法ed25519、import/export字节相等和base64url回编码相等；fingerprint为SHA256 DER小写hex64。signature64bytes/86chars，nonce32bytes/43chars，Bearer256bit的SHA256为sessionBinding hex64。无PEM/JWK/动态算法协商。
- challenge字段精确为`purpose,serverId,userId,sessionBinding,keyFingerprint,identityEpoch,bindingRevision,approvalRequestId,challengeId,nonce,issuedAt,expiresAt`；purpose仅enroll/prove/revoke，approvalRequestId必须空字符串，UUIDv4用于serverId/challengeId，ASCII userId，整数safe。期限恰为120000ms，服务端时钟最终判有效，不能由client时钟放行。
- 原文为`Buffer.from('SHENYI-DEVICE-PROOF\0v1\0','ascii')`（运行时两个实际NUL）＋UTF8 `JSON.stringify`按上述顺序排列的12元素数组。`sign(null,payload,key)`/`verify(null,...)`，不使用createSign('SHA256')。server从存储记录重建，不信任完成body携带的身份/角色/用途/时间。
- request签名域`SHENYI-DEVICE-REQUEST\0v1\0`＋固定数组`[serverId,userId,sessionBinding,deviceId,bindingRevision,leaseId,method,pathAndQuery,bodySha256,nonce]`。nonce为client新随机32bytes，服务端按lease记录防重放；method/path/query/实际body hash都必须匹配。此为自有协议，不声称完整DPoP或其他认证合规。

sessionBinding与现有team_sessions.token_hash同算法：对canonical Bearer字符串本身的ASCII/UTF8字节作SHA256，不是对解码出的32bytes取hash。serverId缺失时只有所有device表均无历史才可首次生成；有任何历史却缺失/损坏必须拒启动。业务session的expires_at及返回expiresAt同步缩至lease到期，保证自然到期也在既有最终事务认证处被拒绝。nonce每lease/active user上界2048且proof限流120/min，过期或撤销lease的nonce可清理，活跃lease内不能提前丢弃防重放记录。

## API（server agent独占device-schema/policy/api/gate）

1. GET `/api/auth/devices`：当前账号自己的`{hasHistory,canEnroll,device}`；device为最新绑定的`{id,displayName,platform,keyFingerprint,status,revision,boundAt,revokedAt}`或null，无私钥/lease secret。无其他用户/团队资料。
2. POST `/api/auth/devices/enrollment-challenges` body仅`{publicKey,displayName,platform,currentPassword}`。无任何历史绑定才可发；current password KDF重验，同user/token/credential/identityEpoch在body/KDF/txn后重查。platform仅win32/darwin且仅标签，名称1..80safe文本。创建随机challenge+nonce，120s，固定purpose enroll。
3. POST `/api/auth/devices/proof-challenges` body仅`{publicKey}`，必须当前active绑定同canonical公钥；固定prove。
4. POST `/api/auth/devices/revocation-challenges` body仅`{publicKey,revision,currentPassword}`，当前key/revision和密码重验，固定revoke。
5. POST `/api/auth/devices/enroll`、`/prove`、`/revoke` body均仅`{challengeId,signature}`，路由绑定purpose。挑战必须属于实际当前user/token，当前账号/epoch/绑定revision/期限未变，正确验签后txn重查并CAS消费一次；foreign/unknown404、失效session401、expired410、错误签名403（最多5次后revoke）、状态冲突409、参数400；不回传原始错误/secret。
- enroll原子创建唯一active绑定及bound事件；prove只接受active绑定；两者随后原子发放新账号session及device lease，并撤销发起bootstrap session和此前该user的所有leased业务session（其他尚未完成持钥证明的bootstrap不是业务会话）。当前issueSession复用，结果`{...账号session含token,device,lease:{id,token,serverId,deviceId,bindingRevision,expiresAt}}`，仅未来main采纳，renderer不接token/lease secret。lease TTL15min且不超过新session期限，是在线凭证寿命，不是离线宽限。一个user最多一条未revoked lease；每次lease绑定不可换的authsession，换lease须换token，避免在途旧写跳过最终撤权。
- revoke原子标绑定revoked/revision+1、撤该user全部session/lease与未消费device challenge、写事件，返回`{revoked:true}`。保留binding/history/phone/credential/原件；新登录也不能重新走首次enroll。
- schema只追加device bindings/challenges/leases/request_replays/events及必要索引/撤session时撤lease的触发器；不alter旧表。稳定serverId存现metadata新增一行，未知/损坏不能重建或覆盖。binding仅1active的DB唯一约束，lease仅1未revoked的DB唯一约束。设备/身份/task无关revision各自safe，溢出及audit错误整笔回滚。事件无token/password/私钥/正文。

## 严格模式中央设备门

- `identityProviders.deviceProofRequired===true`是M3A内部测试/接入开关，不能由请求字段或header改变；默认旧loopback诊断仍保持M2实验模式，尚未强制设备。M3B必须接main并使正常设备预览入口强制开启，首个外部版本不能关闭。新enroll/prove/revoke端点本身始终执行完整证明，不因开关跳过。
- strict gate覆盖所有非bootstrap应用路由：业务读取/搜索/统计/上传/附件GET/HEAD、邀请、恢复审批、开通审核、人员管理及账号高风险操作。bootstrap只能精确method/path白名单：公开能力/初始登录、微信登录回调链、受邀/首管理员激活、本人忘密/SMS申请与消费、own session最小视图、logout、上述device挑战/完成/own状态。owner审批list/decide不豁免；不能用`/api/auth/*`大前缀或query豁免。root据当前真实路由冻结名单。
- header仅`X-Shenyi-Device-Lease`（secret token）、`X-Shenyi-Device-Nonce`、`X-Shenyi-Device-Body-SHA256`、`X-Shenyi-Device-Signature`。server由实际Bearer查当前user/lease/device/publickey；先用声明hash验签，再有界读实际body（上限17MiB，与现上传JSON兼容）并比hash，txn重查同user/token/lease/binding/期限、唯一nonce消费，之后才dispatch。重建Request保留已验证headers及精确body字节，不能让旧body parser读到空体。GET/HEAD同样签名空body。
- 当前token/lease/binding失效或缺证明即拒绝，HEAD任何错误仍空body。nonce防重放不改变业务权限；下游仍重新按当前member/grants判断。旧leased token在新业务登录时被撤销，因此现有body/KDF后和最终事务authenticated检查仍能拦旧写，不能仅一次入口检查。
- bounded nonce metadata可在失效后清理，绑定/审计/客户原件不能删除。签名不替代TLS，当前loopback不代表国内HTTPS已实现。

## 桌面key vault（UI agent独占，不改现main/preload/renderer）

- 新`desktop/device-key-vault.cjs`仅main内库，注入Electron safeStorage、可信root目录；默认仅win32/darwin。在app.ready后用45已实测异步`isAsyncEncryptionAvailable/encryptStringAsync/decryptStringAsync`，解密结果是`{result,shouldReEncrypt}`。不可用、拒绝、临时错误、坏文件均failclosed，不降级plaintext，不自动生成新key覆盖旧key。
- keyFile固定root内v1 JSON，包含public canonical SPKI/fingerprint及OS加密的PKCS8 base64url，私钥不得明文落盘/返回。上限64KiB、regular file、严格schema，验证私钥重导出canonical及派生公钥一致。新文件wx/0600原子创建与单初始化Promise；已有文件冲突则重新读取，不能覆盖。shouldReEncrypt只允许验证同一key后安全原子更新密文，失败保持旧文件。
- module只返回public identity与签固定challenge/request的方法，不导出privateKey、不新增通用IPC。签challenge必须用可信上下文核purpose/serverId/userId/实际sessionTokenHash/本key fingerprint/bindingRevision，不能让renderer提供自由payload。request签名同理，供M3B main驱动使用。销毁内存不会删除持久key；重装/复制失败不能静默变新设备。
- 实机probe已证win32/Electron45.3.2异步可用；实际vault native验证只用全新D:合成profile，不给现13用户绑定。Mac及跨电脑复制实测仍未验。
- M3B生产调用目录必须每机非漫游：Windows采用LocalAppData内独立设备目录，Mac采用本机Application Support目录；不得直接沿用Electron默认Roaming userData、云盘或业务备份。当前vault只接受可信绝对目录，目录选择尚未接入main。此举避免普通配置漫游带走设备key，不构成对同OS用户恶意程序或整机克隆的防护承诺。旧key不得静默迁移/重建，异常保留原件并失败。

## 结束证据与后续

独立关键审查：canonical DER尾随/错算法/签名、challenge跨user/token/purpose/key/server/epoch、到期/重放/并发/回滚、先绑定后撤销不能重新首次绑定、单lease替换旧token、old body/KDF在途拒绝、strict所有路由/HEAD/上传exact bytes及role scope、缺设备/伪header/断网无替代授权。vault坏文件/不可用/不同key/重加密/并发/密钥不泄露和真实Windows加密持钥往返。

Node24全量portable、M2回归、legacy预览库在线备份/原表定义旧行保留；本轮54IPC/10form16密码保持，无正常桌面UI绑定接入、不创建真实设备许可、不push/main/部署。M3仍in_progress，M2正式adapter/配置、Mac/HTTPS、M3B客户端联动和M3C审批均不得记完成。根进度持续记录。

官方依据已核对：[Node24 crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html)、[Electron45.3.2 safeStorage](https://raw.githubusercontent.com/electron/electron/v45.3.2/docs/api/safe-storage.md)、[微软DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)。本机CLI为Node24.22.1，Electron45.3.2异步API已真实探针验证；文档不是Mac实测，也不能证明硬件不可复制。
