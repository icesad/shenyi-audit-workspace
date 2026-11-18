# 审易 GOAL · 团队商业化接续版

## 2026-11-18 M5G 本地候选

M5G 基于 `12495e1` 完成下一年度席位的合成续费候选。默认取原期限结束前一毫秒的已购容量，本团队技术管理员可调整。减席前先释放足够的现有承诺，建单与兑现均检查，付款后的并发占位冲突进入待核对状态。原子提交新增年期和选定容量，触发故障时只保留可信收款记录。22份完整相关测试 259/259，零失败或跳过，1354个候选文件前后哈希一致。首轮258/259，唯一失败为旧年单按前缀计数误将三条新增触发器算入。改用精确校验旧层定义的测试助手后重跑，业务源码未改。独立本机HTTP证据在 `D:/codex-temp/shenyi-annual-seats-20261118/review/`。合成总价为团队年费加席位年单价乘所选数量，正式价格、商户退款、桌面购买仍待接入。未进入main、未推送、未重验一键、未上线，旧预览保留，Goal继续。 [年度续费合同](docs/ANNUAL_SEAT_RENEWAL_CONTRACT.md)。

## 2026-11-18 M5F 本地候选

M5F 基于 `4814242` 完成服务器合成席位增购候选。技术管理员锁定人数、精确剩余时长折算的整单金额和原到期日。可信收款先持久化，之后原子发布一份容量记录。重复通知与跨续费复用交易号不会重复授席，逾期收款留下可查事实供处理。19份完整相关测试 234/234，退出码0，零失败、跳过、取消或待办，1348个候选文件哈希前后一致。独立本机HTTP及其他证据见 `D:/codex-temp/shenyi-seat-orders-20261118/`。采用用户确认的按精确剩余时间折算并整单向上取整到分，候选分母为报价时点起一个北京时间自然年，最长报价15分钟，合成价格不作正式标价。实际退款、年度席位续转、桌面购买、商户接入还待完成。未进入main、未推送、未重验一键、未上线，旧预览均保留，Goal继续。 [增购订单合同](docs/SEAT_ADDITION_ORDER_CONTRACT.md)。

## 2026-11-18 M5E 本地候选

M5E 基于 `3d3d169` 实现三类员工邀请发出即预留、激活转换、撤回或到期释放。服务端在写事务内检查容量，技术管理员首次兼任占一席，且可查本团队席位汇总。20份完整相关测试 502/502，19份484项和单独补跑的1份18项均通过，无失败或跳过。首门502项测试退出0，绑定脚本因1份测试开跑后改动退出1。保留原始结果，补跑固定1341个候选文件，只替换该份证据。独立本机HTTP证据在 `D:/codex-temp/shenyi-seat-reservations-20261118/review/`。初版无 rowid 导致六条旧快照测试失败，保留 rowid 后通过。当前使用合成容量，增购折算、年单容量续转、桌面购买及生产支付待接。未进入 main、未推送、未重验一键、未上线。旧两预览保留，M5与完整Goal继续。 [席位预留合同](docs/INVITATION_SEAT_CAPACITY_CONTRACT.md)。

## 2026-11-18 最新：M5D实现与验收

`codex/annual-order-simulation`从`d88e809`接续，本地M5D候选已验。实现本团队技术管理员服务端锁价年单、北京自然年、独立HMAC合成来源、先持久验真事实再同事务发布订阅及兑现回执、主动查单和重启幂等补偿；默认关闭，启用须严格device＋team-management-v1，不授审计资料。固定Node24的40完整相关文件1005/1005、0fail/skip/cancel/todo、exit0、799.344秒；fresh 1332候选覆盖全部selection，before/after字节同。作者日历/网关/store/API及schema项含于根门，不累加。独审首轮两个有界场景32真实TCP、23运行时设备验签及23真实KDF，实际末fulfil插入故障保留inbox/回滚term，close/reopen后confirmedAt保持；43B合成采集原件和原项目grant保持，不外推全部历史底稿/GUI/Mac/HTTPS/商户。原API夹具两FAIL、gateway Proxy两RED、schema原3FAIL均保留；未弱化测试或KDF。schema89表/355显式DDL，旧86/346与原11表peel合同保持。旧预览/共享库/vault保留；未push/进main/重验一键/上线。无生产价格、增席容量/折算、退款或购买UI，M4未全完，M5/Goal active。合同[年单模拟收款](docs/ANNUAL_ORDER_SIMULATION_CONTRACT.md)，证据D:/codex-temp/shenyi-annual-order-simulation-20261118/。

本轮另确认下一片：发出邀请即预留席位；年期内增席与团队原到期日对齐，按剩余期限折算。启用业务人数原计数规则保持，邀请预留另记；仅记录政策，本片不实现容量/增席，也未确定实际价、精确折算公式与舍入。

## 2026-11-18 最新：M5C现有团队管理到期规则候选

`codex/subscription-management-expiry`从`4a5b1ff`接续。可信`team-management-v1`包含原17业务数据写检查及现有16管理写路线的分类：新增独立授权位、潜伏位、失效eligible／维护绑定恢复、普通非空职级赋予、邀请／激活和新任务收件人须active；纯权限子集撤回、管理员role=null、停用、邀请撤回及原安全流程保持。不能按位数净减少、职级名称或read前提掩盖新增raw授权；完整任务集合不使用UI前51名截断。

原身份／目标／参数／no-op／CAS在先，真实KDF、发送等待和实际最后写SQL后重核，末端失效事务回滚。资料密码格式原400顺序的真实RED已用原password()前置修复，未弱化断言或KDF。作者首次source导出误用与authorizer关闭顺序的夹具失败均保留，最终作者A24／B84／根23含于统一门，不累加。没有新增schema或专业规则。

固定Node24的32份完整相关文件1053/1053，0fail／skip／cancel／todo、exit0，827.813秒；fresh 1320候选覆盖全部actual selected，before／after同。独立仅首次两有界场景及物理核对另见review/final-review.json，不外推全16路实TCP、GUI、DPAPI、TLS或生产；原旧5005／676各为历史阶段证据。

新团队审核／首纯技术管理员的原4写＋1preview保持，不设置购买先后、业务资料或财务特权。旧预览／sharedDB／vault保留，仅metadata／公开methods核对；没有push／main／一键重验／上线。M4仍待决策及验收，M5／完整Goal继续active。

本轮用户另已确认下一片订单政策：本团队技术管理员可看金额、创建续费／增购席位订单，不授审计资料；未到期从原到期顺延、过期从可信收款确认起算，按北京时间自然年，2月29对应次年2月28同一时刻。只记录决定，本片未实现订单／自然年算法／支付／续费界面；价格、席位容量与折算、退款和购买入口位置仍未决定。下一片接桌面状态／订单续费与可信模拟支付。见[M5C合同](docs/SUBSCRIPTION_MANAGEMENT_EXPIRY_CONTRACT.md)、[订阅决策](docs/SUBSCRIPTION_SEAT_DECISION.md)和`D:/codex-temp/shenyi-subscription-management-expiry-20261118/`。以下保留历史范围。

## 2026-11-18 最新：M5B现有业务数据到期控制候选

`codex/subscription-business-expiry`从`9e47d9a`接续，新增可信`business-data-v1`且仍须严格设备证明。现有17个业务写路由接入：工作区／任务创建、采集提交／退回、正式立项／旧项目迁入、资料／账表／底稿首次导入及分片提交、资料核对／关门／重开／原件维护、底稿版本填写。保留原角色／团队／项目／模块／资源授权，在异步工作后及事务末重验权益和到期，末端失效回滚业务记录。没有新增专业规则或SQL schema。

固定Node24的26份完整相关测试676/676通过，0失败／跳过／取消／todo，exit0、709.797秒。fresh候选1314文件覆盖全部实际selected，before／after字节相同；作者A20、B45和根配置4包含于本门，不累加。独审实际HTTP、时序与原件检查另见证据目录review/final-review.json：三次TCP原run的FAIL均保留，第三run已完成101请求／48运行时验签及业务步骤，仅最后对象原型断言失败；独立39项只读物理核准后另首次timing-only通过，不重演HTTP、不称原run单轮全绿或17路全部实TCP验。旧5005基线不是本片新代码的完整unit或原生验收。

首统一门676项中675pass／1fail：历史69表／209结构重建仍留M5A空层的4结构，实得213。只在该旧test显式调用既有严格peel／restore并剔其已验证空层两键；旧69／209／73／252和全部业务断言、11表helper契约保持，产品代码不改。原FAIL／1314源绑定与字节逆证据保留，第二统一门不覆盖首轮。

查阅、原权导出、历史原件／回执和临时上传取消保持；取消不删除已发布资料。两旧预览／共享DB／vault保留，仅元数据和公开methods核对。没有push／main／一键重验／上线。M4仍待决策及验收，M5与完整Goal继续active。

本轮用户确认到期管理仅允许停用、撤权及原规则下换机／安全处理，邀请／启用／升职／增权须先续费。已写canonical决策，但管理接口／task assignment仍待下一片接线；当前`business-data-v1`不能称全局管理到期控制。桌面状态／主动续费入口、定价容量／年历／退款、订单支付与生产亦未完成。见[M5B合同](docs/SUBSCRIPTION_BUSINESS_EXPIRY_CONTRACT.md)及[订阅决策](docs/SUBSCRIPTION_SEAT_DECISION.md)；证据`D:/codex-temp/shenyi-subscription-business-expiry-20261118/`。以下保留历史范围。

## 2026-11-18 最新：M5A订阅与席位底座候选

`codex/subscription-foundation`从`c21c957`实现可信显式区间事件／head两表、有效业务成员计席及本人状态。纯技术0／获批兼任1，状态不授资料权；严格配置只先接新建采集工作区，body／KDF后和发布事务末重核到期／版本。到期原权历史继续读／导出，其他写出口、年历／价格／容量／退款、续费／支付／桌面界面仍未完成，不能称全局执行。

固定Node24相关12完整文件161/161、0fail／skip／cancel，fresh1308候选覆盖所有selected且before／after同。独立新3完整文件39/39；首真实TCP64请求／28签名通过，第二时序harness修装载顺序后只复验未完成部分，原FAIL保留，不重跑绿场景。首run无before.sqlite，不冒称物理双库；schema86／346保旧84非空typed行／UUID／原件／freeze。此前5005仅旧代码基线，本片未重跑完整unit／browser／原生。

M4转待决策与验收，尚未完成，不开放未确认模块；当前唯一实现M5A，M5整体继续。旧预览／共享库保留，未push／main／一键重验／收款／上线，Goal active。见[范围合同](docs/SUBSCRIPTION_FOUNDATION_CONTRACT.md)、[已确认政策](docs/SUBSCRIPTION_SEAT_DECISION.md)和`D:/codex-temp/shenyi-subscription-foundation-20261118/`。以下保留历史范围。

