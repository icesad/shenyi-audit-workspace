# M4Q 团队底稿桌面主进程与私有文件流程合同

## 2026-11-17 最新：正常底稿桌面入口

M4Q正常底稿桌面候选已接入：旧135接口保持、尾部追加20窄IPC；负责人验密分别配置查阅／填写／导出，完整包显式首次迁入，原表／历史版本、CAS填写保存、原编号回执及所选版本原生导出进入正常页面。实习生／助理入口隐藏且直调拒绝；账号／设备／项目或失权清除旧内容，未知操作不盲重发。

Node24完整可移植单元严格复验262文件4756/4756通过，0失败／跳过／取消／todo，1190.891秒；1264候选文件运行期间raw一致，TAP编号／plan／footer和exit0已核。按原脚本--unit发现集合，粗排除63整文件，不称完整browser strict。原串行4732项中的辅助层清单遗漏、随后4750项中的文件晚改校验盲区均已修，原失败保留；最终按相同260文件＋新增回归2文件重新执行，2并发，未改原runner／旧测试断言或工作因子。证据根D:/codex-temp/shenyi-workpaper-ui-20261117/。

真实Chrome作者28项／8图、Windows正常Electron合成闭环另行记录；严格签名HTTP／DPAPI／SQLite、155 API／channel、26表单／31密码框及退出清理均分层验证。Chrome native geometry为明确受控视图，不冒充真实catalog；Windows注入文件选择路径，不冒充实际OS文件对话框操作。deadline／IPC／UI／兼容层、schema剥层及持久内容复核分别独审，已确证问题的原失败、修复与关闭证据已由root按原始TAP／manifest／当前源码复核。

实际共享库仅作只读备份与隔离副本预演，尚未升级，本轮原一键未重验；未push／进入main／上线。M4和完整Goal active。下一步补完整browser strict、最新Windows原生独立复核、实际OS选件／保存、实际共享库升级保全及两原一键重验、M4P整体独审与其余M4模块；Mac、安装更新、最大容量及真实供应商／客户／生产仍未验，专业复核／新冻结／重开仍待米老师。见[正常底稿桌面合同](WORKPAPER_UI_CONTRACT.md)。

以下记录保留其历史阶段范围。

本阶段接续[服务端权限](WORKPAPER_ACCESS_CONTRACT.md)、[完整旧包](WORKPAPER_PACKAGE_CONTRACT.md)、[首次迁入](WORKPAPER_DATA_CONTRACT.md)、[原表](WORKPAPER_FORM_CONTRACT.md)、[填写](WORKPAPER_ENTRIES_CONTRACT.md)和[团队导出](WORKPAPER_EXPORT_CONTRACT.md)。实现现有createTeamClient的受限底稿能力、完整包选择／分块迁入／原编号续查及临时文件流式保存。尚未注册正常底稿IPC或UI，不把主进程和注入对话框测试冒作用户已可从一键入口使用。

## 主进程请求与响应

新增typed client用于独立底稿项目／人员／三权、首次导入能力／分块／状态／取消／提交、已存数据／版本／记录／原件／原表、填写CAS及本人原操作回执。沿已有strict设备签名、单会话租约及受信HTTPS机制；底稿响应另与已核验的server UUID绑定。输入只接受精确被动字段，UUID／SHA／整数必须规范全长，不执行访问器、任意网络地址、脚本或外部链接。

专用transport能力仅允许精确底稿路径／方法：record32MiB、original24MiB、form32MiB+4096信封、其余JSON1MiB；export仅专用532MiB流式读取，默认资料／旧模块限额不升。记录、原件与原表绑定项目、来源Q、版本、真实record／original SHA、实际引用及各响应字段；读取前后重查本模块权限和来源。公式／隐藏／合并等仍沿原服务端字段模型。原表readOnly不是账号write权，填写须明确read && write且当前head；冻结呈现还须与已存record的原Governance.isLocked交叉一致，内部自洽的假未冻DTO也应拒绝。原专业规则不改。

当前普通请求仍沿既有15秒时限，导出单独30分钟；服务端Office线程上限45秒。复杂原表／较慢大响应的预算对齐须在正常UI接入前补齐并实测，本轮小包／本机通过不能证明该边界或最大容量。

敏感读取受账号／设备guard、caller上下文、显式read epoch与signal保护，晚结果丢弃并清临时字节。写请求每次只发送一次并记录实际onDispatch，未知结果不自动重发，不把前端状态当服务端回执。接口只在主进程闭包中调用，不下发bearer、密钥、原始fetch或这些私有transport hooks。

## 完整旧包的显式迁入

