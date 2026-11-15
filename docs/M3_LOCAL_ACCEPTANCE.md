# M3 Windows 本地候选阶段门

2026-11-15，核对 `6a343f8`、实际代码及仓库外分层证据。独立审查结论 `PASS_FOR_LOCAL_M4_ONLY`：**可以进入隔离合成的M4本地研发，正式M3及整个商业化Goal没有完成**。

| 要求 | 当前实现和证据 | 判定 |
|---|---|---|
| 正常客户端强制设备身份 | main必注入OS vault；两正常一键固定strict；canonical Ed25519、精确bootstrap、method/path/query/body/nonce签名及重放拒绝 | Windows本地通过 |
| 单绑定和单业务会话 | 每用户一个active binding/live lease，新持钥登录发新token、旧登录失效；15分钟session与lease期限一致，最终API重新核权 | 本地API/原生通过 |
| 断网暂停与恢复 | main心跳、休眠/恢复先暂停、业务guard、近到期续接；未知写不自动重放 | Windows合成原生通过 |
| 每机OS密钥 | Windows非漫游目录、OS加密、损坏/不可用失败关闭，不静默换key | Windows实际safeStorage通过；不是硬件防克隆保证 |
| 员工/管理员换机 | employee本teamadmin审，administrator独立device.replace owner审；批准不撤旧，明确claim才同事务撤旧并发新绑定和会话 | 同Windows主机四个独立vault/多窗口通过，不是真实跨电脑证明 |
| 并发与数据保全 | body/KDF/txn、CAS/ABA/MAX/回滚、同毫秒最新申请、迟到激活receipt；原件和审计授权保持、挂起保存0新增写盘 | 独立89项安全、314项UI、6图/5库/4vault原生及共享库终审通过 |
| 真实远程服务 | 当前client固定loopback、server固定127.0.0.1；远程受信地址、HTTPS及部署配置装载 | **代码仍须实现**，不能只称缺服务器 |
| 正式身份和最高审核账号恢复 | 真实SMS/微信仍注入hook；最高owner历史身份拒绝普通换机，独立人工bootstrap未实现 | **代码及规则仍须补齐**；缺真人/供应商不冒称已验 |
| 签名安装/升级与Mac | 当前为private开发预览，未有Mac Keychain/UI/休眠/干净安装及升级证据 | 后续代码、证书/资源和双平台实机验收均未完成 |
| 各模块和旧资料迁移 | 正常桌面只提供team-ui及品牌四项资源，未加载旧dist六模块；新团队尚缺业务职级、项目/任务创建 | M4研发对象；旧库不自动迁移 |

证据根目录 `D:/codex-temp/shenyi-device-replacement-20261115/`：完整portable `unit-strict.log` 为1830通过/0失败/0跳过、437.96秒；54份源在全量期间hash未变。随后仅一份UI测试删除多余EOF LF，原件匹配全量清单，其余53份及最终native脚本不变，独立18/18另验，见 `post-format-final-review.json`。不重新运行旧测试来冒充新的M4证明。

严格原生 `real-electron-synthetic/run-2026-11-15T13-11-59-766Z/`、独立 `independent-native-review.json` 与 `independent-shared-final-review.json` 分别证明对应层次。两共享库50表/87对象；普通9/审核14用户，旧76定义和46原表行保持，启动后全部行/schema不变。318ms清退仅该次本机测量，Open/Save为明确合成拦截，不是真人系统选框。

本阶段独立事实清单：`D:/codex-temp/shenyi-m4-foundation-20261115/independent-m3-local-gate-review.md` 与同名JSON。其只读复核核对源码/证据hash，未重跑旧全量、打开DB或操作进程。M3状态记 `local_candidate_verified_integration_pending`，仅实现中的里程碑切换M4；M2/M3正式集成、最高owner恢复、Mac/真实跨电脑及生产关卡继续保留。

M4继续严格设备与授权边界，只用合成隔离数据逐模块实现。技术/付款管理员不默认看审计资料；四业务职级不等于签发资格；旧UUID/CAS/冻结/原件和公式链接保持，明确授权迁移另验。M4A先按用户新确认实现普通员工职级调整；管理员兼任审核、经理/合伙人建项目及创建者项目授权留各自后续切片。