## 2026-11-18 最新：完整可移植单元严格门通过，订阅政策已确认

`codex/m4-portable-regression`从`5e2e4d1`执行原固定Node24 `scripts/test.mjs --unit --strict`单轮，281完整文件全部5005/5005，0fail／skip／cancel／todo、exit0，2475.797秒。1155运行／测试源门前／门后／current同；原runner、旧测试、工作因子和product无改。独立复核原TAP各层plan／总footer、原进程终态与源绑定，不重跑全量或叠加历史计数。63浏览器整文件按原规则排除，本结果不代表完整browser／原生／生产验收。

即时1155源映射只覆盖279／281所选测试；另外2份quota测试遗漏已披露，以更早独立rawSHA＋Git基点／当前逐byte核同，另有开跑后11秒325项哈希旁证；不补造原1157即时before。见`source-binding-supplement.json`，后续采集须先断言选择集合完备。

用户已确认席位只计启用业务成员、纯技术admin不占席、兼任只一席；到期暂停新增／修改，已授权历史按原权查阅／导出，保留主动续费。[订阅决策](docs/SUBSCRIPTION_SEAT_DECISION.md)及需求7.1已更新，M5仍planned、未实现收费；其他商业细则仍分别确认，不阻断不依赖它们的合成原型。报告原问题待答。

旧预览和共享库保留，仅元数据／公开methods核同；原OS门前提未变不重试，canonical ZIP缺口及共享／一键、Mac、发行／TLS／商户／国内上线仍未通过。未push／main／一键重验／上线，M4／Goal active。证据`D:/codex-temp/shenyi-m4-portable-regression-20261118/`；以下保留历史范围。

## 2026-11-18 最新：账表快照被动数组边界修复

`codex/ledger-passive-arrays`从`63d19d2`修复已记录P3：直接对象create／serialize现在拒绝自定义／null数组原型与Array子类，继承toJSON／getter不得执行；仅1个判断变化，不改格式、算法、限额、权限或正常输入／映射SHA。正常JSON／IndexedDB利用可达性仍未证，不称远程高危。

新增同10断言原码2pass／8fail→修后10/10；五完整相关文件58/58，独立五文件53/53（含原外部3与两真实browser），均0失败／跳过，分别计数不相加。1155源门内同，原1154仅codec改1、新test1，其他1153保持；实际旧端15358B合成快照在新旧codec逐byte及两摘要一致。详见[进度](进度.md)及[快照合同](docs/LEDGER_CHECK_SNAPSHOT_CONTRACT.md)。

原63 browser严格门仍缺固定SHA原始ZIP，当前344＝281＋63只为发现，未跑完整unit／strict；后续补冻结候选全量unit。OS门工具前提未变不重复，两旧预览／共享库按用户决定保留，仅元数据和公开methods核同。报告及M5细则原问题待答；未push／main／一键重验／上线，M4／Goal active，M5 planned。证据`D:/codex-temp/shenyi-ledger-array-prototype-20261118/`。以下保留历史范围。

## 2026-11-18 最新：同库四模块组合隔离回归通过

`codex/cross-module-isolation`从`93d2708`接续M4，新增合成单库W/Q四模块非空组合回归，无产品／旧测试改动。最终v4完整9/9由作者和独审分别通过；先前三版同组绿门的断言盲区已纠正并保留原稿，不累加次数。四种单模块及逐域撤read、公共拒绝和正向／发现投影、原件及既有freeze保持得到有限矩阵证明，不能扩大为所有权限组合。

两实际TCP场景作者及独审各240请求／112验签；各111 GET空body摘要独立复算，1 POST仅已签摘要头。独审4库／8包及4220物理断言通过；6 raw404正文精确，17 wire404头核准，typed404正文未保存。正常main-client＋内存Ed25519／loopback，不代表GUI、DPAPI、TLS；clearSession不称logout。root核49＋58项证据SHA与1154源同（旧1152无改）。runner仅发现343＝280＋63，未跑完整unit／strict。

两旧预览保留，仅元数据和公开methods与前项检查点核同，本轮无CUA或oldDB／vault操作；共享库未升级，既有OS包Open／Save门仍未通过，工具不变不重试。报告授权及新问M5席位／到期细则待答；M5未启动。未push／main／一键重验／上线，M4／Goal active。证据`D:/codex-temp/shenyi-cross-module-isolation-20261118/independent/final-review.json`；以下保留历史范围。

## 2026-11-18 最新：真实OS尝试保全，本关未通过

从`705bcab`接续M4，在全新正常Windows候选中实际选入来源JSON，1945B／SHA及WQ持久一致；随后底稿包原生框控件缓存512失效，重绑后同错，按保护规则停止单次尝试。包Open未完成、Save未到，底稿五表及迁入／导出0，不能声称OS pair通过。exec exit1且外部driver清理末尾disposed报错，root已补核5自有PID／4667关闭及停机只读快照；73项物理断言仅核partial事实，1152源未改。

两旧预览继续保留；工具初错捕旧图已排除，未向old输入／请求激活或读DB／vault。记录器首段PNG缺口与来源UIA／actions、未正常logout分别披露。前提未变不自动重试；未push／main／一键重验／上线，M4／Goal active，报告待原答复。见[实际边界](docs/NATIVE_OS_FILE_DIALOG_ACCEPTANCE.md)及`D:/codex-temp/shenyi-native-os-dialogs-20261118/`。以下保留历史范围。

## 2026-11-18 最新：员工邀请历史分页

`codex/employee-invitation-pagination`从`ad421a0`接续M4，邀请列表可按每页最多50条前后查询；两来源稳定seek、账号／团队游标锚点和逐页权限核验，仍仅掩码、低权限员工定向邀请，无真实SMS。界面当前页／一次性码／关闭重开与context清理、单次创建／撤销已覆盖；跨来源同ID及pending写入切团队问题经审查纠正。

独立13完整文件249/249、零失败／跳过、76695ms；52新项包含于总数。1152源门内raw同；收口仅新API测试EOF去2B、原断言29项复验，最终1151raw同＋1纯格式，旧1149仅5product＋旧expected null共6路径变化；UI有已披露EOL机械变化，非目标raw未宣称同。真实TCP21请求逐项对照／5业务签名带完整query重核，撤权分页404，194实际依赖同、自有服务关闭。均不是原生Win/Mac发行验收；342文件仅runner发现，未跑完整strict。

两旧预览按用户决定保留，root仅进程／窗口／公开methods前后核同，未操作UI／DB／vault或升级共享库。未push／main／原一键重验／上线；报告待原答复，M4及完整Goal active。详见[进度](进度.md)、[分页合同](docs/EMPLOYEE_INVITATION_PAGING_CONTRACT.md)和`D:/codex-temp/shenyi-invitation-pagination-20261118/independent/gate-result.json`。以下保留历史范围。

## 2026-11-18 最新：正常Windows资料回执验收

当前资料回执修复已在全新正常Windows候选首轮standalone exit0实跑：正常账号／DPAPI／创建及来源核验／UI五权，import与add自动fresh后回执10／13字段对真实持久事件一致；commit／add各一次、无回执GET补救。撤read后清正文详情，typed GET404；3原件加55B后4份，历史保持。

257 HTTP／120运行时验签、7库／4图及147物理断言经独审；完整字段由真实DOM＋DB证明，02图仅部分import、03图为原件区。671运行/helper和1149旧源保持，本轮未改产品、未native测其余四动作或故障／race、未重跑113／全量strict。原预览与共享库保留；未push／main／一键重验／上线，M4／Goal active，报告待答。详见[进度](进度.md)及D:/codex-temp/shenyi-native-material-receipt-20261118/independent/final-review.json。以下为历史范围。

## 2026-11-18 最新：资料操作确认回执反馈修复

资料操作已确认成功后，自动刷新不再无意清空回执：fresh同scope、设备与读权／版本稳定才恢复详情；503／429等未知只保完成状态和原编号，硬拒绝／关闭／切换／ABA退役旧反馈。覆盖导入、核对、关门／重开、原件新增／移除，未改专业规则、服务端或手工历史回执语义。

固定Node24独审7完整文件113/113，外部硬拒绝9/9另计；20新增已包含于113，旧码同断言真实10RED保留，初版两测试错误已纠正留证。仅JSDOM，非当前原生或完整strict。1148旧源仅1产品改／1147同，两旧预览及共享库保留；未push／main／上线，M4／Goal active，报告权限待原答复。详见[进度](进度.md)及`D:/codex-temp/shenyi-material-receipt-20261118/independent/final/final-review.json`。以下为历史范围。

## 2026-11-18 最新：正常Windows七块限流续传验收

本轮在`codex/native-seven-chunk-resume`从`d66cedc`接续M4，仅派生仓库外驱动及更新检查点，1148既有运行／测试文件原字节保持。正常desktop main／preload／renderer首轮standalone日志exit0，client、fetch、vault、IPC与界面未替换；只为本次两份合成文件注入dialog路径。6329728B包／7块含6MiB随机原件、有效Office原包和1份既有冻结；预检与实际运行各用独立随机身份，不混用包SHA。

初始9账号／0绑定，正常UI本人验密与同意登记DPAPI、创建工作区、核对来源及分别授本人三权。真实5秒心跳／15秒权限poll下，业务120后首1398191B JSON块429且响应时正文已完整，heartbeat200／poll429；测试服务时钟推进60001ms，本人刷新、重核与验密后按原ID明确续传。7成功PUT(0..6)＋1拒绝，begin1／commit1／head1，同epoch／session／lease、临时块清零。发布后正常UI撤本人三权清正文；typed填写main拒绝WORKPAPER_CHANGED，entries POST0。

root与独审实际核7份SQLite完整性／FK、来源record.json原字节、两BLOB逐byte及SHA、A2／C1和freeze1；发布／撤权／退出三库的5底稿表typed/raw行保持。5个ZIP容器／35成员CRC与4索引成员SHA、冻结snapshotHash独立复算通过。4张PNG已实际查看，无横向溢出。367条真实HTTP监听记录，175签名由运行时观察器实际crypto.verify/assert；redacted日志不保原proof／正文，不声称离线重放或独立正文SHA复算。628运行源before→after→current一致，本轮没有TAP，也未重复旧85门或完整unit／browser严格门。

主驱动／服务Node24.22.1，实际Electron45.3.2内嵌Node24.22.2；main43064与3个Chromium子进程出生profile、真实DPAPI、155API／26表单／31密码清空及七项webPreferences保持。launcher33632单列，结束后launcher＋4Electron及5291监听均实际查无残留。Playwright debug／engine flags（含NetworkServiceSandbox例外）不代表发行环境。原审核与ac503898两预览进程／窗口和公开methods标识保持，不操作其UI／DB／vault，不升级实际共享库。正常桌面入口本轮已实跑；一键cmd、OS Open／Save、Mac、TLS／生产及530MiB仍未验。报告授权待原答复；未push／进入main／上线，M4和完整Goal active。

