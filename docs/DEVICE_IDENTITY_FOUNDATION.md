# M3A 设备身份基础

2026-11-15，分支 `codex/device-identity-foundation`，从成员停用提交 `8ea2f73` 接续。设备服务端与主进程密钥库已完成本地验证；**普通客户端尚未接入设备登录，M3整体仍在进行**。详细字节、接口和授权合同见 [执行合同](DEVICE_IDENTITY_FOUNDATION_CONTRACT.md)，M2未完项见 [本地阶段门](M2_LOCAL_ACCEPTANCE.md)。

## 用户已确认的行为

- 每账号在Windows/Mac合计最多绑定1台电脑，同时只有1个业务会话。
- 同机重新完成持钥登录，新业务会话接替旧会话；只验证密码的临时登录不能踢掉正在使用的合法实例。
- 断网暂停团队业务，联网后重新核验；没有离线业务许可。
- 员工换机由团队管理员审核，管理员本人换机由产品负责人审核。重装或丢失密钥不能通过删除本地文件重新首次登记。

## 本轮实现

`shared/device-proof.cjs` 固定Ed25519签名格式，严格校验canonical SPKI、公钥指纹和签名字节。挑战绑定服务端、账号、实际会话、密钥、用途、版本和120秒有效期；完成时从数据库重建上下文，单次消费。设备ID或Bearer副本本身不能完成持钥证明。

`server/team/device-*` 新增首次登记、同钥证明、本人撤销、本人设备状态及严格设备门。一次成功登记/证明原子发放新账号会话和15分钟在线租约，同时撤销旧业务会话；租约不可移接另一账号会话，账号会话到期也不晚于租约。本人撤销保留历史并撤销旧会话，不能再次走首次登记，换机审批尚未开放。

严格门通过服务端内部 `identityProviders.deviceProofRequired===true` 开启，逐请求验证实际method、path/query、正文SHA256和随机nonce；防重放记录有上界。先验签再消耗持钥请求额度并读取有界正文，下游继续核验当前团队/角色/任务/附件范围。设备证明只收紧访问，不增加审计资料权限。HEAD的成功和错误响应均无正文。

`desktop/device-key-vault.cjs` 是仅供main调用的库，使用Electron45异步safeStorage保护持久私钥；文件损坏、系统解密失败或保护不可用时拒绝，保留旧文件，不静默生成替代设备。只提供公钥和固定上下文签名，无通用签名IPC或私钥导出。

正常main/preload/renderer与一键启动器本轮未接设备流程，仍为54窄接口、10个表单、16个密码输入。**现有loopback预览使用M2诊断模式，不满足对外版本的强制绑定条件**；不能把底层验证报告当成普通客户端已绑定的证明。

## 已完成的验证

| 层次 | 实际结果与范围 |
|---|---|
| Node24完整portable单元 | `node scripts/test.mjs --unit --strict`：1552通过、0失败、0跳过，271.29秒；新codec6、核心30、vault27、独立安全47均包含在总数内 |
| 独立安全 | 跨账号/会话/用途/服务端/密钥、到期/重放/竞态/回滚、旧在途请求撤销、路由白名单、弱点公钥伪签及限流验证；最终无未关闭P1/P2 |
| Windows原生底层 | Electron45.3.2真实safeStorage＋随机端口严格HTTP＋隔离SQLite，无BrowserWindow：密钥重开一致、登记/证明/撤销、旧会话401、错误key/设备及重放拒绝、上传62字节原件/hash与HEAD空体保持 |
| 既有桌面兼容 | 成员停用、下载、上传、任务管理、改密、会话、开通、恢复及恢复审核9项原生流程均通过；默认真实Electron smoke也通过 |
| 两份演示库 | 启动41表/67对象→46表/76对象；旧67定义及全部旧行保持，只新增5表/2索引/2触发器与一行 `device-server-id`；普通9/review13用户不变，设备表全空；smoke后仅review三张认证表正常变化 |

独立测试曾复现：仅持被窃Bearer/租约、没有私钥的请求可以用错误签名耗尽合法用户额度。已把额度消耗移到成功验签后；120次错误签名后合法请求仍成功，合法请求自身的120/min限制保持。保留修前复现和修后回归，没有放宽限制。

本轮证据根目录为 `D:/codex-temp/shenyi-device-identity-20261115/`：完整日志 `unit-strict.log`；原生底层最终run `real-electron-synthetic/run-2026-11-15T11-21-13-425Z/`；独立审查、9项 `compatibility/`、`default-electron/`、两库before备份及startup/after-smoke保全报告均在仓库外。它们只含合成账号/资料，不是Mac、真实供应商或生产验收。

## 复制边界与后续

OS加密不等于硬件不可导出。Windows实测同一OS保护上下文复制加密文件后仍可读取；没有做跨电脑/跨OS复制实测。DPAPI也存在域漫游边界，不能宣称复制文件必然失效。M3B必须把设备key放在每机非漫游目录：Windows使用LocalAppData下独立设备目录，Mac使用本机Application Support目录；不跟随Roaming userData、云盘、业务备份或导出。原有文件位置/权限异常必须明确失败，不得自动搬迁或换key。当前vault只接收可信目录，生产目录选择尚未实现。

M3B接入正常客户端：主进程驱动登记/持钥登录、所有受保护请求签名、15分钟租约续接、旧会话清退、断网状态与重连，以及强制设备入口和相应UI/原生验收。M3C补员工/管理员的换机申请、审核、原子撤旧与新设备激活，另行验证密钥遗失和重装。Mac、签名安装/更新、真实身份供应商与国内HTTPS仍待完成。不得把诊断开关用于首个外部版本。

Windows/macOS平台保护的依据见 [Electron45 safeStorage](https://raw.githubusercontent.com/electron/electron/v45.3.2/docs/api/safe-storage.md) 与 [Microsoft DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)。这些文档不替代实机证据。

本轮未push、未进入main、未上线；普通一键预览已实测可达，完整Goal保持active。
