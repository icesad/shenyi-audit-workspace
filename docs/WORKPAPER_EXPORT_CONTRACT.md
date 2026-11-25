# M4Q 团队底稿固定版本导出合同

## 2026-11-17 最新：桌面主进程与私有文件流程

M4Q已接桌面主进程typed client及私有文件工作流：设备签名／server UUID／窄响应门、完整包native picker与Worker核验、同ID分块迁入／显式续传／未知结果原回执；read && export下流式临时落盘、ZIP实际CRC／SHA／冻结绑定、最终核权及实际发布目标复核。真实createTeamClient到严格服务端的迁入／原表／填写CAS／回执／导出已测，但尚未注册正常底稿IPC与UI。

固定Node24相关门62文件1100/1100通过，零失败／跳过／取消／todo，848.765秒；1252候选文件运行前后raw一致，TAP连续编号／plan／footer及exit0核对。包括本轮129例（API24、实际main-client4、迁入26、transport13、落盘51、发布11）及前项服务端／实际Chrome原表解析、旧client／设备／账表／来源／资料导出／受信HTTPS／135-RPC兼容；不是完整严格门或正常底稿UI／真实OS对话框验收。证据根D:/codex-temp/shenyi-workpaper-desktop-client-20261117/。

关键代码由其他作者独立复核：API31/31（158范围文件）、迁入与Worker28/28（187）、导出／落盘79/79＋4/4（619）。root已核28／49／29工件、原始TAP／命令exit及当前直接文件与范围哈希。发现的4项P2均修复并按原事实复验关闭，旧失败／BUG复现保留；作者自身代码未自验成独审。范围不扩大为正常IPC/UI、OS原生、Mac、最大容量、M4P整体、完整M4Q或Goal。

实际共享库未打开／升级，本轮一键未重验；未push／进入main／上线。下一步接正常底稿IPC、页面权限／来源／版本原表／填写与回执／导出，再做完整严格门、相应原生与剩余独审。M4和完整Goal active，专业复核／新冻结／重开仍待米老师。见[桌面主进程合同](WORKPAPER_DESKTOP_CONTRACT.md)。

以下历史记录保留各自阶段范围，当前状态以上述为准。

接续[三权](WORKPAPER_ACCESS_CONTRACT.md)、[首次迁入](WORKPAPER_DATA_CONTRACT.md)、[原表](WORKPAPER_FORM_CONTRACT.md)和[填写](WORKPAPER_ENTRIES_CONTRACT.md)。本检查点实现服务端read && export导出一个已保存版本，正常桌面接入继续。

## 请求与权限

GET /api/teams/:teamId/projects/:projectId/workpapers/export，仅接收各出现一次的version、projectRevision、grantRevision三个规范正安全整数。须设备签名、当前持钥单业务会话、有效团队／项目业务资格及底稿read && export；不要求write或负责人身份。负责人、职级、技术管理员及其他模块权不赠送底稿权。active或frozen项目可按双权导出，不解冻或运行业务计算。

须已有完整包首次迁入。固定请求版本、当前head、项目／授权revision和W→Q或已审核Q来源身份。可显式请求历史版本，不以最新版本替代。预检及每段输出前重查账号／租约、授权／来源stamp和固定head；撤权再授ABA、停用／职级变化、重登录、租约失效和并发新head应失败或中断。

## 内容与格式

独立格式shenyi-team-workpaper-export、schemaVersion 1，stored ZIP仅含manifest.json、record.json、source-manifest.json及本版本引用的originals/<sha256>.bin。record.json逐字节保留该不可变版本的填写、逐引用MIME、原Q、索引和既有冻结；不同SHA原件各存一次，按本团队／项目／版本引用核验实际长度、SHA和CRC32。source-manifest.json保留首次迁入清单，另列首次原包、原记录／清单SHA与迁入时间。

只包含所选版本及其原件，非完整版本历史／账号授权／其他模块／整软件备份；当前不支持团队包再次迁入。策略明确completeVersionHistory:false、teamImportSupported:false、identityAuthenticatedByPackage:false、professionalApprovalClaimed:false。SHA只证明一致性。旧版严格迁入解析器应拒绝新格式，不把团队来源伪装成本机旧版来源或修改旧兼容格式。

## 容量与传输

沿用原件单份24MiB、补充单份12MiB／总量64MiB、原件总量496MiB、记录32MiB、原清单1MiB及最多218不同原件的已迁入约束。新清单亦限1MiB，ZIP总量硬限532MiB；schema和请求正文上限不变。逐个原件读取，输出块最多64KiB，清单和记录保留在有界内存。先核验／计算确定性ZIP长度和整体SHA，再重读实际原件输出；非OS内存硬限或最大容量性能证明。

响应private no-store、nosniff，带Content-Length、X-Shenyi-Workpaper-Export-Sha256及固定版本／record SHA／原Q／项目和授权revision，通用边界补server UUID。预检至流结束持有已有每进程一个large／每用户一个数据permit；完成、取消、错误、请求abort、60秒无拉取或30分钟总时限释放。此为单进程候选，非集群限流。

本机HTTP仅对本响应用带背压pipeline，不先arrayBuffer整包；断连传播abort，流失败销毁连接。业务表、原件、历史与schema不写；只读快照total_changes变化应回滚。设备nonce／限流／使用记录照既有规则更新。

撤权不能回收此前合法下发的字节或文件。中断前缀不得视为完整包；桌面后续须验证长度、整体SHA和ZIP清单，写独占临时文件、最终重新核权和固定版本后原子发布，失败清理本次临时文件。目前未接正常桌面按钮／原生保存闭环，不宣称一键可达。

## 验证与边界

固定Node24相关门47文件828/828通过，零失败／跳过／取消／todo，642.016秒；1234候选文件运行前后raw一致，连续TAP／plan／footer与exit0核对。包含本轮24例、原HTTP及前序权限／迁入／原表／实际Chrome四型解析／填写／设备／schema兼容；不是完整严格门或正常桌面／原生验收。证据根D:/codex-temp/shenyi-workpaper-export-20261117/。

本轮导出及新增路由／HTTP流式转发已由独立agent有界验收，原24例及额外探针和真实TCP／Python ZIP核验分别记录，root已核对原始证据与当前文件哈希，未解已确证P1/P2为0。前序基础授权／完整包迁入／Office准入也已补独审：146/146、实际Chrome9/9、额外3/3，原TAP与36证据文件／22直接源绑定均已核对；原填写独审仍保留其59/59＋Chrome14/14范围。不得扩大为M4P整体、正常桌面、完整M4Q或Goal验收。

基线6c6848dc5aebe3e12c5d09b67a26eb23728a2e47，分支codex/workpaper-access。仅本地提交，未push／main／上线；实际共享库未打开／升级，本轮一键未重验。M4P整体独审、M4Q桌面及完整严格门／原生、Mac／真实业务／生产仍待验，Goal active。专业复核、新冻结／重开由米老师确认，真实客户迁移另行授权。