证据根`D:/codex-temp/shenyi-native-seven-chunk-20261118/`：`root-evidence-audit.json`、`independent/final-review.json`与`author/run-2026-11-17T20-42-21-464Z-97d4e2ef/`；命令、exit、驱动／源、截图／库及清理由原清单绑定。启动前发现并修正的外部清理误报、语法准备旧稿均保留，没有失败GUI运行。以下保留前项记录及其当时范围。

## 2026-11-18 最新：分块拼装与早拒HTTP传输修复

本轮在`codex/workpaper-chunk-assembly`从`9b6c18a`接续M4。服务端提交改为先查块数，再预留一个整包缓冲并按块号迭代复制；缺块在整包分配前拒绝，块号／余长／块摘要、实际复制总长及全包SHA仍逐项检查。原验密、权限／session／lease／来源重核、Worker校验、事务与发布语义保持。6MiB合成原件的7块测试中，SQLite单次返回的块负载最大1MiB，移除旧全量块数组加独立concat的重复；codec仍有全包快照与原件副本，不声称总RSS或530MiB容量已验。

真实大块HTTP另暴露早拒连接问题：旧监听器未收完正文即429并保持连接，随后心跳复用失败；仅加close又使429自身在真实fetch中ECONNRESET。最终仅对错误响应按同一1000ms调度期限、17MiB丢弃阈值读取未消费正文，不聚合／解析／授权，不cancel底层请求，结束时释放reader；阈值可能跨越最后一块。实际发送头时仍未收完整则close，已完整请求保持正常连接复用，成功JSON／流式导出不新增丢弃等待。客户端断网暂停、未知结果与原ID人工续传规则保持。

固定Node24.22.1独立重跑12个完整相关文件85/85，零失败／跳过／取消／todo，1148运行／测试源before→after一致；不是完整338文件或275个粗分unit门。新增拼装11案与HTTP4案包含于85，不重复累加。原拼装预算注入基线10/11、旧监听器早拒1/3、close-only扩展3/4及三次真实7块FAIL均保留；不把预算注入失败称为真实内存耗尽。独立小探针另核Node游标异常释放、实际索引无临时排序、长度校验负向突变及丢弃超时／越阈／锁释放。

最终真实TCP7块另单列1/1通过：6304955B包、6MiB原件、293条client/listener逐条对应；首PUT429后heartbeat200，同epoch／session／lease、原ID明确续传，begin1／commit1／head1，成功7块后临时块清零。运行时逐byte核BLOB、A2填写及C1公式元数据保持；root另复算持久原包3层ZIP／17成员CRC、manifest与record／两原件SHA。此HTTP样例冻结为空，已有冻结保全由独立重跑的拼装／API用例证明。128MiB仅oldgen参数，V8总heap与RSS不在此上限内。

root核1146旧源仅两产品文件变化，其余1144原字节保持，新增两测试。原审核与ac503898两预览进程／窗口及公开methods标识保持，未重载、登录或读取其业务库／vault；实际共享库与两原一键继续保留。当前补丁未做正常Electron／OS、Mac、TLS、最大包或生产验收。报告授权仍待原答复；未push／进入main／上线，M4与完整Goal active。

证据根`D:/codex-temp/shenyi-chunk-assembly-20261118/`：`root-evidence-audit.json`、`independent/transport-review/final-discard/final-review.json`、`author/author-summary.json`及`root-http/run-2026-11-17T20-21-32-426Z-368c5087/`。精确命令、exit、TAP／源及失败工件按各清单绑定。以下保留前项记录及其当时范围。

## 2026-11-18 最新：正常Windows Electron限流续传与发布后撤权验收

本轮在`codex/workpaper-native-resume`从`aa39e9a`接续M4。全新合成候选直接启动现有desktop正常main／preload／renderer，未替换client、fetch、vault、IPC或界面；仅为自有文件选择器注入合成路径。初始9账号／0绑定，正常UI本人验密并首次登记真实DPAPI密钥，随后正常创建工作区、确认立项来源并分别授予本人三权。main／GPU／network／renderer四进程从出生参数即落本候选profile；155API、26表单／31密码及七项webPreferences保持。

首轮完整运行exit0：实际5秒心跳与15秒权限poll下，业务120后chunk429→新的heartbeat200→access429→本次服务时钟推进60001ms并手动刷新→同view重新核验／验密、按原ID明确续传。begin1／commit1／head1、同session／lease；原包record.json、两原件BLOB、A2已保存填写、C1公式只读及1份既有冻结保持。发布后正常UI收回本人三权，正文清除；强制typed填写在main预检拒绝，entries POST0，五底稿表在撤权／退出后保持。此负向不扩大为“暂停中未发布来源的原生撤权”新验收。

355条真实HTTP、4张PNG／7份SQLite经独审与root交叉复核，完整性／FK、原件SHA、5个ZIP层CRC及4索引SHA通过；628运行源before→after→current一致，root另核1146既有运行／测试文件原字节保持。169条签名由运行时观察器实际crypto.verify并assert，独审复核代码与结果；redacted日志未留原签名／正文，不声称离线169重放或独立POST正文SHA复算，正文SHA仍由正常产品gate检查。root已实际查看四图，无水平溢出。本轮没有产品改动，也未重复执行完整unit／browser严格门。

只关闭本次4个Electron进程与7754监听，原审核与ac503898两预览的四进程／两窗口字段保持，公开methods200／设备门保持；未读取其业务库／vault，未升级实际共享库。正常桌面入口已实跑；一键cmd、实际OS Open／Save、Mac、TLS／生产及530MiB最大包仍未验。Playwright加入debug／engine flags（含NetworkServiceSandbox例外），七项正常产品偏好检查不扩大成发行／整机service sandbox验收。未push／进入main／上线；报告授权仍待原答复，M4和完整Goal active。

证据根`D:/codex-temp/shenyi-workpaper-native-resume-20261118/`：`root-evidence-audit.json`、`independent/final-review.json`与`author/run-2026-11-17T19-21-00-503Z/`；精确命令、源码、截图／库和清理按原始工件绑定。以下保留前项记录及其当时范围。

## 2026-11-18 最新：真实HTTP限流、丢响应与底稿续传验收

本轮在`codex/workpaper-http-resume`从`827bdf3`接续M4，仅新增共享合成HTTP fixture与两份回归测试，未改产品、旧测试或专业规则。复用实际loopback监听器、isolatedPreview固定origin／UUID、真实fetch／Ed25519设备证明、SQLite及Worker。客户端登录起的被测流量均经过真实TCP；目录与文件选择路径仍为自有合成注入，renderer为JSDOM，时钟／权限轮询由测试控制。

真实业务桶用满120后分块429，设备connection仍200／ready；权限poll429保留原view与来源，fresh核权一致后重新确认和验密，按原ID人工续传，session／lease保持，begin1／commit1／head1，真实有效XLSX的A2保存文本与C1公式只读通过。真实撤权后旧view／来源退役，程序化提交也不能发布。另在服务端已提交head1、发送响应前关闭本次测试socket：客户端实际进入unknown／paused，重新持钥在线恢复后只GET核实原回执，不重发commit。control第25次429仍暂停并清私有续传来源，远端stage保持未发布。

两份新增完整文件5/5及四份原HTTP／transport完整文件35/35通过，零失败／跳过／取消；独立审查者重新执行新增5项并逐请求交叉复核client与listener、固定URL／UUID、真实socket关闭和清理工件。1143份既有运行／测试文件raw保持，独审自身1060文件清单前后同；新增fixture／测试另计，不混作同一来源清单。作者首轮的数据库终态名误期望，以及fetch拒绝早于socket close通知的观察时序错误均保留，分别按现有published语义、等待特定真实close事件修正；没有产品修补或降低断言。

新增测试服务仅监听各自系统分配的loopback端口，均已关闭；两个既有预览不重载、不登录、不读业务库／vault。本轮未重验一键或正常Electron／OS对话框，不代表TLS、Mac、530MiB最大包、完整unit／browser严格门或生产验收。未push／进入main／上线；报告授权仍待原答复，M4和完整Goal active，其余用户保留项与专业决定保持。证据根`D:/codex-temp/shenyi-workpaper-http-resume-20261118/`，实际命令、计数、源码与逐请求工件以`root-evidence-audit.json`及`independent/`最终报告为准。

以下保留前项记录及其当时范围。

## 2026-11-18 最新：业务限流下的设备在线证明与底稿续传

`codex/device-heartbeat-quota`从`4c29272`接续M4。业务请求用满120/分钟时曾同时拒绝设备心跳，导致设备暂停／来源清除；另有权限poll的429清除renderer来源，下一次轮询又关闭main来源。现仅规范GET connection使用本人独立24/分钟控制桶，业务120、签名／新鲜租约／nonce重放与2048总上限保持；不把429当在线证明，不改stage的原session／lease绑定。

明确poll429时隐藏正文／源摘要／成员／回执正文并清密码和确认，保留同view的opaque来源及原编号。未知态阻断业务IPC；fresh项目／grant修订及六能力一致，再重读head与资料，完成后由本人重新确认和验密显式续传。真实拒绝／非法响应／能力或上下文变化退役旧view，不自动POST。独审追加发现恢复途中提前显示正文及取消IPC例外过宽，两项已窄修并原点复验。

最终原有10完整文件229/229，新2完整文件27/27（12服务端＋15UI），零失败／跳过／取消；1143 tracked运行／测试源before→after→current raw一致。固定外部独审13/13，原UI5个失败及第一候选新增2个失败均保留。实际HTML／JSDOM→真实bridge／签名client／strict gate／SQLite／Worker三组合成闭环3/3：heartbeat、no-heartbeat、有效XLSX均按原ID人工续传、同session／lease、begin1／commit1／head1；有效原表A2保存文本与C1公式只读通过。两组最小fixture原件的后续form422单列为限制，原提交终态不变；有效XLSX组无422。不是网络监听HTTP、正常Electron／OS、530MiB最大包或完整unit／browser严格门。

两份保留预览进程／窗口仍响应、公开methods200且设备门开启；本轮不关闭、重载、登录或查询其业务库／vault，旧窗口未加载本次修复。实际共享升级与两原一键继续依用户决定保留，本轮新候选一键也未重跑。未push／进入main／上线；报告授权仍待原问题答复，不擅自开放。M4／完整Goal active，原始ZIP／OS／Mac／发行／供应商／支付／官网及M5—M8和专业决定仍保留。