对话框前须owner、read && write、active、已有已核验来源Q且尚无底稿数据。renderer只能给当前项目／授权版本，不给任意文件路径或原件字节。native picker返回路径后有界读最多530MiB，并把私有buffer移交隔离Worker运行原完整包codec；Worker返回原Q、已存版本、record／package SHA、原件与既有冻结数量等最小summary及转回私有bytes。V8 old512MiB／young32／stack4与120秒超时不等于OS内存硬限，最大容量压力未验。窗口、账号、能力或epoch变化时终止／丢弃晚结果、清私有字节。

选择句柄同时作为永久requestId；确认源包并给当前密码后按原ID建立stage→1MiB分块→提交。每阶段记录已发事实，丢开始／分块／提交响应只能查原ID，不能换ID或把GET404当原请求永不会落库。明确429可paused，用户显式resume时先读原stage，仅补缺块；未知commit永不重发。只有明确begin429且从未未知／成功begin，用户resume、原ID404、当前能力和私包复核均成立时才可同ID再尝试begin。设备120请求／分钟限额不提升，不以模拟快速小包证明530块完整容量。

原ID查询published只返回核验后的原actor回执；active等明确存在后才按用户确认取消。开始未知且GET404不假取消／不DELETE；发布抢在DELETE之前则保留unknown并查原回执，不宣称未发布。保留私包至明确terminal、丢弃、上下文失效或dispose，密码只用于提交且不持久化；不代替客户迁移授权。

## 流式保存与最终发布

导出前须read && export，分别与当前head、来源Q、项目／授权revision和所选版本绑定，native保存对话框只在权利核对后打开。主进程在所选目录用随机独占wx+临时文件接最多64KiB写块，处理短写；网络头、长度和整体SHA均核验，落盘后再按严格storedZIP分段核对成员、CRC／SHA、canonical JSON、原件引用／MIME、记录／冻结及首次来源清单。

网络取消立即cancel body释放服务端名额；文件打开／写入不能假定可取消，须等待本地操作收敛再清理，不提前清零仍在写的buffer或漏掉迟到handle。磁盘写失败以本地错误返回，不误把已连接业务标成断网。窗口／账号／view变化或明确取消不继续发布。

记录打开句柄及临时路径dev/ino/长度，关闭后重核路径；文件准备完成后再在线复核双权和固定head，随后rename。最终重新打开实际目标，核其inode／长度与分段完整SHA及stat稳定后才报告saved，不能把替代物当已验底稿。路径替换不自动删除他人文件；rename已成功但回执丢失、最终目标变化或无法核实均报告unknown，编号不自动复用／重写。已发布后撤权不能收回此前合法保存的字节，不能承诺OS其他进程永远无法篡改文件。清理仅处理仍匹配本次inode的临时文件，失败明确提示本次临时名。

## 验证、发现与交接

固定Node24相关门62文件1100/1100通过，零失败／跳过／取消／todo，848.765秒；1252候选文件运行前后raw一致，TAP连续编号／plan／footer及exit0核对。包括本轮129例（API24、实际main-client4、迁入26、transport13、落盘51、发布11）及前项服务端／实际Chrome原表解析、旧client／设备／账表／来源／资料导出／受信HTTPS／135-RPC兼容；不是完整严格门或正常底稿UI／真实OS对话框验收。证据根D:/codex-temp/shenyi-workpaper-desktop-client-20261117/。

关键代码由其他作者独立复核：API31/31（158范围文件）、迁入与Worker28/28（187）、导出／落盘79/79＋4/4（619）。root已核28／49／29工件、原始TAP／命令exit及当前直接文件与范围哈希。发现的4项P2均修复并按原事实复验关闭，旧失败／BUG复现保留；作者自身代码未自验成独审。范围不扩大为正常IPC/UI、OS原生、Mac、最大容量、M4P整体、完整M4Q或Goal。

独审发现并修复：表单假未冻状态缺少原record交叉绑定；最终关闭文件后的替换／撤权窗口；取消后迟到open可能漏清理。原复现与失败日志保持，新验证分别留原始TAP、字节与文件事实，未为通过削弱规则。另两份新测试helper改为env／OS temp可配，断言与产品标准不变，作者旧证据及原件保留。

本地分支codex/workpaper-access，基线f6009287c05e339fc6837f4adba9a607bd6f3a7d；没有新schema／服务端业务路由或正常底稿RPC/UI。旧135个RPC兼容性另验。未打开／升级真实共享库，本轮一键未重验，未push／进入main／上线。下一步接正常底稿IPC、权限与来源／历史／原表／填写回执／导出交互，再做相应完整严格门、Win/Mac原生及负责人业务验收；M4P整体独审和其他商业化里程碑仍保留，Goal active。