证据根`D:/codex-temp/shenyi-device-heartbeat-quota-20261118/`：`root-evidence-audit.json`、`root-new-final.tap`、`related-gate/final-candidate2/`；独审及三组闭环见`D:/codex-temp/shenyi-native-readiness-20261118/design-review/final-review.json`与`capacity-preflight/ui-real-client-candidate2-final-with-office.tap`。范围合同见[设备会话合同](docs/DESKTOP_DEVICE_SESSION_CONTRACT.md)与[底稿界面合同](docs/WORKPAPER_UI_CONTRACT.md)。

以下保留前项记录及其当时范围。

## 2026-11-18 最新：合成团队库离线备份／恢复演练

`codex/team-offline-backup`从`45e5f9b`接续M4，新增[离线备份与恢复工具](docs/TEAM_OFFLINE_BACKUP.md)。指定只读合成源、新UUID备份／恢复目录、完整schema与全表typed摘要／原件哈希和最终独占发布已实现，真实CLI三流程已验；没有增加在线恢复、业务数据权限或专业动作。

最终两完整文件26/26、零失败／跳过，1036相关源前后保持；4套非空业务的12库经root Python只读交叉核验，独立9项证据审计通过。标量UUID、失败发布、最终目标变更与WAL副本附档问题均有原失败及修后复验。备份含历史凭据及权限且未加密，只供离线核验，不能直接当生产恢复；Mac／ACL／加密／可信撤销重放与正式切换另验。

旧审核与新候选预览保留，实际共享库未读／未升级；本轮桌面入口未重跑，相关源码保持。未push／合入main／上线，M4和完整Goal active。下一报告授权已询问、尚待答复，其他外部与专业关卡继续保留。证据根`D:/codex-temp/shenyi-team-backup-20261118/`，完整范围见根目录进度。

以下保留前项范围。


## 2026-11-18 最新：旧预览保留，独立候选入口已验

`codex/isolated-team-preview`从`3694916`接续，新增[独立合成候选入口](docs/ISOLATED_CANDIDATE_PREVIEW.md)。新cmd已实跑并保留“ac503898”登录窗口；旧审核窗口／实际共享库／旧vault不迁移、不关闭，两原cmd未重验。每次全新数据与设备密钥，不自动续用。原生早期缓存串默认目录及隐藏窗口的首轮失败保留，修后以受控CLI从进程出生隔离，实际main／GPU／network／renderer均落新目录。

相关6文件79/79、零跳过，1030相关文件前后一致；既有client／设备／HTTPS／配置125/125是另一命令。修复后正常Windows8阶段／2图、真实DPAPI、27条GET验签、并存／单实例及坏配置／错CLI拒绝通过；627运行依赖保持。原生第二实例本候选cache拒绝警告保留。独立复核13项通过，详见根目录进度及仓库外`D:/codex-temp/shenyi-isolated-preview-20261118/`。

main未合入、远程未推送、线上未发布；新一键可达，原两一键未重验。M4及完整Goal保持active。完整unit／原始ZIP严格门、OS Open/Save、Mac、安装更新、真实供应商／客户／支付与M5—M8均不据此宣称完成。

以下保留前项记录及其当时范围。


## 2026-11-18 最新：M4P修复与新候选验收

本轮在`codex/workpaper-access`、`f2b81399bed38b93df2aed039a142daa5d191bdb`之后补M4P只读纵向独审及M4Q桌面验收。两项P2已修并独立复验关闭：只停留历史列表也按15秒复核权限并清失效元数据；已获有效导入／查询回执后，后续刷新失败仍在可见提示保留已确认版本和原操作编号，权限未知时隐藏历史、正文及查询控件，不重发POST。另修稳定无查阅权但有授权管理权的负责人被轮询清空未提交表单的问题；权限稳定时保留输入，真正撤权仍清理。只改账表UI与新增回归文件，不改codec／服务端／旧断言／专业规则。

最初16项新回归在旧UI上1通过／15失败；后补第17项稳定负责人场景，最终三个完整UI相关文件31/31、零失败／跳过。独立冻结v1复放实证表单丢失（2项中1失败），最终同组2/2；原UI负向7/7、回执／撤权／旧账号补证7/7、原字节纵向贯通1/1。原综合探针仍2通过／1失败，唯一失败为P3非标准数组原型继承toJSON；正常JSON／IndexedDB／structuredClone来源尚无可达证据，保留原失败和分级，codec未改，不报全部探针通过。

当前原runner清单326文件＝263单元＋63浏览器补集。最终63完整文件串行重跑339项：338通过／0失败／1跳过，321.532秒；Node child exit0、严格判定exit1。唯一跳过为固定SHA结论原始ZIP未定位，原包路径已询问，不替代原包、不称strict通过。已在D盘安装锁定Playwright1.62.1配套Chromium，并使用原生实际保存的合成资料v2包复验。首轮316通过／9环境失败／7跳过保留。前项4756项完整单元门仅属基线；本轮相关31项已重跑，不写成当前326文件单次命令或当前完整单元门通过。

最终候选Windows正常Electron合成闭环重新完整执行10场景／18图、exit0，实际strict loopbackHTTP／DPAPI／SQLite，623运行文件保持，原件／填写／冻结／退出清理通过。另一agent完成该最终候选独审：12项原始交叉核对、18/18图、14/14新探针；root复核原始工件、1266源码／TAP、6库完整性、ZIP原件／冻结和SQLite版本。原driver首次最终轮因实际宽1035而非1280失败，完整失败保留；自有19样本／6次目标均可达但未重现1035，原因不作已证断言。外部driver仅增加最多3000ms等待精确目标尺寸及诊断，去除插入可逐字恢复原脚本，所有原业务／尺寸／overflow断言和其他4驱动原字节保持，随后从头完整重验；不拼接旧5项PASS。Open／Save路径仍为明确注入，不冒充实际OS选件。

真实OS补验未得到独立可定位的弹窗句柄，焦点与画面冲突后未点击／按键／输入路径；隔离driver超时后已关闭自己的窗口，heads／versions为0且无导出。原审核预览未动，也未推断其中无未保存内容。用户已明确选择“保留旧预览，继续其他开发和验收”：本轮不关闭旧预览、不升级实际共享库、不重验两原一键；共享库仅有前项只读备份和隔离副本升级预演，后续须遵守此保留决定，不重复请求关闭。

证据根：`D:/codex-temp/shenyi-workpaper-acceptance-20261117/`；root汇总`root-evidence-audit.json`，浏览器`browser-strict-final/report.json`，M4P独审`independent-ledger/final-recheck/review.md`，最终Windows独审`independent-native-final-owner-poll/independent-review.json`。未push／进入main／上线，原一键未重验；M4和完整Goal保持active。余项为授权原包严格门、可靠OS Open／Save、依用户决定保留的共享库与两原一键，以及其他M4模块；Mac、安装更新、真实客户／供应商／支付／生产和后续M5—M8尚未完成，专业运行／复核／新冻结／重开依用户和米老师决定。

以下为前项阶段记录，保留其当时范围。

## 2026-11-17 最新：正常底稿桌面入口

M4Q正常底稿桌面候选已接入：旧135接口保持、尾部追加20窄IPC；负责人验密分别配置查阅／填写／导出，完整包显式首次迁入，原表／历史版本、CAS填写保存、原编号回执及所选版本原生导出进入正常页面。实习生／助理入口隐藏且直调拒绝；账号／设备／项目或失权清除旧内容，未知操作不盲重发。

Node24完整可移植单元严格复验262文件4756/4756通过，0失败／跳过／取消／todo，1190.891秒；1264候选文件运行期间raw一致，TAP编号／plan／footer和exit0已核。按原脚本--unit发现集合，粗排除63整文件，不称完整browser strict。原串行4732项中的辅助层清单遗漏、随后4750项中的文件晚改校验盲区均已修，原失败保留；最终按相同260文件＋新增回归2文件重新执行，2并发，未改原runner／旧测试断言或工作因子。证据根D:/codex-temp/shenyi-workpaper-ui-20261117/。

真实Chrome作者28项／8图、Windows正常Electron合成闭环另行记录；严格签名HTTP／DPAPI／SQLite、155 API／channel、26表单／31密码框及退出清理均分层验证。Chrome native geometry为明确受控视图，不冒充真实catalog；Windows注入文件选择路径，不冒充实际OS文件对话框操作。deadline／IPC／UI／兼容层、schema剥层及持久内容复核分别独审，已确证问题的原失败、修复与关闭证据已由root按原始TAP／manifest／当前源码复核。

实际共享库仅作只读备份与隔离副本预演，尚未升级，本轮原一键未重验；未push／进入main／上线。M4和完整Goal active。下一步补完整browser strict、最新Windows原生独立复核、实际OS选件／保存、实际共享库升级保全及两原一键重验、M4P整体独审与其余M4模块；Mac、安装更新、最大容量及真实供应商／客户／生产仍未验，专业复核／新冻结／重开仍待米老师。见[正常底稿桌面合同](docs/WORKPAPER_UI_CONTRACT.md)。

以下记录保留其历史阶段范围。

## 2026-11-17 最新：桌面主进程与私有文件流程

M4Q已接桌面主进程typed client及私有文件工作流：设备签名／server UUID／窄响应门、完整包native picker与Worker核验、同ID分块迁入／显式续传／未知结果原回执；read && export下流式临时落盘、ZIP实际CRC／SHA／冻结绑定、最终核权及实际发布目标复核。真实createTeamClient到严格服务端的迁入／原表／填写CAS／回执／导出已测，但尚未注册正常底稿IPC与UI。

固定Node24相关门62文件1100/1100通过，零失败／跳过／取消／todo，848.765秒；1252候选文件运行前后raw一致，TAP连续编号／plan／footer及exit0核对。包括本轮129例（API24、实际main-client4、迁入26、transport13、落盘51、发布11）及前项服务端／实际Chrome原表解析、旧client／设备／账表／来源／资料导出／受信HTTPS／135-RPC兼容；不是完整严格门或正常底稿UI／真实OS对话框验收。证据根D:/codex-temp/shenyi-workpaper-desktop-client-20261117/。

关键代码由其他作者独立复核：API31/31（158范围文件）、迁入与Worker28/28（187）、导出／落盘79/79＋4/4（619）。root已核28／49／29工件、原始TAP／命令exit及当前直接文件与范围哈希。发现的4项P2均修复并按原事实复验关闭，旧失败／BUG复现保留；作者自身代码未自验成独审。范围不扩大为正常IPC/UI、OS原生、Mac、最大容量、M4P整体、完整M4Q或Goal。

实际共享库未打开／升级，本轮一键未重验；未push／进入main／上线。下一步接正常底稿IPC、页面权限／来源／版本原表／填写与回执／导出，再做完整严格门、相应原生与剩余独审。M4和完整Goal active，专业复核／新冻结／重开仍待米老师。见[桌面主进程合同](docs/WORKPAPER_DESKTOP_CONTRACT.md)。

以下历史记录保留各自阶段范围，当前状态以上述为准。

## 2026-11-17 最新：团队导出服务端及有界独审

M4Q服务端已接read && export固定已保存版本的独立团队ZIP导出，保留该版本填写、逐引用MIME、原件、既有冻结和首次迁入清单／SHA。预检与传输中复核权限、租约、来源和head，失败中断，不替换版本。只包含所选版本，不支持团队包再迁入或完整历史恢复。正常桌面导入／原表／保存／回执／导出发布仍待接入。

固定Node24相关门47文件828/828通过，零失败／跳过／取消／todo，642.016秒；1234候选文件运行前后raw一致，连续TAP／plan／footer与exit0核对。包含本轮24例、原HTTP及前序权限／迁入／原表／实际Chrome四型解析／填写／设备／schema兼容；不是完整严格门或正常桌面／原生验收。证据根D:/codex-temp/shenyi-workpaper-export-20261117/。

本轮导出及新增路由／HTTP流式转发已由独立agent有界验收，原24例及额外探针和真实TCP／Python ZIP核验分别记录，root已核对原始证据与当前文件哈希，未解已确证P1/P2为0。前序基础授权／完整包迁入／Office准入也已补独审：146/146、实际Chrome9/9、额外3/3，原TAP与36证据文件／22直接源绑定均已核对；原填写独审仍保留其59/59＋Chrome14/14范围。不得扩大为M4P整体、正常桌面、完整M4Q或Goal验收。

实际共享库未打开／升级，本轮一键未重验；未push／进入main／上线。M4与完整Goal继续active，后续完成正常桌面、相应原生／完整严格门和剩余独审；专业复核／新冻结／重开仍待米老师明确。详见[团队导出合同](docs/WORKPAPER_EXPORT_CONTRACT.md)。

以下历史阶段记录保留其当时范围，当前状态以上述为准。

## 当前：M4Q填写服务端已验，团队导出及桌面待续

M4Q已接入服务端原件准入后的填写CAS：当前read && write、active项目、设备签名／单会话租约，正文前固定授权／来源和head stamp，线程后及提交内重查。只改准入的answers／docAnswers叶值及原人工修订来源标记，原件、原Q、索引、旧历史和冻结保持；允许未冻结的其他工作表继续按权填写。已授权非负责人也可保存，owner本身不补授两权，不能跳过首次核验迁入。

head条件更新和一条不可变entries版本在同一事务完成，精确两笔业务写入；例如version1／record.rev7→version2／record.rev8。永久操作ID、本人原回执、未知响应不重发POST；无变化、超限、旧／预测未来版本、撤权／ABA／重登录、并发及COMMIT故障均不得留下部分结果。原冻结校验器使用经本项目实际字节／SHA证明的元信息视图适配存储引用，不能用该视图读取或导出二进制，原Governance标准不改。

固定Node24按41文件最终798/798通过，0失败／跳过／取消／todo，583.859秒；1227候选源before／after raw一致，连续TAP／plan／footer及exit0核对。四类实际原件、独立双权、冻结及独立可写范围、原型键、32MiB输出边界、原件／旧版本／人工来源及故障回滚包含在内；旧原表／实际Chrome四型解析对照、导入／授权／来源／账表／角色／成员／设备／schema兼容同时执行。不是完整严格门、真实跨进程／TCP、正常桌面或原生验收。本次填写保存链路已完成独立安全／数据复核，范围及自行执行证据以独立报告为准，前序未独审范围不自动通过。

证据根 `D:/codex-temp/shenyi-workpaper-cas-20261117/`，见[填写CAS与历史版本](docs/WORKPAPER_ENTRIES_CONTRACT.md)。实际共享库未打开／升级，一键未针对本轮重验；没有新schema／全局体积扩容，dist／desktop／shared产品源保持。未push／进入main／上线，M4和完整Goal继续active。后续接团队read && export及正常桌面保存／回执交互，再完成相应原生、完整严格门和剩余独审；专业复核／新冻结／重开仍待米老师明确。

以下历史记录保留各自阶段范围，当前状态以上述检查点为准。

## 当前：M4Q原表查阅与字段保护已验，填写CAS／导出／桌面待续

M4Q已新增原表解析、字段准入与独立read查阅服务端候选。按项目／版本核对原包、实际内层路径及Office SHA；XLSX／XLS复用现有引擎和原版式，保护公式、链接、数组、隐藏行列／页、合并锚点及冻结；Word复用完整旧Office读取和原段落／表格模型。字段来自原件，不把进度统计清单误当编辑权限，原件和保存记录不写回。

固定Node24按36个相关文件，最终756/756通过，0失败／跳过／取消／todo，483.969秒；1217候选文件before／after raw一致，连续TAP、plan及footer／exit0核对。原完整包导入、三权／来源／账表／项目／职级／成员／设备／schema兼容同时执行；新检查覆盖实际线程完成点撤权／重登录／正常释放对照、伪造index、补充原件、冻结与只读额外写回滚。

真实Chrome与Node对同字节合成XLSX、含实际BIFF公式／数组／隐藏行记录的XLS、DOCX及旧DOC进行对照，原值／Word模型及字段ID一致，原文件SHA保持、无pageerror／远程请求。此为解析器对照，未代替正常桌面、TCP/TLS、原生或真实业务模板验收。证据根 `D:/codex-temp/shenyi-workpaper-entries-20261117/`，见[原表解析与字段合同](docs/WORKPAPER_FORM_CONTRACT.md)。

本轮只增加按权GET原表接口，没有新schema／全局请求体扩容或专业规则动作。实际共享库未打开／升级，一键入口未针对本轮重验；未push／进入main／上线。根检查与完整严格门、独审分别记录；独立agent仍受已知额度限制待补，不以root代替。M4／完整Goal继续active；下一步使用现有服务端字段准入接read && write下填写CAS和不可变追加版本／原编号回执，再接团队导出及正常桌面。

以下历史检查点保留各自阶段范围，当前状态以上述记录为准。

## 当前：M4Q首次团队导入已验，原表填写／导出及桌面待续

M4Q完整底稿包首次团队导入、不可变版本1、按权查阅记录／原件／历史与本人原回执已接服务端候选。首次导入须已有W→Q或已审核旧Q来源、owner及明确read && write，负责人核验来源并验证当前密码；正文、KDF、实际摘要与提交期间重新核验当前授权／来源／租约。取消不能回滚已发布版本，未知响应只查原编号；原ZIP、保存rev与既有冻结快照保持。

固定Node24按27个相关文件，最终683/683通过、0失败／跳过／取消／todo，434.219秒；1203候选文件before／after raw一致，连续TAP、plan及footer／exit0已核对。旧授权／来源／账表／项目／成员／职级／设备兼容同时执行。隔离库新增5表／17触发器／1索引（23定义）至84表／342定义，原79表／319定义全部typed行（含auth）与UUID保留；异常／非空新层禁止历史投影，3份旧测试适配逐byte逆变换通过。

此前Chrome正常旧index实际下载的5984字节合成包，按原SHA经已审核旧Q迁入，在真实签名Request应用边界逐byte读回原JSON和2份原件，保留rev7／1份冻结快照，只有1个发布版本、临时块清空，旧资源typed行保持。另测实际超过1MiB两块包、逻辑2×530MiB预留及第三份拒绝；不称最大容量压力验收。证据根 `D:/codex-temp/shenyi-workpaper-data-20261117/`，详见[首次导入与版本合同](docs/WORKPAPER_DATA_CONTRACT.md)。

本阶段仍是root相关检查，不是完整原严格门、TCP/TLS、正常桌面、Windows原生或独立验收。实际共享库未打开／升级，一键入口未针对新增数据层重验；未push／进入main／上线。独立复核受既有额度限制待补，不以root代替；M4与整个Goal继续active。下一步接原表可编辑字段与公式／链接／隐藏／只读保护，再做填写CAS、团队导出和正常桌面；专业复核／冻结／重开仍待米老师明确。

以下历史记录保留各自阶段范围，当前状态以上述检查点为准。

## 当前单项：M4Q底稿团队接入（旧端完整包导出已测，整体进行中）

M4Q完整项目底稿包及旧版显式导出已接候选：保留原 ZIP、已保存填写、补充底稿原件及既有冻结快照，按底稿白名单排除报价／合同／发票／报告／账表等模块；旧版正常底稿页提供“导出已保存完整底稿包”。原冻结校验沿用，保存版本、原件字节／MIME和原项目Q保持，试用保留UUID明确拒绝。团队端首次导入、实际原表查阅／填写CAS／导出与正常桌面仍待接入；不以旧端导出代替完整M4Q完成。

固定Node24按18个相关文件，最终320/320通过、0失败／跳过／取消／todo，43.015秒；1189候选文件before／after raw一致。真实Chrome旧正常index实际下载，并由Node和Chrome双向读回；逐库typed行／结构及全部Blob哈希保持，1次下载／1次URL创建释放、0业务写入／计算。1280×900和900×900均已复看，最终图与早先已看图逐byte同SHA，无横向溢出；来源同rev填写／编号／立项变化和页面失效拒绝发布，独立试用按钮禁用。上述为root相关门，不是完整严格门、Windows原生或独立验收。

前项M4P及本项授权基础的独审仍待额度条件恢复，不因root通过改判。包层没有新增HTTP／schema／IPC，实际共享库未打开／升级；团队一键入口未针对本轮重验。未push／进入main／上线，M4及完整Goal继续active。详见[完整底稿包合同](docs/WORKPAPER_PACKAGE_CONTRACT.md)；证据 `D:/codex-temp/shenyi-workpaper-package-20261117/related-final/related-report.json`。

下列授权基础记录保留原检查范围；最新完整包进度以上述合同和证据为准。

M4Q底稿团队接入进行中。用户已确认负责人验密后，分别为自己或本项目经理／合伙人配置查阅、填写、导出，填写／导出须同时有查阅；完整项目底稿包由旧端显式导出，负责人核验原ZIP、已保存填写及冻结快照并验密后首次导入，后续团队内版本保存。服务端授权基础已实现并通过root相关507/507门（0失败／跳过／取消／todo，353.500秒），1181候选源在测试期间raw保持；不是完整严格门／原生或独立验收。实际底稿包、读取／填写CAS／导出及正常桌面尚待接入，专业复核／冻结／重开规则仍待米老师明确。详见[底稿授权合同](docs/WORKPAPER_ACCESS_CONTRACT.md)和[用户决定](docs/WORKPAPER_ACCESS_DECISION.md)。

当前分支 `codex/workpaper-access`，base `af0c942d53520bcf6ad36dddc8eb723fb65fc4e0`；前项M4P仍待独立复核，未被标为完成。只在隔离库验证79表／319定义及旧77表／290定义保全；未触碰实际共享库，本轮新增授权未做原生一键重验。未push／进入main／上线，M4和完整Goal仍active。

以下保留M4P原候选证据与待独审事项，不代表当前分支新增授权已完成整体底稿接入。

2026-11-17用户决定：首版暂不开放产品负责人等最高审核账号的密码找回及换机恢复，具体线下处理规则后续另定；现有普通流程继续拒绝这些身份。不再把该能力作为首版待实现项；员工和团队管理员的已确认恢复／换机规则沿用。详见[首版范围决定](docs/PRIVILEGED_ACCOUNT_RECOVERY_DECISION.md)。

更新：2026-11-17。当前用户已授权整理并建立持续推进的团队商业化Goal；以下新增范围优先于旧轮次的范围描述，既有审计业务规则继续保留。

## 前项：M4P账表校验只读接入（Windows本地候选root已验，独立复核待补）

M4P账表校验只读接入进行中：用户已确认先只开放查阅，运行以后再定；旧版显式导出快照，由项目负责人核验并验证当前密码后导入团队，只供查阅，不写底稿。账表快照已接正常团队页面和12项窄IPC，提供独立项目列表、明确读权、来源核验导入、历史只读展示及本人原回执查询。当前正常界面、Windows原生、986项定向、4324项完整可移植单元严格门、旧8组原生兼容及两原一键／共享数据保全均通过root检查；独立复核仍待完成，不作M4P整体验收。

最新root检查：原Node24 `scripts/test.mjs --unit --strict` 4324/4324通过，0失败／跳过／取消／todo，1889.031秒；连续TAP／plan／footer及exit0已复核，226文件选入／61整browser粗排除，1168源before／after／当次current raw保持。旧8组Windows原生兼容270.079秒通过，48处外部精确适配可逆重建原bytes、原业务断言调用数不变，实际新增层另行核验；不与986专题门或前序计数累加。普通／审核两原cmd的实际窗口、health和设备协议均当次可达；两共享库实际升至77表／290定义，旧73表／252定义全部typed行（含auth无豁免）、9／16账号及两固定UUID保持，4张新账表表为空。原审核预览已恢复打开；最后活性为当次观察，不承诺持续存活。证据根 `D:/codex-temp/shenyi-ledger-check-acceptance-20261117/`；独立复核不豁免，未push／进入main／上线。

正常界面本轮root入口／UI相关门797/797通过、0失败／跳过／取消／todo，172.844秒；新增22项包含在其中。测试时1164候选文件before／after raw保持。原123项入口和22form／27密码固定基线保留，唯一新增12项／两form／两密码，当前135RPC／24form／29密码；43份旧检查仅精确名单投影和计数层适配，87项首段表达式及4项静态后续表达式／导入均可从原字节完整重建，其他字节与业务断言保持。变体门拒绝未授权增删／改序及额外表单／密码放宽。首轮794项740pass／54fail为数量冲突，适配后791pass／3fail中一项实际发现模块未加载时全局改密退出未清新增密码，已修复；另两项静态适配未落盘。部分修补中止后误启动的验证明确中断并留证，74项前提门通过后才执行本最终门。见 `D:/codex-temp/shenyi-ledger-check-ui-20261117/ui-compat-verified-final/api-report.json`、`entry-adapter-final-verification.json`及保留失败／中断日志。

正常Chrome完整流程已通过并复看截图：实际HTML／CSS／preload／主进程桥、真实TeamClient及签名Request／隔离SQLite，自授读权→来源核验→追加导入→历史只读→关闭清理／重开；1280×900及900×900无横向溢出，原HTML字符串不执行。源文件SHA和规范JSON保持，26张原资源表typed行保持，一笔导入POST／一份版本，无计算引擎资源或pageerror。主frame与picker为注入fixture，团队后端未用TCP/TLS，不称Electron／OS／Mac／独立验收。最终报告 `D:/codex-temp/shenyi-ledger-check-ui-20261117/browser/run-2026-11-17T05-18-52-108Z/report.json`；首轮过时侧栏文案已修，旧图／报告保留。

桌面主进程基础阶段root相关门150/150通过、0失败／跳过／取消／todo，104.532秒；新28项包含在其中，不与历史门相加。测试时1156候选文件before／after raw保持。真实TeamClient＋签名Request应用边界／隔离SQLite／D盘合成文件验证18MiB快照、哈希及响应头、独立读权、撤权／账号切换／取消／旧错误、受信服务预检、选取预检与私有字节绑定、错误Q／超限／读取失败、在途关闭及未知回执不重发；原客户端、设备、材料、资料保全、业务确认和立项来源相关检查一并通过。原生对话框为fixture，未做OS窗口／真实网络／Mac／生产验收。首轮新27项25pass／2fail为查询fixture误带版本字段，接口拒绝不放宽；另有metadata-retire-before.tap真实复现旧元数据错误会暂停后开的有效面板，修为四类读取捕获查阅代次后通过本门。证据：`D:/codex-temp/shenyi-ledger-check-desktop-20261117/client-related-final/api-report.json`。该主进程基础阶段无新HTTP／schema／IPC，未打开共享库，不改原专业算法；独立复核仍待额度条件解除，不以root代替。

服务端阶段root相关门392/392通过、0失败／跳过／取消／todo，211.656秒；测试期间1150候选文件before／after raw保持。覆盖真实设备签名Request、独立查阅权、无继承授权、负责人密码导入、W→Q及旧Q归属、版本／操作回执、body／KDF撤权ABA、只读／导入额外写回滚、大文件预检及并发限额、旧权限／停用／设备兼容。隔离库新增四空表／38定义至77表／290定义，旧73表／252定义及typed行／UUID保持；四类孤儿账表历史均禁止重建服务器身份。两份旧schema测试只增加显式四空表／38定义层，保留固定历史基线及旧断言。证据：`D:/codex-temp/shenyi-ledger-check-server-20261117/backend-related-final/api-report.json`。首轮相关385项为382pass／3fail，拒绝码断言过窄和两处旧schema数量固定，原失败完整保留；定向75门曾通过，随后补身份历史保护后运行本门。以上不是完整严格门、正常桌面或独立验收；独审额度限制仍待解除，不绕过、不替代。

新快照基础含28项核心／真实Chrome往返检查，连同原勾稽26项相关门共54通过、0失败／跳过／取消／todo；原自动校验专项另有5项通过。两次运行时原1132文件raw保持，之后只更新本项文档；未重跑完整4214门，不把专题累加成完整回归。独立复核仍待完成，不以root检查替代。

旧端导出阶段兼容相关门139/139通过、0失败／跳过／取消／todo，56.156秒；该门1139候选文件before／after raw保持。真实正常旧index完成下载及编解码读回，全部库typed行／DDL及原件SHA保持；无保存结果、未保存输入、版本／同rev内容／立项／固定身份／关闭上下文变化拒绝，旧归属来源仍逐byte一致。20种loader篡改均被原固定hash守卫拒绝，两份旧测试仅精确loader例外及Chrome环境入口适配，原断言和固定hash未改。以上是root检查，不是M4P独审或完整软件验收。证据：`D:/codex-temp/shenyi-ledger-check-export-20261117/related-after-adapters/related-report.json`、`loader-guard-mutations.json`及原日志。首轮真实页面把编辑触发的既有操作计时混入全库保全，8pass／2fail；拆分独立输入拒绝后新browser 11pass，随后补旧来源兼容进入最终139门。首轮related 133pass／2fail为旧loader守卫及缺默认Chromium，修后原门全部执行；早期失败保留。

继续同一M4P：正常页面、窄IPC和只读链路已接候选，下一步补独立复核及其发现问题的修正；其他M4模块继续按原路线逐项推进，并按实际问题补齐；独立额度限制不取消验收。运行、映射保存及底稿写入继续关闭，Mac／生产及双方业务签收单列，既定来源和权限决定不重复询问。 见[实际服务端合同](docs/LEDGER_CHECK_SERVER_CONTRACT.md)。

证据根 `D:/codex-temp/shenyi-ledger-check-discovery-20261117/`，见 `snapshot-related-report.json`、`legacy-baseline-verified-report.json`。未push／进入main／上线；本轮两原cmd的窗口／公开设备协议已实测，范围以最新检查点为准；M4整体和完整Goal保持active。合同：[只读快照](docs/LEDGER_CHECK_SNAPSHOT_CONTRACT.md)；[用户决定](docs/LEDGER_CHECK_ACCESS_DECISION.md)。

## 最近已验功能：M4O（保留原验收范围）

M4O立项来源独立授权、查阅及规范JSON保存已实现，分支 `codex/workspace-source-access`，实现基线 `5b855c7`，范围见[实施合同](docs/WORKSPACE_SOURCE_ACCESS_CONTRACT.md)。负责人验证当前密码，为自己或本项目有效经理／合伙人分别配置read和export；执行保存必须read && export，01可独立存权但不补授read。覆盖W工作区业务确认来源及旧Q迁入来源；旧自动回执无read时只显示一般已确认状态，unknown保留原查询编号且不重发POST。职级、owner、技术管理员、资料清单权均不自动获得来源权，不构成现实中标查证、最终项目金额或专业审计签发。

Windows正常入口12场景／7PNG／148依赖及独立原生产物复核已通过：正常W创建、原件上传和业务确认、Q审核迁入后的正常查阅、负责人逐项授权、source-only非负责人入口、AND四组合、W/Q原规范JSON逐byte保存、held Save撤权／取消零发布、真实rename后结果未知不重试均有证据。服务端51、client93、UI34及各独立专题通过；这些组存在重叠，不与完整回归相加。旧8组strict原生兼容一批通过，265.265秒、577源及原始输入保持；97份旧验收适配／8阶段125条转换链已独审，旧历史66/189、69/209、70/217均真重建，早期失败和P2修前证据保留。

原固定Node24 `scripts/test.mjs --unit --strict` 最终门：PASS；tests 4214／pass 4214／fail 0／skip 0／cancel 0／todo 0，TAP 1773861.365 ms、inner wrapper（Date.now） 1770471 ms、outer wrapper 1774860 ms；215 selected／59整browser粗排除，1022源before-after-current raw状态 一致。最终报告 D:/codex-temp/shenyi-workspace-source-access-20261117/full/full-audited-report.json；TAP SHA-256 217ac227106debb9386545dab0eb729eaa6b111a54dd55b76eab7714929fa7b5；独立完整门复核 D:/codex-temp/shenyi-workspace-source-access-20261117/independent-full-review/review.json。计数来自最终连续TAP/plan/footer与源清单，不采用途中计数。

四次实际只读在线备份及独审保留原71表223定义、全部typed行（含auth，无豁免）、9／16合成账号和两UUID；升级后73表252定义，仅新增2表／26trigger／1index，两来源表空。两个原cmd入口当次真实窗口、health及设备协议可达，不宣称持续存活。1108原文件51,358,212B和13处既存CRLF前件保留；范围预审为115旧改＋23新、993原raw保持，业务公式、原编号／Q-W及历史原件不变。证据根 `D:/codex-temp/shenyi-workspace-source-access-20261117/`，原生／兼容／共享及范围独审分别见 `independent-native-review/review-final.json`、`independent-compatibility-review/review.json`、`independent-shared-final-review/review.json`、`independent-scope-review/report.json`。

本地交付状态 windows_local_candidate_technical_verified；实际commit与最终门禁以外部 `D:/codex-temp/shenyi-workspace-source-access-20261117/final-delivery.json` 及Git为准，不预填未来SHA。未push／进入main／上线。M4整体及完整Goal保持active，其他专业模块逐出口授权／显式迁入、真实身份与商户／支付供应商、订阅席位、国内域名服务器及备案、Mac／真人picker／真实异机／双平台签名发行和两负责人业务签收仍按独立关卡推进。本片不代替这些验收；既有M3E和M4历史原样保留。

### 最近已验交付：M3E本人电脑信息与记录

M3E本人设备自查入口已实现并通过Windows本地候选验收：`codex/my-bound-device`，base `93fb7d1`。正常工作台可查看本人当前绑定电脑、服务端最近在线核验及分页绑定／换机记录；零业务成员也只查本人。117方法／21表单／26秘密输入，旧同步status和换机审批保持。usage仅记录成功设备认证，与nonce／新lease同事务，实际71表223定义；旧70表typed资料／217定义保持，仅新增6对象。合同见[执行合同](docs/MY_BOUND_DEVICE_CONTRACT.md)。

原生actual-main／TLS／OS vault验收8场景、6PNG、7阶段库＋runtime、3vault通过；78B输入、库原件和保存SHA eccb8cd2810adaffe36e3871c47a8a427dacb1feff9f93e7fe9a8f827adf362a一致，1107源在原生当时before／after raw同。真实申请、密码审核、明确激活与旧会话退出已验；32分页事件是人工夹具，旧401为网关负例，不冒充真实旧服务响应。四真RO保全部旧typed行／DDL，auth零豁免，新usage空，9／16账号及UUID不变；两原cmd当次实际窗口与公开设备协议可达，正常关闭无force并记录review窗口保留，不把当时观察写成持续存活。原生／共享独审见 `independent-final/native-review.json`、`independent-final/shared-after-review.json`。

最终原Node24严格gate 4036/4036，0fail／skip／cancel／todo（1727789.1835ms），205selected／59整文件browser粗排除；1000源before-after-current raw同。新109项已含于总数，不与专题相加。首full真实4030通过＋6失败、0skip／cancel／todo（1688680.0319ms）及1000源当轮raw同证据全留。仅6旧验收精确适配3325B，跨epoch994源同、产品0变；固定Node24原5文件90/90通过（76962.2215ms），Node25的90项单列补充而非门禁。旧8组strict兼容PASS，实际633.734秒，568源与3原始输入前后保持；首default失败及7组未运行不改判通过。

证据：`D:/codex-temp/shenyi-my-device-20261117/`；完整gate `full-rerun/full-audited-report.json`，旧兼容 `compatibility-rerun/summary.json`，六夹具独审 `independent-client-entry/after-root-apply/review.json`，server／UI独审 `independent-server-ui/verification.json`，client／入口独审 `independent-client-entry/review-final.json`，范围独审 `independent-final/scope-rerun.json`，Node24／25边界 `commands/runtime-resolution-correction.json`。完整及兼容独审均已PASS，见 independent-final/full-review.json／independent-final/compatibility-review.json。范围75旧改＋14新，1018原文件raw保持。M3整体及完整Goal仍active；下一仅拟定最高审核账号独立人工恢复的有界合同，不擅自开工；M4立项来源查阅／导出分权已由用户确认，项目负责人验证密码后分别明确授予自己或本项目经理／合伙人；待独立实现，当前专业模块仍关闭，不再重复询问该决定。Mac、真人picker、真实异机／身份供应商、双平台发行和生产未验。未push／进入main／线上发布，未来本地commit以实际Git与外部manifest为准。

上一M3D受信HTTPS集成本地候选已验：`codex/trusted-team-https` 从M4N本地 `6ccfe68` 按[执行合同](docs/TRUSTED_TEAM_HTTPS_CONTRACT.md)及[配置说明](docs/TRUSTED_TEAM_HTTPS.md)接通固定HTTPS origin/预期UUID、秘密前无秘密探测、每响应身份核对和实际桌面入口。完整原Node24严格gate3927/3927、0fail/skip/cancel/todo（1699019.3723ms），199selected/59整文件browser粗排除，988源before-after-current raw同；新98项包含在总数。新Windows实际main原生6case/5PNG/4阶段库＋runtime及独审通过，69B输入/库原件/保存逐字节与SHA3bd88d48cbd4f6abad989ab66cbb3fc53ce99ed3bcce31432bebdfc2a318d767相同，3actor/90profile/1独立OS vault保全；native1087当时before-after-current同，后仅已列说明文档变化，当前产品/测试988仍同。wrongUUID仅3次无秘密methods、无CA为0次HTTP，依据冻结执行断言与事件终态，不冒称有独立actor分界原始索引。旧相关8组顺序兼容631.86秒、563源及3输入保持，四真RO保70表217定义与全部typed行/auth零豁免、9与16账号/UUID不变，两原cmd实际可达。116RPC/21form/26秘密输入不增。2项unknown/迟到logout及1项remote帮助文案P2均有修前Fail→修后Pass；配置/客户端/TLS首次夹具失败完整保留。范围11旧改＋11新增，其余1071原文件raw保持，旧device-entry仅一行dependency适配，无专业规则/DDL更改。仅本地候选与本地提交，以实际Git及外部交付manifest为准；未push/main/线上发布。M3正式部署/供应商、最高owner恢复、设备自查/历史入口和双平台发行仍待；M4专业模块立项查阅/导出授权待答，保持in_progress，Goal active。Mac、真人picker、客户/公开生产及两负责人业务签收未完成。

上一M4N在 `codex/team-material-preservation-export` 从M4M本地 `5cb5256` 完成[团队资料完整保全导出](docs/TEAM_MATERIAL_PRESERVATION_EXPORT.md)及[执行合同](docs/TEAM_MATERIAL_PRESERVATION_EXPORT_CONTRACT.md)的Windows本地候选验收。已有material.read可明确保存当前record及全部历史原件，W授权／Q原业务保持，v2来源未验签、不代表专业签发；旧端只在同Q正式空目标明确恢复，不继承团队权限。完整原Node24严格gate3829/3829、0fail/skip/cancel/todo（1562951.1104ms），194selected/59整文件browser粗排除，979源before-after-current raw同，新157包含在总数。首轮3828pass/1fail（2210旧顺序夹具）全留，单处精确修复及5定向PASS后完整复验；两轮978源互同＋唯一旧夹具差异，不称跨轮979全同。新Windows6case/4PNG/7SQLite/4vault/124profile/717源、旧端browser2/2（含actual原生ZIP）、旧8组、四真RO与两原cmd一键均已独审。116RPC/21form/26秘密、70表217定义不变；范围59旧改+15新增，其余1008原字节保持，15产品源与43旧验收文件90精确适配分别核验。仅本地提交，以Git及外部交付manifest为准；未push/main/上线，M4及完整Goal active。立项来源查阅/导出新授权仍单独待答，只影响后续专业模块。Mac、真人选择器、真实客户/生产和两负责人业务签收未完成。

上一M4M在 `codex/workspace-material-identity` 从M4L本地 `f623571` 按[资料身份适配合同](docs/WORKSPACE_MATERIAL_IDENTITY_CONTRACT.md)与[使用说明](docs/WORKSPACE_MATERIAL_IDENTITY.md)完成Windows本地候选技术验收。W资源授权与Q原业务内容分离，独立五权、原包／record身份／原件历史保持，无新增schema／HTTP／RPC。完整3672/3672、0fail/skip/cancel/todo（1457827.3341ms），188selected／58整文件browser粗排除，966源before-after-current raw同；首轮完整gate为3656/3672、16fail：905项fetch failed的实际端口及cause未确证；2613—2627共15项为旧预览mock缺getProject。原日志与16项失败均保留，本次通过结果取自final-full-rerun，未把失败前件改判成功。两轮各自966源before-after保持；轮间仅经审查的旧测试夹具1处插入，965源相同，不称两轮966互相全同。新86（18＋28＋40）包含在总数。最终strict原生6场景／6PNG／8阶段库＋runtime／4vault／124profile／128源同、2份合法原子保存及撤权heldSave零发布均独审通过；首绿截图的时态文案缺陷及修前DOM FAIL已保留。旧7兼容一批全过（567.563秒），四真RO保70表217定义及全部typed行／auth、9与16账号／UUID；两原cmd重试实际可达，首普通启动pwsh空环境值FAIL及外部v2修正单列。114RPC／21form／26秘密保持。尚未push／进入main／上线；本地commit以实际Git及交付工件为证，不预写未来SHA。M4及完整Goal active，下一单项仍旧六模块权限／显式迁入；Mac、真人选择器、客户业务、生产及两负责人签收未完成。

上一M4L在 `codex/workspace-formalization` 从M4K本地 `50eb465` 按[正式业务确认合同](docs/WORKSPACE_FORMALIZATION_CONTRACT.md)与[使用说明](docs/WORKSPACE_FORMALIZATION.md)完成Windows本地候选技术验收。用户已确认由项目负责人核验已保存来源并验证密码，系统记录为其业务确认；不冒称现实中标自动查证、实时状态或审计签发。完整3586/3586、0fail/skip/cancel/todo（1428133.9451ms），183selected／58整文件browser粗排除，956源before-after-current raw同；新93包含在总数。最终strict原生4场景／5PNG／8库／4vault、旧5按1+4兼容、四真RO及两原cmd一键均通过独审。旧69表typed行／209定义和9/16账号／UUID保持，新增空1表7trigger后70/217；114RPC／21form／26秘密。W/Q分列，原权限、任务、原件和创建回执保持，材料W/Q接入仍为下一单项M4M。未push／main／上线，Mac／真人选择器／客户业务／生产及两负责人业务签收未完成，M4和完整Goal active。

以 [完整Goal提示词](docs/COMMERCIALIZATION_GOAL.txt) 为持续执行合同，配套 [团队产品需求](docs/TEAM_PRODUCT_REQUIREMENTS.md)、[商业化路线图](docs/COMMERCIALIZATION_ROADMAP.md) 和 [进度](进度.md)。

- 米老师负责审计业务；产品负责人负责其他应用、权限、UI、桌面端、订阅、官网和上线。
- 已确认 Windows/Mac 桌面客户端＋国内服务端，首版含电脑绑定；团队年订阅＋员工席位。
- 后续已确认正式登录为手机号＋密码和微信扫码；实现与接入边界见[身份方案](docs/PHONE_WECHAT_AUTH_PLAN.md)，本机用户名演示不等于这两项已接入。
- 团队首次开通已确认前期由产品负责人（当前用户）人工审核开通团队和首管理员，员工通过邀请激活；本机候选已实现，商业/审计权限不自动扩大。
- 设备规则后续已确认：每账号最多绑定1台、同时在线1台；员工换机teamadmin审核，管理员本人productowner审核。首版断网暂停团队业务，同机唯一业务会话、新完成持钥登录后旧业务会话清退；[M3B正常Windows客户端](docs/DESKTOP_DEVICE_SESSION.md)与[M3C员工/管理员换机审批](docs/DEVICE_REPLACEMENT.md)本地已验，Mac/真实跨电脑、最高审核账号自身恢复和正式部署仍未完成，M3/完整Goal继续进行。
- 密码恢复审核已确认：团队管理员审核员工，管理员本人由产品负责人审核，仍须本人短信；审批/一次性授权签发链已有本机候选，缺真实供应商/生产身份时服务保持关闭。
- 采集任务指派对象已确认仅本团队有效实习生/助理；经理/合伙人还须具体项目显式采集管理权，不能按职级或技术管理员身份扩大范围。指派/退回桌面候选已接版本校验，成员停用已确认：团队管理员可停用本团队业务成员（含经理、合伙人）；技术管理员本人由产品负责人处理，业务职级本身不授予停用权；[成员停用候选](docs/MEMBER_DEACTIVATION.md)已实现本地API/UI、会话与在途授权撤销，真实生产管理和首版设备仍待验收。
- 本轮已确认：团队管理员管理普通员工四业务职级，管理员本人兼任业务职级由产品负责人审核；经理和合伙人均可新建项目，创建者管理该项目授权。[M4A普通员工职级调整](docs/BUSINESS_ROLE_MANAGEMENT.md)已通过Windows本地候选验收，不从职级自动附送项目权限；后续继续管理员兼职审核及项目创建/授权等切片。
- [M4B项目授权、采集任务与资料核对公共基础](docs/PROJECT_ACCESS_COLLECTION.md)已通过2202项全量回归及Windows原生独立验收，精确规则见[执行合同](docs/PROJECT_ACCESS_COLLECTION_CONTRACT.md)。旧正式立项仍须最新中标报价；用户已确认允许先建仅采集工作区，M4K创建已本地验；M4L采用负责人核验已保存来源并验证密码的业务确认，保原编号，不自动登记旧project owner。
- [M4C管理员兼任业务职级审核](docs/ADMINISTRATOR_BUSINESS_ROLE.md)已通过Windows本地候选验收及2407项完整回归，独立负责人可核准/收回兼任，技术与业务资格及旧采集/项目/恢复/换机出口统一；规则见[执行合同](docs/ADMINISTRATOR_BUSINESS_ROLE_CONTRACT.md)。不从兼职职级附送项目，不等待项目创建选择而停止独立工作。
- M4D已按[单项目资料保全与本机恢复合同](docs/MATERIAL_PRESERVATION_CONTRACT.md)补齐旧端清单及所有留痕引用原件的可靠来源包，并恢复到同UUID空本机资料区；[使用与证据说明](docs/MATERIAL_PRESERVATION.md)区分保全范围、旧上传内容准入和团队接入边界。2026-11-16用户已确认由产品负责人审核目标团队与首位负责人，按M4F显式来源/审批合同接治理登记；仍不把本机恢复或治理登记当整个软件／客户原件迁移完成。
- [M4E单任务所选原件导出](docs/TASK_ORIGINALS_EXPORT.md)已通过Windows本地候选验收及2766项完整可移植回归，精确规则见[合同](docs/TASK_ORIGINALS_EXPORT_CONTRACT.md)。正常团队桌面两个入口分别守本人/项目核对下载权、最后fresh批量复核并原子发布，不自动导出全部历史、形成专业签审或新增项目归属。
- [M4F旧正式项目归属审核](docs/LEGACY_PROJECT_REGISTRATION.md)已本地完成：产品负责人审核团队与首位负责人，旧姓名不当账号授权；同UUID治理登记与客户资料迁入分开。2958项完整回归及Windows原生独立验收通过。
- 上一M4G按[资料清单模块合同](docs/TEAM_MATERIALS_MODULE_CONTRACT.md)实现正常桌面独立四权限、同UUID首次导入、完整树／历史／原件及原规则核对／关门／重开；[使用说明](docs/TEAM_MATERIALS_MODULE.md)记录操作路径和验收边界。用户已批准负责人密码逐项self或授本项目经理／合伙人，关门权与核对权分开。专题、最终Windows原生、共享预览保全、完整3092项回归及旧19组原生兼容均已独审通过；本片Windows本地候选已验，M4与整个Goal仍active。M4H按[原件安全预览合同](docs/TEAM_MATERIAL_PREVIEW_CONTRACT.md)接独立受限阅读窗口及[使用路径](docs/TEAM_MATERIAL_PREVIEW.md)，复用原reader和材料read，不扩大专业或数据授权；严格Windows原生、独立安全、旧20组兼容、共享保全及完整3184项回归已通过；本片Windows本地候选已验，M4与整个Goal保持active。
- 用户已确认资料维护权由项目负责人验证密码后，单独授予自己或本项目合格经理／合伙人；[M4I执行合同](docs/TEAM_MATERIAL_MAINTENANCE_CONTRACT.md)冻结新增／移除关联、原件历史保留和沿原规则重置核对。M4H已本地提交12b9213，本片M4I已通过3307项完整回归、Windows原生与旧21兼容及共享保全独审，Windows本地候选已验，M4与整个Goal继续进行，不把其他四权或owner身份当维护权。
- [M3 Windows本地阶段门](docs/M3_LOCAL_ACCEPTANCE.md)独立通过，可以进入隔离M4；M2/M3正式身份、远程HTTPS/配置、最高owner恢复、Mac/真实跨电脑和生产仍未完成。
- 先做身份与团队数据隔离、四角色权限，再做设备/商业化；业务稳定后整体升级UI。
- 当前无域名和阿里云服务器，主体/省份及商业细则仍需确认；研发可先用合成数据推进，真实购买/申请/签约/客户资料迁移/生产发布另具相应授权。
- 先完成M0规划与独立检查，后续一个里程碑在进行；现有报告分支仍待验收，不自动合并。

## 2026-11-14协作建设记录（历史范围）

下文的“本轮”指当时的GitHub建设，不限制上述已授权新目标；也不表示当时待办现在已经完成。

## 当前优先级

1. 建立私有GitHub仓库，把源码/开发文档与客户业务资料分离。
2. 支持Windows/Mac分别clone、安装依赖和本机运行；写清代码同步不等于业务数据同步。
3. 给米老师零基础教程，用Issue表达“只改哪里、不改哪里”、按PR验收。
4. 保留原已发布v61基线；此前成本导航/报告页修正在独立分支，明确未发布、待业务验收。
5. 后续任务逐项关联Issue；严禁未经要求重构界面或变更既有业务逻辑。

## 产品主线（保留的用户要求）

- 六大模块：招投标、立项、审计程序、报告、核算、基础资料；点软件名称回工作台。
- 报价单与标书分页面，报价导出Word；两证必带但不单独展示，取消后续盖章开发。
- 项目登记保持原表格；业务编号为年度-风险等级-项目类型-四位顺序，保留内部唯一ID和关联。
- 资料按Word标题层级组织，末级可上传/预览；已上传、未上传状态随实际改变，核对结果人工确认。
- 底稿目录严格关联索引、原表顺序/格式/公式链接；基础资料中模板复用，不反复上传。
- 账表校验使用本项目资料收集来源，列问题；不能只交核验结果代替按模板填写的全套底稿。
- 报告使用本年TB、上年报告、上年TB、本年审计底稿；缺证据不能自动形成可签发意见。
- 成本按明确含税收入和用户指定收益率口径；费用报销关联立项信息。
- 当前维持本机业务存储、只读冻结与备份，不暗中上传客户数据；两种部署/收费模式待试点验证。

## 不在本轮擅自处理

没有新增业务界面/字段、没有改现有公式/数据键、没有上线待验收分支、没有迁移客户业务资料、没有替米老师注册账号、没有把仓库公开。完整业务验收与跨设备数据协同属于后续明确需求。

## 完成标准

- 远程仓库确认为Private；main和待验收分支可拉取，实际提交号可核对。
- 文档能让新同事从零完成提Issue；开发者能按锁文件运行，而非依赖原电脑外部node_modules。
- 仓库无业务原件、章签图片、环境凭证和部署身份；工具检查与人工审查都有记录。
- 技术测试报告不隐瞒失败/跳过，业务验收和线上发布状态分开。
- 邀请和分支保护只按实际已生效状态报告；米老师用户名未提供时列待办。

- M4F已按[旧正式项目归属登记合同](docs/LEGACY_PROJECT_REGISTRATION_CONTRACT.md)接旧登记表只读来源导出和正常桌面独立审核，保原UUID/编号及历史文本，显式选择初始权限；Windows严格合成闭环及独立安全/原件保全复核通过，完整可移植回归2958通过、0失败、0跳过，758运行/测试源保持；该本地候选已验，M4和完整商业化仍未完成。见[使用和证据](docs/LEGACY_PROJECT_REGISTRATION.md)。新项目提前采集／中标立项路径仍待选择，真实客户资料上云另需授权。

- M4J接[采集提交原件预览合同](docs/TASK_SUBMISSION_PREVIEW_CONTRACT.md)，沿已有本人下载或项目read＋review补两处正常阅读入口，不授新scope／不关联材料清单；Windows本地候选技术验证及3386项完整回归、strict原生和旧5相关兼容均通过独审；整个M4/Goal仍active，用户已确认下一片允许先采集工作区再按原规则正式立项。

- 最新产品决定：2026-11-16用户已确认允许正式中标前先建仅资料采集工作区，正式中标后再立项；工作区须明确未正式立项，不提前生成正式业务编号或伪造报价，正式立项继续最新中标报价及原编号规则。 接续M4J预览后实施采集工作区创建；不再将这项选择列待答，可信正式化及专业模块仍逐项验收。

上一M4K已按[采集工作区创建合同](docs/COLLECTION_WORKSPACE_CREATION_CONTRACT.md)与[使用说明](docs/COLLECTION_WORKSPACE_CREATION.md)通过Windows本地候选验收：完整3493项、strict原生7场景、旧5兼容与共享数据保全具独审证据。先采集后正式立项的产品选择已落实至创建；正式化关联仍须可信最新中标报价与原编号，M4及整个Goal继续active。实际commit／main／一键／线上状态见进度及外部final-delivery，不把本机候选当商业化生产完成。
