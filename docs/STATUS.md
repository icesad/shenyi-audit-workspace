# 当前状态：M6E 只读底稿长表与键盘操作

## 2026-11-18 M6E 只读底稿长表与键盘操作

底稿加载完成后，阅读区可用 Tab 聚焦并通过方向键滚动。切换工作表保留所选按钮的焦点，并从左上角显示新表。读取失败清除旧表，提示并聚焦现有刷新权限与版本入口。30 个关联文件冻结回归 363 项通过，零失败。一个 Word 浏览器项因默认路径没有 Chromium 而跳过，显式指定 Chrome 后同源单独通过。合计 364/364 项通过，1396 个候选文件哈希一致。Windows 原生用两张合成工作表验证 100% 和 200% 下的分页阅读、焦点、恢复和无新增业务写入。Chrome 单独复测专业渲染器的合成版式，列宽、合并、隐藏及缓存原文保持，另已验证四份 Office 类型解析一致。普通独立候选一键实测启动和正常退出。两处旧预览保留，原两条业务一键本轮未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m6-workpaper-ux-20261118`。 Windows 原生使用无目录版式的合成 XLSX，预置专业目录对应原件未在 Electron 实机复核。方向键和 Page Down 已验，End 键在 100% 与 200% 下表现不同。macOS 实机、双方走查、正式官网购买及生产仍待完成。 [现有品牌规范](../desktop/brand-spec.md)。

## 2026-11-18 M6D 账务缩放与键盘操作

优化年费、增购和退款工具栏的窄窗口布局，长订单号和关联编号可完整换行。订单核对恢复当前操作的键盘焦点，用户已移开的焦点不被拉回，批量失败可继续键盘操作重试。批量状态区为空时仍保留无障碍语义，纯管理账号侧栏和面包屑改用「管理与审核」。28 个关联文件共 263/263 项通过，零失败或跳过。1396 个候选文件测试前后哈希一致。独立 Windows 验收覆盖最高 200% 的九组布局、59 次持钥请求和 14 张截图。键盘取消未创建订单，退款原单缺失后可重新查询，80 字符跟进编号完整写入合成库，期限及席位保持。账务独立候选一键实测启动和正常退出。两处旧预览保留，原两条业务一键本轮未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m6-billing-ux-20261118`。 M6 后续继续走查只读底稿长表、键盘滚动、错误反馈和两位负责人验收。macOS 实机、正式官网购买与生产支付仍待相应条件。 [现有品牌规范](../desktop/brand-spec.md)。

## 2026-11-18 M6C 角色工作台快捷入口

给经理、合伙人、技术管理员和独立审核账号增加模块快捷入口，跟随现有面板可见状态。按键打开原面板并聚焦标题。未选择时不打开面板或读取目标记录，退出时清除导航。纯管理账号省去无任务的搜索和列表，并保留原邀请核对的刷新入口。117 个关联文件共 1791/1791 项通过，零失败或跳过。1396 个候选文件测试前后哈希一致。独立 Windows 验收覆盖五类合成账号、两组窗口及缩放、12 次键盘跳转、75 次持钥读取和 14 张截图。普通及账务独立候选一键均实测启动和正常退出。两处旧预览保留，原两条业务一键未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m6-role-navigation-20261118`。 纯管理账号的侧栏和面包屑仍沿用「资料采集」。M6 后续继续核验账务长列表的 200% 缩放、状态反馈与键盘焦点恢复，再走查只读长表并完成两位负责人验收。macOS 实机、正式官网购买与生产支付仍待相应条件。 [现有品牌规范](../desktop/brand-spec.md)。

## 2026-11-18 M6B 官网本地候选

新增独立官网，介绍资料采集、职级与权限、团队年订阅、桌面版本和常见问题。合成工作台以界面示意展示。正式下载、购买与备案等事项在页面上显示当前状态。Windows 官网一键已验，官方静态包只包含首页、样式和原审易标识。20/20 个相关测试通过，零失败或跳过。独立 Chrome 验收覆盖三个视口、站内链接、键盘导航、常见问题与请求范围。两处旧预览前后观察一致，原两条业务一键未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m6-website-20261118`。 M6 继续覆盖经理、合伙人和管理员界面并收集双方走查。官网正式运营待签名安装包、主体备案、条款和购买入口明确。macOS 原生及真实交易继续待验收。 [官网使用说明](../website/README.md)。

## 2026-11-18 M6A 桌面登录与采集工作台

调整登录和采集工作台。已指派任务移到个人设置前方，四项个人设置合为「账号与设备」。提高辅助文字和键盘焦点对比度，窄窗口自动改为单栏。键盘打开任务后聚焦详情。117 个关联文件 1790/1790 通过。最后仅调整 CSS 以保留登录错误提示的读屏区域，直接相关 162/162 复跑通过。两轮零失败或跳过，1390 个候选文件在各轮前后哈希一致。原生 Windows 实测实习生与助理登录、首次绑机、任务隔离和键盘操作。12 个页面与视口组合在 100% 至 200% 缩放下没有横向溢出，独立合成一键已验。两处旧预览前后观察一致，原两条一键未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m6-desktop-ui-20261118`。 待产品负责人走查视觉方向。后续继续经理、合伙人与管理员页面的视觉易用性、独立官网、macOS 和双方验收。M5 正式价格、支付和其他商业验收仍是待完成项。 [现有品牌规范](../desktop/brand-spec.md)。

## 2026-11-18 M5M Windows 合成账务整体验收

新增 Windows 一键账务候选，每次启动使用独立数据库、端口和设备目录。已原生实测增购、续费、超时关单、迟到收款以及产品负责人登记退款受理和跟进，实习生无账务及退款权限。58 个关联测试文件 924/924 通过，零失败和跳过，1390 个候选文件前后哈希一致。独立到期续费测试经过 24 次真实本机 HTTP 请求、18 次设备验签、四份 SQLite 快照和重启回读。到期保留授权历史的读取，暂停新增；可信模拟款只兑现一次，经理凭原授权恢复写入。两处旧预览经两次只读观察一致。新增一键已验，原两条一键未重验。未进入 main、未推送、未上线。证据在 `D:/codex-temp/shenyi-m5-preview-20261118`。 M5 正式商业验收仍需价格及服务条款、真实商户与对账退款、主动到期提醒和权益处置。macOS 原生及双方签收各自待验。本地 M6 可接续现有视觉方向与官网准备。 [本地验收指南](M5_LOCAL_ACCEPTANCE.md)。

## 2026-11-18 M5L 模拟订单超时关闭

M5L 基于 `abf9f8f` 接入可信模拟关单。年费新单在创建时锁定截止时间，增购沿用原报价期限。到点仍须核验回执。先有已验收款或异常证据不得新增关单，关单后收到的有效收款留证待复核，不发放本单期限或席位。50 个关联文件 783/783 通过，零失败和跳过，1386 份候选源码哈希一致。独立 HTTP 84 次请求、持久重启、Windows 原生 36 次设备验签通过。两处旧预览保留。未进入 main、未重验原一键、未上线。正式时效、真实支付退款、权益处置和 macOS 仍待验收。证据在 `D:/codex-temp/shenyi-order-closure-20261118`。 [模拟关单合同](BILLING_ORDER_CLOSURE_CONTRACT.md)。

## 2026-11-18 M5K 产品负责人退款受理留痕

M5K 基于 `dbde470` 接入产品负责人原订单受理与跟进登记。独立权限、持钥会话和当前密码共同校验，原订单和已核验收款关联追加记录。团队及其他审核角色保持拒绝。63 个相关测试文件 1307/1307 通过，零跳过。首轮一项旧测试把新增资料保护触发器计入旧层。精确核验新层后只修这一文件并完整复跑，其余 62 个文件沿用首轮验证，运行代码一致。独立 HTTP 86 次请求、持久重启及密码核验期间撤权已验，Windows 原生 35 次设备验签通过。旧预览保留。未进入 main、未重验原一键、未上线。实际退款、权益处置和 Mac 仍待验收。证据在 `D:/codex-temp/shenyi-refund-intake-20261118`。 [退款受理合同](BILLING_REFUND_INTAKE_CONTRACT.md)。

## 2026-11-18 M5J 本团队账务批量核对

M5J 基于 `3be9465` 接入桌面批量核对。技术管理员能逐批核对本团队年费或增购，每批最多 8 笔，逐笔处理查单、可信收款与异常并复用原权益账本。首版退款由产品负责人受理，团队暂不在客户端提交退款申请。39 组关联测试 706/706，零失败或跳过，1370 份候选文件哈希前后一致。独立 HTTP 34 次请求和持久重启通过，Windows 原生 49 次设备验签通过。两处旧预览保留，未进入 main，未重验原一键入口，未上线。正式商户、实款退款、权益处置及 Mac 仍待完成。证据在 `D:/codex-temp/shenyi-billing-reconciliation-20261118`。 [批量对账合同](BILLING_BATCH_RECONCILIATION_CONTRACT.md)。

## 2026-11-18 M5I 模拟退款与拒付复核

M5I 基于 `5a293b4` 接收可信模拟全额退款和确认拒付。异常按原交易留证，桌面显示待复核。异常证据先入账的订单暂不发放新权益，较早已全额撤回的订单不阻挡后续正常续费。已兑现期限、席位和成员访问保持原样。37 个关联文件最终 657/657 通过，零失败和跳过。首轮的两项历史迁移统计遗漏了新层的精确投影。修订两项测试后全量相关门重跑，运行代码未改。独立 HTTP 复核 61 次真实请求并验证持久重启，Windows 原生 41 次实际设备验签。旧预览保留，未进入 main，未重验一键，未上线。退款申请和处理规则、正式渠道及 macOS 仍待完成。证据位于 `D:/codex-temp/shenyi-payment-exceptions-20261118`。 [模拟异常合同](PAYMENT_EXCEPTION_CONTRACT.md)。

## 2026-11-18 M5H 桌面订阅与席位

M5H 基于 `335ac0e` 接入桌面「订阅与席位」。本团队技术管理员可查看容量和订单、创建年续费／增购，并通过可信合成来源核对结果。降档须先释放启用成员及有效邀请占用的席位。51 个关联测试文件 889/889 项通过，零失败或跳过。1361 个候选文件在测试前后哈希一致。独立 Windows 原生验收 5 个场景，51 次实际设备验签全部通过。两处旧预览保留。未进入 main，未重验原一键入口，未上线。正式价格、真实支付和退款、Mac 与官网仍待完成。证据位于 `D:/codex-temp/shenyi-desktop-billing-20261118`。 [桌面账务合同](DESKTOP_BILLING_CONTRACT.md)。

## 2026-11-18 M5G 本地候选

M5G 基于 `12495e1` 完成下一年度席位的合成续费候选。默认取原期限结束前一毫秒的已购容量，本团队技术管理员可调整。减席前先释放足够的现有承诺，建单与兑现均检查，付款后的并发占位冲突进入待核对状态。原子提交新增年期和选定容量，触发故障时只保留可信收款记录。22份完整相关测试 259/259，零失败或跳过，1354个候选文件前后哈希一致。首轮258/259，唯一失败为旧年单按前缀计数误将三条新增触发器算入。改用精确校验旧层定义的测试助手后重跑，业务源码未改。独立本机HTTP证据在 `D:/codex-temp/shenyi-annual-seats-20261118/review/`。合成总价为团队年费加席位年单价乘所选数量，正式价格、商户退款、桌面购买仍待接入。未进入main、未推送、未重验一键、未上线，旧预览保留，Goal继续。 [年度续费合同](ANNUAL_SEAT_RENEWAL_CONTRACT.md)。

## 2026-11-18 M5F 本地候选

M5F 基于 `4814242` 完成服务器合成席位增购候选。技术管理员锁定人数、精确剩余时长折算的整单金额和原到期日。可信收款先持久化，之后原子发布一份容量记录。重复通知与跨续费复用交易号不会重复授席，逾期收款留下可查事实供处理。19份完整相关测试 234/234，退出码0，零失败、跳过、取消或待办，1348个候选文件哈希前后一致。独立本机HTTP及其他证据见 `D:/codex-temp/shenyi-seat-orders-20261118/`。采用用户确认的按精确剩余时间折算并整单向上取整到分，候选分母为报价时点起一个北京时间自然年，最长报价15分钟，合成价格不作正式标价。实际退款、年度席位续转、桌面购买、商户接入还待完成。未进入main、未推送、未重验一键、未上线，旧预览均保留，Goal继续。 [增购订单合同](SEAT_ADDITION_ORDER_CONTRACT.md)。

## 2026-11-18 M5E 本地候选

M5E 基于 `3d3d169` 实现三类员工邀请发出即预留、激活转换、撤回或到期释放。服务端在写事务内检查容量，技术管理员首次兼任占一席，且可查本团队席位汇总。20份完整相关测试 502/502，19份484项和单独补跑的1份18项均通过，无失败或跳过。首门502项测试退出0，绑定脚本因1份测试开跑后改动退出1。保留原始结果，补跑固定1341个候选文件，只替换该份证据。独立本机HTTP证据在 `D:/codex-temp/shenyi-seat-reservations-20261118/review/`。初版无 rowid 导致六条旧快照测试失败，保留 rowid 后通过。当前使用合成容量，增购折算、年单容量续转、桌面购买及生产支付待接。未进入 main、未推送、未重验一键、未上线。旧两预览保留，M5与完整Goal继续。 [席位预留合同](INVITATION_SEAT_CAPACITY_CONTRACT.md)。

## 2026-11-18 最新：M5D实现与验收

`codex/annual-order-simulation`从`d88e809`接续，本地M5D候选已验。实现本团队技术管理员服务端锁价年单、北京自然年、独立HMAC合成来源、先持久验真事实再同事务发布订阅及兑现回执、主动查单和重启幂等补偿；默认关闭，启用须严格device＋team-management-v1，不授审计资料。固定Node24的40完整相关文件1005/1005、0fail/skip/cancel/todo、exit0、799.344秒；fresh 1332候选覆盖全部selection，before/after字节同。作者日历/网关/store/API及schema项含于根门，不累加。独审首轮两个有界场景32真实TCP、23运行时设备验签及23真实KDF，实际末fulfil插入故障保留inbox/回滚term，close/reopen后confirmedAt保持；43B合成采集原件和原项目grant保持，不外推全部历史底稿/GUI/Mac/HTTPS/商户。原API夹具两FAIL、gateway Proxy两RED、schema原3FAIL均保留；未弱化测试或KDF。schema89表/355显式DDL，旧86/346与原11表peel合同保持。旧预览/共享库/vault保留；未push/进main/重验一键/上线。无生产价格、增席容量/折算、退款或购买UI，M4未全完，M5/Goal active。合同[年单模拟收款](ANNUAL_ORDER_SIMULATION_CONTRACT.md)，证据D:/codex-temp/shenyi-annual-order-simulation-20261118/。

本轮另确认下一片：发出邀请即预留席位；年期内增席与团队原到期日对齐，按剩余期限折算。启用业务人数原计数规则保持，邀请预留另记；仅记录政策，本片不实现容量/增席，也未确定实际价、精确折算公式与舍入。

## 2026-11-18 最新：M5C现有团队管理到期规则候选

`codex/subscription-management-expiry`从`4a5b1ff`接续。可信`team-management-v1`包含原17业务数据写检查及现有16管理写路线的分类：新增独立授权位、潜伏位、失效eligible／维护绑定恢复、普通非空职级赋予、邀请／激活和新任务收件人须active；纯权限子集撤回、管理员role=null、停用、邀请撤回及原安全流程保持。不能按位数净减少、职级名称或read前提掩盖新增raw授权；完整任务集合不使用UI前51名截断。

原身份／目标／参数／no-op／CAS在先，真实KDF、发送等待和实际最后写SQL后重核，末端失效事务回滚。资料密码格式原400顺序的真实RED已用原password()前置修复，未弱化断言或KDF。作者首次source导出误用与authorizer关闭顺序的夹具失败均保留，最终作者A24／B84／根23含于统一门，不累加。没有新增schema或专业规则。

固定Node24的32份完整相关文件1053/1053，0fail／skip／cancel／todo、exit0，827.813秒；fresh 1320候选覆盖全部actual selected，before／after同。独立仅首次两有界场景及物理核对另见review/final-review.json，不外推全16路实TCP、GUI、DPAPI、TLS或生产；原旧5005／676各为历史阶段证据。

新团队审核／首纯技术管理员的原4写＋1preview保持，不设置购买先后、业务资料或财务特权。旧预览／sharedDB／vault保留，仅metadata／公开methods核对；没有push／main／一键重验／上线。M4仍待决策及验收，M5／完整Goal继续active。

本轮用户另已确认下一片订单政策：本团队技术管理员可看金额、创建续费／增购席位订单，不授审计资料；未到期从原到期顺延、过期从可信收款确认起算，按北京时间自然年，2月29对应次年2月28同一时刻。只记录决定，本片未实现订单／自然年算法／支付／续费界面；价格、席位容量与折算、退款和购买入口位置仍未决定。下一片接桌面状态／订单续费与可信模拟支付。见[M5C合同](SUBSCRIPTION_MANAGEMENT_EXPIRY_CONTRACT.md)、[订阅决策](SUBSCRIPTION_SEAT_DECISION.md)和`D:/codex-temp/shenyi-subscription-management-expiry-20261118/`。以下保留历史范围。

## 2026-11-18 最新：M5B现有业务数据到期控制候选

`codex/subscription-business-expiry`从`9e47d9a`接续，新增可信`business-data-v1`且仍须严格设备证明。现有17个业务写路由接入：工作区／任务创建、采集提交／退回、正式立项／旧项目迁入、资料／账表／底稿首次导入及分片提交、资料核对／关门／重开／原件维护、底稿版本填写。保留原角色／团队／项目／模块／资源授权，在异步工作后及事务末重验权益和到期，末端失效回滚业务记录。没有新增专业规则或SQL schema。

固定Node24的26份完整相关测试676/676通过，0失败／跳过／取消／todo，exit0、709.797秒。fresh候选1314文件覆盖全部实际selected，before／after字节相同；作者A20、B45和根配置4包含于本门，不累加。独审实际HTTP、时序与原件检查另见证据目录review/final-review.json：三次TCP原run的FAIL均保留，第三run已完成101请求／48运行时验签及业务步骤，仅最后对象原型断言失败；独立39项只读物理核准后另首次timing-only通过，不重演HTTP、不称原run单轮全绿或17路全部实TCP验。旧5005基线不是本片新代码的完整unit或原生验收。

首统一门676项中675pass／1fail：历史69表／209结构重建仍留M5A空层的4结构，实得213。只在该旧test显式调用既有严格peel／restore并剔其已验证空层两键；旧69／209／73／252和全部业务断言、11表helper契约保持，产品代码不改。原FAIL／1314源绑定与字节逆证据保留，第二统一门不覆盖首轮。

查阅、原权导出、历史原件／回执和临时上传取消保持；取消不删除已发布资料。两旧预览／共享DB／vault保留，仅元数据和公开methods核对。没有push／main／一键重验／上线。M4仍待决策及验收，M5与完整Goal继续active。

本轮用户确认到期管理仅允许停用、撤权及原规则下换机／安全处理，邀请／启用／升职／增权须先续费。已写canonical决策，但管理接口／task assignment仍待下一片接线；当前`business-data-v1`不能称全局管理到期控制。桌面状态／主动续费入口、定价容量／年历／退款、订单支付与生产亦未完成。见[M5B合同](SUBSCRIPTION_BUSINESS_EXPIRY_CONTRACT.md)及[订阅决策](SUBSCRIPTION_SEAT_DECISION.md)；证据`D:/codex-temp/shenyi-subscription-business-expiry-20261118/`。以下保留历史范围。

## 2026-11-18 最新：M5A订阅与席位底座候选

`codex/subscription-foundation`从`c21c957`实现可信显式区间事件／head两表、有效业务成员计席及本人状态。纯技术0／获批兼任1，状态不授资料权；严格配置只先接新建采集工作区，body／KDF后和发布事务末重核到期／版本。到期原权历史继续读／导出，其他写出口、年历／价格／容量／退款、续费／支付／桌面界面仍未完成，不能称全局执行。

固定Node24相关12完整文件161/161、0fail／skip／cancel，fresh1308候选覆盖所有selected且before／after同。独立新3完整文件39/39；首真实TCP64请求／28签名通过，第二时序harness修装载顺序后只复验未完成部分，原FAIL保留，不重跑绿场景。首run无before.sqlite，不冒称物理双库；schema86／346保旧84非空typed行／UUID／原件／freeze。此前5005仅旧代码基线，本片未重跑完整unit／browser／原生。

M4转待决策与验收，尚未完成，不开放未确认模块；当前唯一实现M5A，M5整体继续。旧预览／共享库保留，未push／main／一键重验／收款／上线，Goal active。见[范围合同](SUBSCRIPTION_FOUNDATION_CONTRACT.md)、[已确认政策](SUBSCRIPTION_SEAT_DECISION.md)和`D:/codex-temp/shenyi-subscription-foundation-20261118/`。以下保留历史范围。

## 2026-11-18 最新：完整可移植单元严格门通过，订阅政策已确认

`codex/m4-portable-regression`从`5e2e4d1`执行原固定Node24 `scripts/test.mjs --unit --strict`单轮，281完整文件全部5005/5005，0fail／skip／cancel／todo、exit0，2475.797秒。1155运行／测试源门前／门后／current同；原runner、旧测试、工作因子和product无改。独立复核原TAP各层plan／总footer、原进程终态与源绑定，不重跑全量或叠加历史计数。63浏览器整文件按原规则排除，本结果不代表完整browser／原生／生产验收。

即时1155源映射只覆盖279／281所选测试；另外2份quota测试遗漏已披露，以更早独立rawSHA＋Git基点／当前逐byte核同，另有开跑后11秒325项哈希旁证；不补造原1157即时before。见`source-binding-supplement.json`，后续采集须先断言选择集合完备。

用户已确认席位只计启用业务成员、纯技术admin不占席、兼任只一席；到期暂停新增／修改，已授权历史按原权查阅／导出，保留主动续费。[订阅决策](SUBSCRIPTION_SEAT_DECISION.md)及需求7.1已更新，M5仍planned、未实现收费；其他商业细则仍分别确认，不阻断不依赖它们的合成原型。报告原问题待答。

旧预览和共享库保留，仅元数据／公开methods核同；原OS门前提未变不重试，canonical ZIP缺口及共享／一键、Mac、发行／TLS／商户／国内上线仍未通过。未push／main／一键重验／上线，M4／Goal active。证据`D:/codex-temp/shenyi-m4-portable-regression-20261118/`；以下保留历史范围。

## 2026-11-18 最新：账表快照被动数组边界修复

`codex/ledger-passive-arrays`从`63d19d2`修复已记录P3：直接对象create／serialize现在拒绝自定义／null数组原型与Array子类，继承toJSON／getter不得执行；仅1个判断变化，不改格式、算法、限额、权限或正常输入／映射SHA。正常JSON／IndexedDB利用可达性仍未证，不称远程高危。

新增同10断言原码2pass／8fail→修后10/10；五完整相关文件58/58，独立五文件53/53（含原外部3与两真实browser），均0失败／跳过，分别计数不相加。1155源门内同，原1154仅codec改1、新test1，其他1153保持；实际旧端15358B合成快照在新旧codec逐byte及两摘要一致。详见[进度](../进度.md)及[快照合同](LEDGER_CHECK_SNAPSHOT_CONTRACT.md)。

原63 browser严格门仍缺固定SHA原始ZIP，当前344＝281＋63只为发现，未跑完整unit／strict；后续补冻结候选全量unit。OS门工具前提未变不重复，两旧预览／共享库按用户决定保留，仅元数据和公开methods核同。报告及M5细则原问题待答；未push／main／一键重验／上线，M4／Goal active，M5 planned。证据`D:/codex-temp/shenyi-ledger-array-prototype-20261118/`。以下保留历史范围。

## 2026-11-18 最新：同库四模块组合隔离回归通过

`codex/cross-module-isolation`从`93d2708`接续M4，新增合成单库W/Q四模块非空组合回归，无产品／旧测试改动。最终v4完整9/9由作者和独审分别通过；先前三版同组绿门的断言盲区已纠正并保留原稿，不累加次数。四种单模块及逐域撤read、公共拒绝和正向／发现投影、原件及既有freeze保持得到有限矩阵证明，不能扩大为所有权限组合。

两实际TCP场景作者及独审各240请求／112验签；各111 GET空body摘要独立复算，1 POST仅已签摘要头。独审4库／8包及4220物理断言通过；6 raw404正文精确，17 wire404头核准，typed404正文未保存。正常main-client＋内存Ed25519／loopback，不代表GUI、DPAPI、TLS；clearSession不称logout。root核49＋58项证据SHA与1154源同（旧1152无改）。runner仅发现343＝280＋63，未跑完整unit／strict。

两旧预览保留，仅元数据和公开methods与前项检查点核同，本轮无CUA或oldDB／vault操作；共享库未升级，既有OS包Open／Save门仍未通过，工具不变不重试。报告授权及新问M5席位／到期细则待答；M5未启动。未push／main／一键重验／上线，M4／Goal active。证据`D:/codex-temp/shenyi-cross-module-isolation-20261118/independent/final-review.json`；以下保留历史范围。

## 2026-11-18 最新：真实OS尝试保全，本关未通过

从`705bcab`接续M4，在全新正常Windows候选中实际选入来源JSON，1945B／SHA及WQ持久一致；随后底稿包原生框控件缓存512失效，重绑后同错，按保护规则停止单次尝试。包Open未完成、Save未到，底稿五表及迁入／导出0，不能声称OS pair通过。exec exit1且外部driver清理末尾disposed报错，root已补核5自有PID／4667关闭及停机只读快照；73项物理断言仅核partial事实，1152源未改。

两旧预览继续保留；工具初错捕旧图已排除，未向old输入／请求激活或读DB／vault。记录器首段PNG缺口与来源UIA／actions、未正常logout分别披露。前提未变不自动重试；未push／main／一键重验／上线，M4／Goal active，报告待原答复。见[实际边界](NATIVE_OS_FILE_DIALOG_ACCEPTANCE.md)及`D:/codex-temp/shenyi-native-os-dialogs-20261118/`。以下保留历史范围。

## 2026-11-18 最新：员工邀请历史分页

`codex/employee-invitation-pagination`从`ad421a0`接续M4，邀请列表可按每页最多50条前后查询；两来源稳定seek、账号／团队游标锚点和逐页权限核验，仍仅掩码、低权限员工定向邀请，无真实SMS。界面当前页／一次性码／关闭重开与context清理、单次创建／撤销已覆盖；跨来源同ID及pending写入切团队问题经审查纠正。

独立13完整文件249/249、零失败／跳过、76695ms；52新项包含于总数。1152源门内raw同；收口仅新API测试EOF去2B、原断言29项复验，最终1151raw同＋1纯格式，旧1149仅5product＋旧expected null共6路径变化；UI有已披露EOL机械变化，非目标raw未宣称同。真实TCP21请求逐项对照／5业务签名带完整query重核，撤权分页404，194实际依赖同、自有服务关闭。均不是原生Win/Mac发行验收；342文件仅runner发现，未跑完整strict。

两旧预览按用户决定保留，root仅进程／窗口／公开methods前后核同，未操作UI／DB／vault或升级共享库。未push／main／原一键重验／上线；报告待原答复，M4及完整Goal active。详见[进度](../进度.md)、[分页合同](EMPLOYEE_INVITATION_PAGING_CONTRACT.md)和`D:/codex-temp/shenyi-invitation-pagination-20261118/independent/gate-result.json`。以下保留历史范围。

## 2026-11-18 最新：正常Windows资料回执验收

当前资料回执修复已在全新正常Windows候选首轮standalone exit0实跑：正常账号／DPAPI／创建及来源核验／UI五权，import与add自动fresh后回执10／13字段对真实持久事件一致；commit／add各一次、无回执GET补救。撤read后清正文详情，typed GET404；3原件加55B后4份，历史保持。

257 HTTP／120运行时验签、7库／4图及147物理断言经独审；完整字段由真实DOM＋DB证明，02图仅部分import、03图为原件区。671运行/helper和1149旧源保持，本轮未改产品、未native测其余四动作或故障／race、未重跑113／全量strict。原预览与共享库保留；未push／main／一键重验／上线，M4／Goal active，报告待答。详见[进度](../进度.md)及D:/codex-temp/shenyi-native-material-receipt-20261118/independent/final-review.json。以下为历史范围。

## 2026-11-18 最新：资料操作确认回执反馈修复

资料操作已确认成功后，自动刷新不再无意清空回执：fresh同scope、设备与读权／版本稳定才恢复详情；503／429等未知只保完成状态和原编号，硬拒绝／关闭／切换／ABA退役旧反馈。覆盖导入、核对、关门／重开、原件新增／移除，未改专业规则、服务端或手工历史回执语义。

固定Node24独审7完整文件113/113，外部硬拒绝9/9另计；20新增已包含于113，旧码同断言真实10RED保留，初版两测试错误已纠正留证。仅JSDOM，非当前原生或完整strict。1148旧源仅1产品改／1147同，两旧预览及共享库保留；未push／main／上线，M4／Goal active，报告权限待原答复。详见[进度](../进度.md)及`D:/codex-temp/shenyi-material-receipt-20261118/independent/final/final-review.json`。以下为历史范围。

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

证据根`D:/codex-temp/shenyi-device-heartbeat-quota-20261118/`：`root-evidence-audit.json`、`root-new-final.tap`、`related-gate/final-candidate2/`；独审及三组闭环见`D:/codex-temp/shenyi-native-readiness-20261118/design-review/final-review.json`与`capacity-preflight/ui-real-client-candidate2-final-with-office.tap`。范围合同见[设备会话合同](DESKTOP_DEVICE_SESSION_CONTRACT.md)与[底稿界面合同](WORKPAPER_UI_CONTRACT.md)。

以下保留前项记录及其当时范围。

## 2026-11-18 最新：合成团队库离线备份／恢复演练

`codex/team-offline-backup`从`45e5f9b`接续M4，新增[离线备份与恢复工具](TEAM_OFFLINE_BACKUP.md)。指定只读合成源、新UUID备份／恢复目录、完整schema与全表typed摘要／原件哈希和最终独占发布已实现，真实CLI三流程已验；没有增加在线恢复、业务数据权限或专业动作。

最终两完整文件26/26、零失败／跳过，1036相关源前后保持；4套非空业务的12库经root Python只读交叉核验，独立9项证据审计通过。标量UUID、失败发布、最终目标变更与WAL副本附档问题均有原失败及修后复验。备份含历史凭据及权限且未加密，只供离线核验，不能直接当生产恢复；Mac／ACL／加密／可信撤销重放与正式切换另验。

旧审核与新候选预览保留，实际共享库未读／未升级；本轮桌面入口未重跑，相关源码保持。未push／合入main／上线，M4和完整Goal active。下一报告授权已询问、尚待答复，其他外部与专业关卡继续保留。证据根`D:/codex-temp/shenyi-team-backup-20261118/`，完整范围见根目录进度。

以下保留前项范围。


## 2026-11-18 最新：旧预览保留，独立候选入口已验

`codex/isolated-team-preview`从`3694916`接续，新增[独立合成候选入口](ISOLATED_CANDIDATE_PREVIEW.md)。新cmd已实跑并保留“ac503898”登录窗口；旧审核窗口／实际共享库／旧vault不迁移、不关闭，两原cmd未重验。每次全新数据与设备密钥，不自动续用。原生早期缓存串默认目录及隐藏窗口的首轮失败保留，修后以受控CLI从进程出生隔离，实际main／GPU／network／renderer均落新目录。

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

实际共享库仅作只读备份与隔离副本预演，尚未升级，本轮原一键未重验；未push／进入main／上线。M4和完整Goal active。下一步补完整browser strict、最新Windows原生独立复核、实际OS选件／保存、实际共享库升级保全及两原一键重验、M4P整体独审与其余M4模块；Mac、安装更新、最大容量及真实供应商／客户／生产仍未验，专业复核／新冻结／重开仍待米老师。见[正常底稿桌面合同](WORKPAPER_UI_CONTRACT.md)。

以下记录保留其历史阶段范围。

## 2026-11-17 最新：桌面主进程与私有文件流程

M4Q已接桌面主进程typed client及私有文件工作流：设备签名／server UUID／窄响应门、完整包native picker与Worker核验、同ID分块迁入／显式续传／未知结果原回执；read && export下流式临时落盘、ZIP实际CRC／SHA／冻结绑定、最终核权及实际发布目标复核。真实createTeamClient到严格服务端的迁入／原表／填写CAS／回执／导出已测，但尚未注册正常底稿IPC与UI。

固定Node24相关门62文件1100/1100通过，零失败／跳过／取消／todo，848.765秒；1252候选文件运行前后raw一致，TAP连续编号／plan／footer及exit0核对。包括本轮129例（API24、实际main-client4、迁入26、transport13、落盘51、发布11）及前项服务端／实际Chrome原表解析、旧client／设备／账表／来源／资料导出／受信HTTPS／135-RPC兼容；不是完整严格门或正常底稿UI／真实OS对话框验收。证据根D:/codex-temp/shenyi-workpaper-desktop-client-20261117/。

关键代码由其他作者独立复核：API31/31（158范围文件）、迁入与Worker28/28（187）、导出／落盘79/79＋4/4（619）。root已核28／49／29工件、原始TAP／命令exit及当前直接文件与范围哈希。发现的4项P2均修复并按原事实复验关闭，旧失败／BUG复现保留；作者自身代码未自验成独审。范围不扩大为正常IPC/UI、OS原生、Mac、最大容量、M4P整体、完整M4Q或Goal。

实际共享库未打开／升级，本轮一键未重验；未push／进入main／上线。下一步接正常底稿IPC、页面权限／来源／版本原表／填写与回执／导出，再做完整严格门、相应原生与剩余独审。M4和完整Goal active，专业复核／新冻结／重开仍待米老师。见[桌面主进程合同](WORKPAPER_DESKTOP_CONTRACT.md)。

以下历史记录保留各自阶段范围，当前状态以上述为准。

## 2026-11-17 最新：团队导出服务端及有界独审

M4Q服务端已接read && export固定已保存版本的独立团队ZIP导出，保留该版本填写、逐引用MIME、原件、既有冻结和首次迁入清单／SHA。预检与传输中复核权限、租约、来源和head，失败中断，不替换版本。只包含所选版本，不支持团队包再迁入或完整历史恢复。正常桌面导入／原表／保存／回执／导出发布仍待接入。

固定Node24相关门47文件828/828通过，零失败／跳过／取消／todo，642.016秒；1234候选文件运行前后raw一致，连续TAP／plan／footer与exit0核对。包含本轮24例、原HTTP及前序权限／迁入／原表／实际Chrome四型解析／填写／设备／schema兼容；不是完整严格门或正常桌面／原生验收。证据根D:/codex-temp/shenyi-workpaper-export-20261117/。

本轮导出及新增路由／HTTP流式转发已由独立agent有界验收，原24例及额外探针和真实TCP／Python ZIP核验分别记录，root已核对原始证据与当前文件哈希，未解已确证P1/P2为0。前序基础授权／完整包迁入／Office准入也已补独审：146/146、实际Chrome9/9、额外3/3，原TAP与36证据文件／22直接源绑定均已核对；原填写独审仍保留其59/59＋Chrome14/14范围。不得扩大为M4P整体、正常桌面、完整M4Q或Goal验收。

实际共享库未打开／升级，本轮一键未重验；未push／进入main／上线。M4与完整Goal继续active，后续完成正常桌面、相应原生／完整严格门和剩余独审；专业复核／新冻结／重开仍待米老师明确。详见[团队导出合同](WORKPAPER_EXPORT_CONTRACT.md)。

以下历史阶段记录保留其当时范围，当前状态以上述为准。

## 最新：填写CAS与不可变版本检查点

M4Q已接入服务端原件准入后的填写CAS：当前read && write、active项目、设备签名／单会话租约，正文前固定授权／来源和head stamp，线程后及提交内重查。只改准入的answers／docAnswers叶值及原人工修订来源标记，原件、原Q、索引、旧历史和冻结保持；允许未冻结的其他工作表继续按权填写。已授权非负责人也可保存，owner本身不补授两权，不能跳过首次核验迁入。

head条件更新和一条不可变entries版本在同一事务完成，精确两笔业务写入；例如version1／record.rev7→version2／record.rev8。永久操作ID、本人原回执、未知响应不重发POST；无变化、超限、旧／预测未来版本、撤权／ABA／重登录、并发及COMMIT故障均不得留下部分结果。原冻结校验器使用经本项目实际字节／SHA证明的元信息视图适配存储引用，不能用该视图读取或导出二进制，原Governance标准不改。

固定Node24按41文件最终798/798通过，0失败／跳过／取消／todo，583.859秒；1227候选源before／after raw一致，连续TAP／plan／footer及exit0核对。四类实际原件、独立双权、冻结及独立可写范围、原型键、32MiB输出边界、原件／旧版本／人工来源及故障回滚包含在内；旧原表／实际Chrome四型解析对照、导入／授权／来源／账表／角色／成员／设备／schema兼容同时执行。不是完整严格门、真实跨进程／TCP、正常桌面或原生验收。本次填写保存链路已完成独立安全／数据复核，范围及自行执行证据以独立报告为准，前序未独审范围不自动通过。

证据根 `D:/codex-temp/shenyi-workpaper-cas-20261117/`，见[填写CAS与历史版本](WORKPAPER_ENTRIES_CONTRACT.md)。实际共享库未打开／升级，一键未针对本轮重验；没有新schema／全局体积扩容，dist／desktop／shared产品源保持。未push／进入main／上线，M4和完整Goal继续active。后续接团队read && export及正常桌面保存／回执交互，再完成相应原生、完整严格门和剩余独审；专业复核／新冻结／重开仍待米老师明确。

以下历史记录保留各自阶段范围，当前状态以上述检查点为准。

## 最新：原表解析、字段准入及授权查阅检查点

M4Q已新增原表解析、字段准入与独立read查阅服务端候选。按项目／版本核对原包、实际内层路径及Office SHA；XLSX／XLS复用现有引擎和原版式，保护公式、链接、数组、隐藏行列／页、合并锚点及冻结；Word复用完整旧Office读取和原段落／表格模型。字段来自原件，不把进度统计清单误当编辑权限，原件和保存记录不写回。

固定Node24按36个相关文件，最终756/756通过，0失败／跳过／取消／todo，483.969秒；1217候选文件before／after raw一致，连续TAP、plan及footer／exit0核对。原完整包导入、三权／来源／账表／项目／职级／成员／设备／schema兼容同时执行；新检查覆盖实际线程完成点撤权／重登录／正常释放对照、伪造index、补充原件、冻结与只读额外写回滚。

真实Chrome与Node对同字节合成XLSX、含实际BIFF公式／数组／隐藏行记录的XLS、DOCX及旧DOC进行对照，原值／Word模型及字段ID一致，原文件SHA保持、无pageerror／远程请求。此为解析器对照，未代替正常桌面、TCP/TLS、原生或真实业务模板验收。证据根 `D:/codex-temp/shenyi-workpaper-entries-20261117/`，见[原表解析与字段合同](WORKPAPER_FORM_CONTRACT.md)。

本轮只增加按权GET原表接口，没有新schema／全局请求体扩容或专业规则动作。实际共享库未打开／升级，一键入口未针对本轮重验；未push／进入main／上线。根检查与完整严格门、独审分别记录；独立agent仍受已知额度限制待补，不以root代替。M4／完整Goal继续active；下一步使用现有服务端字段准入接read && write下填写CAS和不可变追加版本／原编号回执，再接团队导出及正常桌面。

以下历史检查点保留各自阶段范围，当前状态以上述记录为准。

## 最新：首次导入与不可变版本1的服务端检查点

M4Q完整底稿包首次团队导入、不可变版本1、按权查阅记录／原件／历史与本人原回执已接服务端候选。首次导入须已有W→Q或已审核旧Q来源、owner及明确read && write，负责人核验来源并验证当前密码；正文、KDF、实际摘要与提交期间重新核验当前授权／来源／租约。取消不能回滚已发布版本，未知响应只查原编号；原ZIP、保存rev与既有冻结快照保持。

固定Node24按27个相关文件，最终683/683通过、0失败／跳过／取消／todo，434.219秒；1203候选文件before／after raw一致，连续TAP、plan及footer／exit0已核对。旧授权／来源／账表／项目／成员／职级／设备兼容同时执行。隔离库新增5表／17触发器／1索引（23定义）至84表／342定义，原79表／319定义全部typed行（含auth）与UUID保留；异常／非空新层禁止历史投影，3份旧测试适配逐byte逆变换通过。

此前Chrome正常旧index实际下载的5984字节合成包，按原SHA经已审核旧Q迁入，在真实签名Request应用边界逐byte读回原JSON和2份原件，保留rev7／1份冻结快照，只有1个发布版本、临时块清空，旧资源typed行保持。另测实际超过1MiB两块包、逻辑2×530MiB预留及第三份拒绝；不称最大容量压力验收。证据根 `D:/codex-temp/shenyi-workpaper-data-20261117/`，详见[首次导入与版本合同](WORKPAPER_DATA_CONTRACT.md)。

本阶段仍是root相关检查，不是完整原严格门、TCP/TLS、正常桌面、Windows原生或独立验收。实际共享库未打开／升级，一键入口未针对新增数据层重验；未push／进入main／上线。独立复核受既有额度限制待补，不以root代替；M4与整个Goal继续active。下一步接原表可编辑字段与公式／链接／隐藏／只读保护，再做填写CAS、团队导出和正常桌面；专业复核／冻结／重开仍待米老师明确。

以下历史记录保留各自阶段范围，当前状态以上述检查点为准。

### M4Q最新：完整底稿包旧端导出

M4Q完整项目底稿包及旧版显式导出已接候选：保留原 ZIP、已保存填写、补充底稿原件及既有冻结快照，按底稿白名单排除报价／合同／发票／报告／账表等模块；旧版正常底稿页提供“导出已保存完整底稿包”。原冻结校验沿用，保存版本、原件字节／MIME和原项目Q保持，试用保留UUID明确拒绝。团队端首次导入、实际原表查阅／填写CAS／导出与正常桌面仍待接入；不以旧端导出代替完整M4Q完成。

固定Node24按18个相关文件，最终320/320通过、0失败／跳过／取消／todo，43.015秒；1189候选文件before／after raw一致。真实Chrome旧正常index实际下载，并由Node和Chrome双向读回；逐库typed行／结构及全部Blob哈希保持，1次下载／1次URL创建释放、0业务写入／计算。1280×900和900×900均已复看，最终图与早先已看图逐byte同SHA，无横向溢出；来源同rev填写／编号／立项变化和页面失效拒绝发布，独立试用按钮禁用。上述为root相关门，不是完整严格门、Windows原生或独立验收。

前项M4P及本项授权基础的独审仍待额度条件恢复，不因root通过改判。包层没有新增HTTP／schema／IPC，实际共享库未打开／升级；团队一键入口未针对本轮重验。未push／进入main／上线，M4及完整Goal继续active。详见[完整底稿包合同](WORKPAPER_PACKAGE_CONTRACT.md)；证据 `D:/codex-temp/shenyi-workpaper-package-20261117/related-final/related-report.json`。

下列授权基础和M4P记录保留其各自检查范围。

M4Q底稿团队接入进行中。用户已确认负责人验密后，分别为自己或本项目经理／合伙人配置查阅、填写、导出，填写／导出须同时有查阅；完整项目底稿包由旧端显式导出，负责人核验原ZIP、已保存填写及冻结快照并验密后首次导入，后续团队内版本保存。服务端授权基础已实现并通过root相关507/507门（0失败／跳过／取消／todo，353.500秒），1181候选源在测试期间raw保持；不是完整严格门／原生或独立验收。实际底稿包、读取／填写CAS／导出及正常桌面尚待接入，专业复核／冻结／重开规则仍待米老师明确。详见[底稿授权合同](WORKPAPER_ACCESS_CONTRACT.md)和[用户决定](WORKPAPER_ACCESS_DECISION.md)。

当前分支 `codex/workpaper-access`，base `af0c942d53520bcf6ad36dddc8eb723fb65fc4e0`；前项M4P仍待独立复核，未被标为完成。只在隔离库验证79表／319定义及旧77表／290定义保全；未触碰实际共享库，本轮新增授权未做原生一键重验。未push／进入main／上线，M4和完整Goal仍active。

## 前项M4P：root已验，独立复核待补

M4P账表校验只读接入进行中：用户已确认先只开放查阅，运行以后再定；旧版显式导出快照，由项目负责人核验并验证当前密码后导入团队，只供查阅，不写底稿。账表快照已接正常团队页面和12项窄IPC，提供独立项目列表、明确读权、来源核验导入、历史只读展示及本人原回执查询。当前正常界面、Windows原生、986项定向、4324项完整可移植单元严格门、旧8组原生兼容及两原一键／共享数据保全均通过root检查；独立复核仍待完成，不作M4P整体验收。

最新root检查：原Node24 `scripts/test.mjs --unit --strict` 4324/4324通过，0失败／跳过／取消／todo，1889.031秒；连续TAP／plan／footer及exit0已复核，226文件选入／61整browser粗排除，1168源before／after／当次current raw保持。旧8组Windows原生兼容270.079秒通过，48处外部精确适配可逆重建原bytes、原业务断言调用数不变，实际新增层另行核验；不与986专题门或前序计数累加。普通／审核两原cmd的实际窗口、health和设备协议均当次可达；两共享库实际升至77表／290定义，旧73表／252定义全部typed行（含auth无豁免）、9／16账号及两固定UUID保持，4张新账表表为空。原审核预览已恢复打开；最后活性为当次观察，不承诺持续存活。证据根 `D:/codex-temp/shenyi-ledger-check-acceptance-20261117/`；独立复核不豁免，未push／进入main／上线。

正常界面本轮root入口／UI相关门797/797通过、0失败／跳过／取消／todo，172.844秒；新增22项包含在其中。测试时1164候选文件before／after raw保持。原123项入口和22form／27密码固定基线保留，唯一新增12项／两form／两密码，当前135RPC／24form／29密码；43份旧检查仅精确名单投影和计数层适配，87项首段表达式及4项静态后续表达式／导入均可从原字节完整重建，其他字节与业务断言保持。变体门拒绝未授权增删／改序及额外表单／密码放宽。首轮794项740pass／54fail为数量冲突，适配后791pass／3fail中一项实际发现模块未加载时全局改密退出未清新增密码，已修复；另两项静态适配未落盘。部分修补中止后误启动的验证明确中断并留证，74项前提门通过后才执行本最终门。见 `D:/codex-temp/shenyi-ledger-check-ui-20261117/ui-compat-verified-final/api-report.json`、`entry-adapter-final-verification.json`及保留失败／中断日志。

正常Chrome完整流程已通过并复看截图：实际HTML／CSS／preload／主进程桥、真实TeamClient及签名Request／隔离SQLite，自授读权→来源核验→追加导入→历史只读→关闭清理／重开；1280×900及900×900无横向溢出，原HTML字符串不执行。源文件SHA和规范JSON保持，26张原资源表typed行保持，一笔导入POST／一份版本，无计算引擎资源或pageerror。主frame与picker为注入fixture，团队后端未用TCP/TLS，不称Electron／OS／Mac／独立验收。最终报告 `D:/codex-temp/shenyi-ledger-check-ui-20261117/browser/run-2026-11-17T05-18-52-108Z/report.json`；首轮过时侧栏文案已修，旧图／报告保留。

桌面主进程基础阶段root相关门150/150通过、0失败／跳过／取消／todo，104.532秒；新28项包含在其中，不与历史门相加。测试时1156候选文件before／after raw保持。真实TeamClient＋签名Request应用边界／隔离SQLite／D盘合成文件验证18MiB快照、哈希及响应头、独立读权、撤权／账号切换／取消／旧错误、受信服务预检、选取预检与私有字节绑定、错误Q／超限／读取失败、在途关闭及未知回执不重发；原客户端、设备、材料、资料保全、业务确认和立项来源相关检查一并通过。原生对话框为fixture，未做OS窗口／真实网络／Mac／生产验收。首轮新27项25pass／2fail为查询fixture误带版本字段，接口拒绝不放宽；另有metadata-retire-before.tap真实复现旧元数据错误会暂停后开的有效面板，修为四类读取捕获查阅代次后通过本门。证据：`D:/codex-temp/shenyi-ledger-check-desktop-20261117/client-related-final/api-report.json`。该主进程基础阶段无新HTTP／schema／IPC，未打开共享库，不改原专业算法；独立复核仍待额度条件解除，不以root代替。

服务端阶段root相关门392/392通过、0失败／跳过／取消／todo，211.656秒；测试期间1150候选文件before／after raw保持。覆盖真实设备签名Request、独立查阅权、无继承授权、负责人密码导入、W→Q及旧Q归属、版本／操作回执、body／KDF撤权ABA、只读／导入额外写回滚、大文件预检及并发限额、旧权限／停用／设备兼容。隔离库新增四空表／38定义至77表／290定义，旧73表／252定义及typed行／UUID保持；四类孤儿账表历史均禁止重建服务器身份。两份旧schema测试只增加显式四空表／38定义层，保留固定历史基线及旧断言。证据：`D:/codex-temp/shenyi-ledger-check-server-20261117/backend-related-final/api-report.json`。首轮相关385项为382pass／3fail，拒绝码断言过窄和两处旧schema数量固定，原失败完整保留；定向75门曾通过，随后补身份历史保护后运行本门。以上不是完整严格门、正常桌面或独立验收；独审额度限制仍待解除，不绕过、不替代。

新快照基础含28项核心／真实Chrome往返检查，连同原勾稽26项相关门共54通过、0失败／跳过／取消／todo；原自动校验专项另有5项通过。两次运行时原1132文件raw保持，之后只更新本项文档；未重跑完整4214门，不把专题累加成完整回归。独立复核仍待完成，不以root检查替代。

旧端导出阶段兼容相关门139/139通过、0失败／跳过／取消／todo，56.156秒；该门1139候选文件before／after raw保持。真实正常旧index完成下载及编解码读回，全部库typed行／DDL及原件SHA保持；无保存结果、未保存输入、版本／同rev内容／立项／固定身份／关闭上下文变化拒绝，旧归属来源仍逐byte一致。20种loader篡改均被原固定hash守卫拒绝，两份旧测试仅精确loader例外及Chrome环境入口适配，原断言和固定hash未改。以上是root检查，不是M4P独审或完整软件验收。证据：`D:/codex-temp/shenyi-ledger-check-export-20261117/related-after-adapters/related-report.json`、`loader-guard-mutations.json`及原日志。首轮真实页面把编辑触发的既有操作计时混入全库保全，8pass／2fail；拆分独立输入拒绝后新browser 11pass，随后补旧来源兼容进入最终139门。首轮related 133pass／2fail为旧loader守卫及缺默认Chromium，修后原门全部执行；早期失败保留。

继续同一M4P：正常页面、窄IPC和只读链路已接候选，下一步补独立复核及其发现问题的修正；其他M4模块继续按原路线逐项推进，并按实际问题补齐；独立额度限制不取消验收。运行、映射保存及底稿写入继续关闭，Mac／生产及双方业务签收单列，既定来源和权限决定不重复询问。 见[实际服务端合同](LEDGER_CHECK_SERVER_CONTRACT.md)。

证据根 `D:/codex-temp/shenyi-ledger-check-discovery-20261117/`，见 `snapshot-related-report.json`、`legacy-baseline-verified-report.json`。未push／进入main／上线；本轮两原cmd的窗口／公开设备协议已实测，范围以最新检查点为准；M4整体和完整Goal保持active。见[当前合同](LEDGER_CHECK_SNAPSHOT_CONTRACT.md)及[权限／来源决定](LEDGER_CHECK_ACCESS_DECISION.md)。

## 最近已验功能：M4O

2026-11-17用户决定：首版暂不开放产品负责人等最高审核账号的密码找回及换机恢复，具体线下处理规则后续另定；现有普通流程继续拒绝这些身份。不再把该能力作为首版待实现项；员工和团队管理员的已确认恢复／换机规则沿用。详见[首版范围决定](PRIVILEGED_ACCOUNT_RECOVERY_DECISION.md)。

M4O立项来源独立授权、查阅及规范JSON保存已实现，分支 `codex/workspace-source-access`，实现基线 `5b855c7`，范围见[实施合同](WORKSPACE_SOURCE_ACCESS_CONTRACT.md)。负责人验证当前密码，为自己或本项目有效经理／合伙人分别配置read和export；执行保存必须read && export，01可独立存权但不补授read。覆盖W工作区业务确认来源及旧Q迁入来源；旧自动回执无read时只显示一般已确认状态，unknown保留原查询编号且不重发POST。职级、owner、技术管理员、资料清单权均不自动获得来源权，不构成现实中标查证、最终项目金额或专业审计签发。

Windows正常入口12场景／7PNG／148依赖及独立原生产物复核已通过：正常W创建、原件上传和业务确认、Q审核迁入后的正常查阅、负责人逐项授权、source-only非负责人入口、AND四组合、W/Q原规范JSON逐byte保存、held Save撤权／取消零发布、真实rename后结果未知不重试均有证据。服务端51、client93、UI34及各独立专题通过；这些组存在重叠，不与完整回归相加。旧8组strict原生兼容一批通过，265.265秒、577源及原始输入保持；97份旧验收适配／8阶段125条转换链已独审，旧历史66/189、69/209、70/217均真重建，早期失败和P2修前证据保留。

原固定Node24 `scripts/test.mjs --unit --strict` 最终门：PASS；tests 4214／pass 4214／fail 0／skip 0／cancel 0／todo 0，TAP 1773861.365 ms、inner wrapper（Date.now） 1770471 ms、outer wrapper 1774860 ms；215 selected／59整browser粗排除，1022源before-after-current raw状态 一致。最终报告 D:/codex-temp/shenyi-workspace-source-access-20261117/full/full-audited-report.json；TAP SHA-256 217ac227106debb9386545dab0eb729eaa6b111a54dd55b76eab7714929fa7b5；独立完整门复核 D:/codex-temp/shenyi-workspace-source-access-20261117/independent-full-review/review.json。计数来自最终连续TAP/plan/footer与源清单，不采用途中计数。

四次实际只读在线备份及独审保留原71表223定义、全部typed行（含auth，无豁免）、9／16合成账号和两UUID；升级后73表252定义，仅新增2表／26trigger／1index，两来源表空。两个原cmd入口当次真实窗口、health及设备协议可达，不宣称持续存活。1108原文件51,358,212B和13处既存CRLF前件保留；范围预审为115旧改＋23新、993原raw保持，业务公式、原编号／Q-W及历史原件不变。证据根 `D:/codex-temp/shenyi-workspace-source-access-20261117/`，原生／兼容／共享及范围独审分别见 `independent-native-review/review-final.json`、`independent-compatibility-review/review.json`、`independent-shared-final-review/review.json`、`independent-scope-review/report.json`。

本地交付状态 windows_local_candidate_technical_verified；实际commit与最终门禁以外部 `D:/codex-temp/shenyi-workspace-source-access-20261117/final-delivery.json` 及Git为准，不预填未来SHA。未push／进入main／上线。M4整体及完整Goal保持active，其他专业模块逐出口授权／显式迁入、真实身份与商户／支付供应商、订阅席位、国内域名服务器及备案、Mac／真人picker／真实异机／双平台签名发行和两负责人业务签收仍按独立关卡推进。本片不代替这些验收；既有M3E和M4历史原样保留。

## 最近已验交付：M3E本人电脑信息与记录

M3E本人设备自查入口已实现并通过Windows本地候选验收：`codex/my-bound-device`，base `93fb7d1`。正常工作台可查看本人当前绑定电脑、服务端最近在线核验及分页绑定／换机记录；零业务成员也只查本人。117方法／21表单／26秘密输入，旧同步status和换机审批保持。usage仅记录成功设备认证，与nonce／新lease同事务，实际71表223定义；旧70表typed资料／217定义保持，仅新增6对象。合同见[执行合同](MY_BOUND_DEVICE_CONTRACT.md)。

原生actual-main／TLS／OS vault验收8场景、6PNG、7阶段库＋runtime、3vault通过；78B输入、库原件和保存SHA eccb8cd2810adaffe36e3871c47a8a427dacb1feff9f93e7fe9a8f827adf362a一致，1107源在原生当时before／after raw同。真实申请、密码审核、明确激活与旧会话退出已验；32分页事件是人工夹具，旧401为网关负例，不冒充真实旧服务响应。四真RO保全部旧typed行／DDL，auth零豁免，新usage空，9／16账号及UUID不变；两原cmd当次实际窗口与公开设备协议可达，正常关闭无force并记录review窗口保留，不把当时观察写成持续存活。原生／共享独审见 `independent-final/native-review.json`、`independent-final/shared-after-review.json`。

最终原Node24严格gate 4036/4036，0fail／skip／cancel／todo（1727789.1835ms），205selected／59整文件browser粗排除；1000源before-after-current raw同。新109项已含于总数，不与专题相加。首full真实4030通过＋6失败、0skip／cancel／todo（1688680.0319ms）及1000源当轮raw同证据全留。仅6旧验收精确适配3325B，跨epoch994源同、产品0变；固定Node24原5文件90/90通过（76962.2215ms），Node25的90项单列补充而非门禁。旧8组strict兼容PASS，实际633.734秒，568源与3原始输入前后保持；首default失败及7组未运行不改判通过。

证据：`D:/codex-temp/shenyi-my-device-20261117/`；完整gate `full-rerun/full-audited-report.json`，旧兼容 `compatibility-rerun/summary.json`，六夹具独审 `independent-client-entry/after-root-apply/review.json`，server／UI独审 `independent-server-ui/verification.json`，client／入口独审 `independent-client-entry/review-final.json`，范围独审 `independent-final/scope-rerun.json`，Node24／25边界 `commands/runtime-resolution-correction.json`。完整及兼容独审均已PASS，见 independent-final/full-review.json／independent-final/compatibility-review.json。范围75旧改＋14新，1018原文件raw保持。M3整体及完整Goal仍active；下一仅拟定最高审核账号独立人工恢复的有界合同，不擅自开工；M4立项来源查阅／导出分权已由用户确认，项目负责人验证密码后分别明确授予自己或本项目经理／合伙人；待独立实现，当前专业模块仍关闭，不再重复询问该决定。Mac、真人picker、真实异机／身份供应商、双平台发行和生产未验。未push／进入main／线上发布，未来本地commit以实际Git与外部manifest为准。

上一M3D受信HTTPS集成本地候选已验：`codex/trusted-team-https` 从M4N本地 `6ccfe68` 按[执行合同](TRUSTED_TEAM_HTTPS_CONTRACT.md)及[配置说明](TRUSTED_TEAM_HTTPS.md)接通固定HTTPS origin/预期UUID、秘密前无秘密探测、每响应身份核对和实际桌面入口。完整原Node24严格gate3927/3927、0fail/skip/cancel/todo（1699019.3723ms），199selected/59整文件browser粗排除，988源before-after-current raw同；新98项包含在总数。新Windows实际main原生6case/5PNG/4阶段库＋runtime及独审通过，69B输入/库原件/保存逐字节与SHA3bd88d48cbd4f6abad989ab66cbb3fc53ce99ed3bcce31432bebdfc2a318d767相同，3actor/90profile/1独立OS vault保全；native1087当时before-after-current同，后仅已列说明文档变化，当前产品/测试988仍同。wrongUUID仅3次无秘密methods、无CA为0次HTTP，依据冻结执行断言与事件终态，不冒称有独立actor分界原始索引。旧相关8组顺序兼容631.86秒、563源及3输入保持，四真RO保70表217定义与全部typed行/auth零豁免、9与16账号/UUID不变，两原cmd实际可达。116RPC/21form/26秘密输入不增。2项unknown/迟到logout及1项remote帮助文案P2均有修前Fail→修后Pass；配置/客户端/TLS首次夹具失败完整保留。范围11旧改＋11新增，其余1071原文件raw保持，旧device-entry仅一行dependency适配，无专业规则/DDL更改。仅本地候选与本地提交，以实际Git及外部交付manifest为准；未push/main/线上发布。M3正式部署/供应商、最高owner恢复、设备自查/历史入口和双平台发行仍待；M4专业模块立项查阅/导出授权待答，保持in_progress，Goal active。Mac、真人picker、客户/公开生产及两负责人业务签收未完成。

上一M4N在 `codex/team-material-preservation-export` 从M4M本地 `5cb5256` 完成[团队资料完整保全导出](TEAM_MATERIAL_PRESERVATION_EXPORT.md)及[执行合同](TEAM_MATERIAL_PRESERVATION_EXPORT_CONTRACT.md)的Windows本地候选验收。已有material.read可明确保存当前record及全部历史原件，W授权／Q原业务保持，v2来源未验签、不代表专业签发；旧端只在同Q正式空目标明确恢复，不继承团队权限。完整原Node24严格gate3829/3829、0fail/skip/cancel/todo（1562951.1104ms），194selected/59整文件browser粗排除，979源before-after-current raw同，新157包含在总数。首轮3828pass/1fail（2210旧顺序夹具）全留，单处精确修复及5定向PASS后完整复验；两轮978源互同＋唯一旧夹具差异，不称跨轮979全同。新Windows6case/4PNG/7SQLite/4vault/124profile/717源、旧端browser2/2（含actual原生ZIP）、旧8组、四真RO与两原cmd一键均已独审。116RPC/21form/26秘密、70表217定义不变；范围59旧改+15新增，其余1008原字节保持，15产品源与43旧验收文件90精确适配分别核验。仅本地提交，以Git及外部交付manifest为准；未push/main/上线，M4及完整Goal active。立项来源查阅/导出新授权仍单独待答，只影响后续专业模块。Mac、真人选择器、真实客户/生产和两负责人业务签收未完成。

上一M4M在 `codex/workspace-material-identity` 从M4L本地 `f623571` 按[资料身份适配合同](WORKSPACE_MATERIAL_IDENTITY_CONTRACT.md)与[使用说明](WORKSPACE_MATERIAL_IDENTITY.md)完成Windows本地候选技术验收。W资源授权与Q原业务内容分离，独立五权、原包／record身份／原件历史保持，无新增schema／HTTP／RPC。完整3672/3672、0fail/skip/cancel/todo（1457827.3341ms），188selected／58整文件browser粗排除，966源before-after-current raw同；首轮完整gate为3656/3672、16fail：905项fetch failed的实际端口及cause未确证；2613—2627共15项为旧预览mock缺getProject。原日志与16项失败均保留，本次通过结果取自final-full-rerun，未把失败前件改判成功。两轮各自966源before-after保持；轮间仅经审查的旧测试夹具1处插入，965源相同，不称两轮966互相全同。新86（18＋28＋40）包含在总数。最终strict原生6场景／6PNG／8阶段库＋runtime／4vault／124profile／128源同、2份合法原子保存及撤权heldSave零发布均独审通过；首绿截图的时态文案缺陷及修前DOM FAIL已保留。旧7兼容一批全过（567.563秒），四真RO保70表217定义及全部typed行／auth、9与16账号／UUID；两原cmd重试实际可达，首普通启动pwsh空环境值FAIL及外部v2修正单列。114RPC／21form／26秘密保持。尚未push／进入main／上线；本地commit以实际Git及交付工件为证，不预写未来SHA。M4及完整Goal active，下一单项仍旧六模块权限／显式迁入；Mac、真人选择器、客户业务、生产及两负责人签收未完成。

上一M4L在 `codex/workspace-formalization` 从M4K本地 `50eb465` 按[正式业务确认合同](WORKSPACE_FORMALIZATION_CONTRACT.md)与[使用说明](WORKSPACE_FORMALIZATION.md)完成Windows本地候选技术验收。用户已确认由项目负责人核验已保存来源并验证密码，系统记录为其业务确认；不冒称现实中标自动查证、实时状态或审计签发。完整3586/3586、0fail/skip/cancel/todo（1428133.9451ms），183selected／58整文件browser粗排除，956源before-after-current raw同；新93包含在总数。最终strict原生4场景／5PNG／8库／4vault、旧5按1+4兼容、四真RO及两原cmd一键均通过独审。旧69表typed行／209定义和9/16账号／UUID保持，新增空1表7trigger后70/217；114RPC／21form／26秘密。W/Q分列，原权限、任务、原件和创建回执保持，材料W/Q接入仍为下一单项M4M。未push／main／上线，Mac／真人选择器／客户业务／生产及两负责人业务签收未完成，M4和完整Goal active。

上一M4K在 `codex/collection-workspace-creation` 从 `68c9e27` 接[正常采集工作区创建合同](COLLECTION_WORKSPACE_CREATION_CONTRACT.md)与[使用说明](COLLECTION_WORKSPACE_CREATION.md)，Windows本地候选技术验收通过。经理／合伙人先建未正式立项工作区、显式采集权限、密码／设备复核、单发与永久回执已接通；材料锁定，可信中标后正式化另验。完整3493/3493、0fail/skip/cancel/todo（1284926.5666ms，178选入／58粗排除），944源before-after-current全raw同；首完整3492＋1旧历史夹具失败与严格两插入修复、17项定向及最终整轮证据全保。最终strict原生7case／6PNG／8库／4vault，旧5按4＋1兼容、共享4真RO备份及两原cmd实际启动均通过并独审。69表209对象保全部旧68表typedrows／204DDL及9/16用户／UUID，8材料与新creation表空。109RPC／20form／25密码输入。未push／main／上线，M4与完整Goal active，Mac／真实客户／供应商／支付／生产及两负责人业务签收未完成。

上一M4J在codex/task-submission-preview从dc3d57f接[采集提交预览合同](TASK_SUBMISSION_PREVIEW_CONTRACT.md)和[使用说明](TASK_SUBMISSION_PREVIEW.md)，Windows本地候选技术验证通过。原完整3386/3386、0fail/skip/cancel/todo（1230789.2856ms，173选入／58整文件浏览器粗排除），933源before=after；之后旧driver三处保存定位及README两句已确认决策同步，最终931current raw同，173实际测试／116新native／99安全依赖不变。新增79含于总数，strict原生7case／5图／7阶段库＋实际库／4vault、实际正文／撤权／暂停／跨类协议分层均独审通过；旧相关5按1＋4两批全过，首次locator失败及三处精确修正留证，不弱化原业务断言。四真RO备份及两live保全68表204DDL全部typed行、9/16账号/UUID，两真一键可达并保留review窗口。107RPC／19form24秘密，无新HTTP/schema；本片仅本地提交，未push/main/上线，M4/Goal active。用户已确认先采集后正式立项，下一片接创建，Mac/真人picker/客户/生产及双方业务验收仍单列。

上一M4I在`codex/team-material-maintenance`从12b9213按[维护合同](TEAM_MATERIAL_MAINTENANCE_CONTRACT.md)与[操作说明](TEAM_MATERIAL_MAINTENANCE.md)完成独立维护权及正常新增／移除关联，Windows本地候选已验。完整3307项通过（0fail/skip/cancel，1202017.4653ms，169选入／58粗排除）；严格原生8case／5图／10库／4vault／115依赖及独立37／121工件核验通过，旧21兼容按13+2+6具独审通过证据。原件/历史及全部旧66表189DDL保持，新增两空表/13触发器后68/204；两真cmd可达，账号9/16和UUID不变。927库存运行前后raw同，之后仅README一句最终状态更新，实际测试及产品源保持；两次full尝试与旧native观测失败及精确修复证据保留。未push/main/上线，M4/整体Goal仍active，Mac/生产与负责人业务验收未完成。

上一M4H在`codex/team-material-preview`从feca6cc接[原件安全预览合同](TEAM_MATERIAL_PREVIEW_CONTRACT.md)与[使用说明](TEAM_MATERIAL_PREVIEW.md)，正常workspace→独立受限child已实现，沿read/100RPC，不增form或密码。最终strict Windows原生8case/6PNG/6SQL/110依赖保持、独立安全36及旧20组兼容均通过，原件/专业记录保持且五条ACL精确；两处真实关闭生命周期P2已窄修并实际复验，所有失败/强清测试进程记录保留。两个一键已实际启动且新ordinary正常退出，四RO备份核所有66表/189DDL/9与16用户/UUID不变，六张资料表空。完整可移植3184项全部通过（0fail/skip/cancel，1090212.1051ms；162选入/58整browser排除），915源before/after/current保持；本片Windows本地候选阶段门已完成；Mac/生产未验，未push/main/上线，M4/Goal仍active。

上一M4G在`codex/team-materials-module`从d9c2f00接[团队资料清单模块](TEAM_MATERIALS_MODULE_CONTRACT.md)，[正常使用路径与证据](TEAM_MATERIALS_MODULE.md)已记录。用户已批准owner密码逐项self/授senior、close与review独立；server15、独立正文/安全60、desktop59专题及最终Windows原生4case/6图/6库/4vault/93依赖保持已通过。原生实际覆盖真实旧UI包迁入、独立核对关门、历史原件、unknown单发及撤权零发布；不是只有归属登记或存包。单次完整回归3092项全部通过（0fail/skip/cancel，1042676.3935ms），901源运行前后保持；旧19组原生兼容（11diagnostic+8strict）具独审通过证据；full后只修3旧native父标题定位，当前其余898源及全部156选入/新native93保持，本片Windows本地候选已验；424旧源已备份，原专业规则保持。共享预览只做已验证的加法schema升级，原60表全部行保持、新六表空；未写业务资料或权限、未写生产，未push/main/上线，M4和整体Goal仍active。

# 当前状态与交接

记录日期：2026-11-16。GitHub 地址：<https://github.com/icesad/shenyi-audit-workspace>。

上一M4F `codex/legacy-project-registration` 已按 [M4F合同](LEGACY_PROJECT_REGISTRATION_CONTRACT.md)实现并通过旧正式项目来源及归属负责人审核的Windows本地候选验收。用户已确认由产品负责人审核，只有正常新项目创建路径仍待答。最终完整可移植2958通过/0失败/0跳过、875459.4356ms，758运行/测试源全程稳定；新192包含于总数。独立安全100、来源20、server30、桌面42，严格Windows新原生6case/5图/5DB/4vault及旧18组兼容具通过证据；旧admin时窗首失败/原样复验和partial首次完整命令的旧计数失配均保留。共享4RO备份独审保旧57表127DDL全部row，新60/138，ordinary9/review16仅独立新审核员。两真一键可达；不称客户材料已迁入，不开放一般新项目创建。404原版备份，未push/main/上线，M4/整体商业化仍未完成。

上一M4E `codex/task-originals-export`从M4D本地`74e7b31`接续[正常团队桌面单任务所选原件导出](TASK_ORIGINALS_EXPORT.md)，Windows本地候选已验。完整可移植回归2766通过/0失败/0跳过（818962.8099ms），34源全程SHA不变；独立权限77、核心42/格式44/client13/bridge15/DOM19、真实strict原生4ZIP/6图/5DB/4vault与旧17native兼容通过。81窄RPC/14form20密码，无新schema；两真一键可达、共享ordinary9/review15全部57表127定义及所有行保全。只导出明确所选当前可下载原件与最小清单；本人/项目review权限分开，任一失权整包拒绝，不称完整备份/专业签审，不改项目创建或旧归属政策。首次全量的两旧名单兼容已窄修，原未改HTTP测试首次fetch失败原因未确证，原样复验及最终完整均通过，失败日志保留。M4/完整Goal继续active，未push/main/上线。

上一M4D分支`codex/material-project-preservation`从M4C本地`eb8ac66`接续的[单项目资料保全与本机恢复](MATERIAL_PRESERVATION.md)旧端本机候选已通过：完整可移植回归2556通过/0失败/0跳过（745468.1888ms），11源运行期间SHA不变；独立真实IndexedDB26、结构安全53和界面25项及真实浏览器恢复均通过。保存完整资料清单及所有留痕引用原件（含已移除/旧代），只恢复到同UUID空本机资料区，复用原上传正文准入、不覆盖旧数据。旧页面守卫只严格允许唯一新增script，原固定SHA及断言保留、20突变仍拒。详见[执行合同](MATERIAL_PRESERVATION_CONTRACT.md)及根目录进度；不是完整软件备份或团队迁入。team57/127和70依赖保持，现有一键团队预览可达，新功能从旧端8773进入；团队归属首owner及正常创建选择待答。M4/完整Goal继续active，未push/main/上线。

## 版本不混淆

| 对象 | 内容 | 状态 |
|---|---|---|
| 原站点线上v61 | 共用“暂存”按钮显示改为“保存” | 此前已有成功发布记录 |
| GitHub main | v61应用源码快照 + 本轮协作文档/本机运行工具 | 代码基线；不是新站点发布 |
| work/report-four-sources | 成本侧栏指向实际成本表、报告页四来源编制草稿、仅移除该页TB按钮 | 本机技术测试过；尚未发布原站点/业务终验 |
| 更早自动报价/分页编辑待办 | 原来单独保存的未集成工作 | 未夹带纳入本轮源码，见BACKLOG |

## 本轮 GitHub 建设

- 新建独立私有仓库；未把原 Sites 历史和 `.git` 直接公开/推送。
- 应用基线从原提交 `d4bc1f42b81604f01ec63a6bd74e3573f9c3717f` 导出；未改原工作目录、客户数据或原站点权限。
- 排除实际部署身份、环境文件、运行缓存、QA输出及客户业务原件。陈旧且夹带案例核验细节的旧README/GOAL/BACKLOG未照搬，以本轮清晰文档替代。
- 保留第三方许可证和模板布局；私有共享不等于取得模板公开发行授权。
- 新手教程、跨设备规范、架构、运行测试说明和Issue/PR模板随源码保存。

## 测试证据边界

此前原工作目录：报告相关本机全量734项通过、0跳过；新增报告来源/核心/UI和真实Edge合成流程有专项。这里是既有技术记录，**不能冒充新clone的测试或Mac Safari实机验收**。

新协作目录的实际回归记录另见 `docs/VALIDATION.md`。所有“通过”必须同时记录失败和跳过。缺客户授权原件的专项不上传原件强行补齐。

四来源报告当前只是草稿辅助：没有完成全部客户底稿和可签发报告；上年期末→本年期初及本年期末必须核对来源/单位/映射；缺证据不补造结论。旧目录的完整业务验收、真实格式对照和Mac实机仍待进行。

## 邀请/保护/发布

米老师GitHub用户名尚未提供；本次不依据历史邮箱擅自扩大资料访问权限。仓库邀请以实际接受为准。分支保护及强制审查若未实际配置验证，不能称已启用。

GitHub仓库不替代原网站登录；GitHub合并不自动触发网站升级。原Sites发布通道最近遇到身份工具/连接阻碍，待负责人修复后再发布待验收修改。不要用修改仓库公开性或共享账号来绕过。

## 2026-11-15新增：团队商业化Goal

当前用户授权规划并持续推进团队权限、独立账号、Windows/Mac桌面电脑绑定、团队年订阅及员工席位、后期UI升级、官网和国内上线。米老师负责专业业务，当前用户负责产品应用与商业化。没有域名和阿里云服务器，主体/省份未提供。

新需求见 `TEAM_PRODUCT_REQUIREMENTS.md`，阶段和官方来源见 `COMMERCIALIZATION_ROADMAP.md`，完整执行提示词见 `COMMERCIALIZATION_GOAL.txt`；本机检查点见根目录`进度.md`。

本轮在 `codex/team-commercial-roadmap` 进行文档/Goal准备，不把角色表格当成已实现权限。当前业务库仍本机共享、平台账号资料不等于独立密码和租户隔离；设备绑定、付费和国内部署未实现。没有改应用页面、公式、真实业务库或报告PR状态，没有购买、申请、扣费或发布。实际Goal/提醒和验证结果以后续进度记录为准。

本轮M0本地检查及独立审查已通过；完整Goal已由工具创建为active；上线手续周提醒已创建为ACTIVE，id为`automation`。工具专项6通过/0失败/0跳过，既有账号资料专项24通过/0失败/0跳过，Goal结构、JSON、链接和仓库检查通过。详细证据边界及下一M1见`进度.md`；这不代表商业化研发或上线已完成，也未进入main/远程。

## 2026-11-15 M1：隔离的采集授权原型

分支`codex/team-permission-foundation`接续M0本地提交`c3bd1ef`。新增`server/team/`，以真实内存SQLite和Request处理器验证服务端会话/团队/角色/任务/项目/附件范围；搜索、计数、分页先授权，返回字段白名单，未知/越权/撤销拒绝。没有把旧业务库自动上传或接入新服务。

独立授权用例21项、复合外键6项，加既有账号/工具相关回归共57通过、0失败、0跳过；独立安全审查通过。曾真实复现并修复emoji文件名截断导致合法下载503，保留回归证据。新测试会被现有runner发现，旧断言未变。

桌面/后端边界和下一闭环见`adr/0001-team-runtime.md`；Electron仅为单一验证候选。M1不包括真实HTTP服务、密码登录、上传写入、电脑绑定、支付、Mac实机或上线；现有用户软件仍是本机业务存储，不可因新原型宣称已经隔离。下一阶段M2按最小采集闭环推进；具体命令和日志见`进度.md`。本轮未推送/进入main/发布。

## 2026-11-15 M2进行中：本机桌面闭环与正式身份方向

分支`codex/team-desktop-collection`新增独立本机团队服务、用户名/密码demo、会话和受限邀请、原件提交/哈希/CAS，以及Electron45.3.2隔离桌面工程。旧dist和平台业务库未改。可移植子集505通过0失败0跳过；其后补充竞态3项独立通过；服务端26项、桌面24项的专题结果是子集，不与505重复累计成不同测试。

真实Electron登录/任务/退出/导航和安全配置通过；Windows CUA原生选择文件、提交、保存下载通过，源/库/下载64字节及SHA256一致。Node24 `npm run dev:team`已实测窗口可达；日志、截图与原件哈希证据见根目录进度。修复了401后的登录busy卡死和launcher错误隐藏交互窗口两个实际问题。

用户已选择正式手机号＋密码并增加微信扫码，见`PHONE_WECHAT_AUTH_PLAN.md`。当前用户名demo不代替真实手机号验证和微信回调；身份适配器/首次绑定、真实供应商、Mac、设备、支付及生产仍待推进，故M2仍in_progress，完整Goal保持active。没有购买、申请、真实短信、微信授权、客户资料迁移或生产发布。未推送、未进入main、未上线。

## 2026-11-15 M2进行中：手机号与微信身份适配

分支`codex/phone-wechat-identity`接续`31b9369`。手机号首次验证绑定/密码登录与额外证明恢复边界、微信短期事务/回调/首次强关联/单次兑换已用合成适配器实现；同一内部员工ID保持团队/任务权限，异步校验完成前重查当前状态。恢复默认关闭，真实供应商尚无，当前微信桌面按钮保持禁用，外部浏览器往返仍待实现。隔离库新增身份表前有SQLite在线备份；未自动迁移旧应用或客户资料。

完整可移植子集564通过/0失败/0跳过；随后新增2项桌面状态和6项确定性竞态，最新桌面身份15＋竞态6合计21通过/0失败/0跳过，与564重叠部分不重复累计。真实Electron通过手机号模式及未配SMS/微信禁用、密码清空和秘密边界，截图/报告及精确命令见根目录`进度.md`。独立安全审查及原生禁用状态证据复核通过，无剩余P1/P2。

当前本机一键入口和窗口可达；未推送、未进入main、未上线。M2/in_progress、完整Goal active；真实SMS/微信、HTTPS/供应商SDK、注册激活/恢复政策、Mac、设备和付费尚未验收。

## 2026-11-15 M2进行中：桌面微信事务往返

`codex/desktop-wechat-flow`接续`37476da`。新增严格受限的系统浏览器入口、主进程S256/秘密管理和单事务开始/轮询/取消/首次关联，16项窄IPC。现有已验证手机号/密码确认后关联同一员工ID，临时会话不进入renderer、不增加团队权限。独立复现并修复“临时会话清理期间取消仍提前登录”的P2，保留回归，无剩余P1/P2。

完整可移植625通过/0失败/0跳过；其后仅调整微信活动流程可见性，相关身份/微信/原UI共34项通过（新增1项，不冒称已在625内）。默认Electron及真实Electron＋loopback HTTP/SQLite合成往返均再次PASS；后者拦截浏览器opener、直接派发合成HTTPS回调，不算真实系统浏览器或微信/手机验收。截图、失败纠正记录、命令和独立复核见根目录`进度.md`。

默认预览已由本任务核对后重启，仍无真实供应商。M2和完整Goal继续进行；正式账号激活/组织归属/恢复政策、供应商SDK、真实SMS/微信/HTTPS、Mac、设备和生产均待完成。未推送、未进入main、未上线；一键入口可达。

## 2026-11-15 M2进行中：员工定向邀请和本人激活

`codex/employee-invitation-activation`接续`04a014b`，新增[邀请激活流程](EMPLOYEE_INVITATION_ACTIVATION.md)及隔离库两张表。经理/合伙人且独立有邀请授权才可发实习生/助理手机号邀请，新旧入口均修正低权限误授grant仍可创建的偏离；邀请人降职后待兑票拒绝。本人SMS验证/设密或既有孤立账号当前密码复用，原子消费，不自动发会话/业务grants。默认SMS缺席如实禁用，单团队实验限制不作商业政策批准。

真实Electron发现并修复原生details延迟toggle清输入，保留调用栈和独立原生事件失败→通过回归。角色/toggle修复后完整可移植693通过/0失败/0跳过；独立13项对抗、47项桌面复核及原生3图/报告一致性通过。邀请激活、既有微信合成、默认禁用三套Electron检查均PASS。共享合成库在线备份与升级后21张原表一致、仅新增2表、integrity ok；全部边界与命令见根目录进度。

未推送、未进入main、未上线；一键预览已重启可达。M2和完整Goal仍进行中，下一步会话查看/撤销；真实短信/供应商、正式组织及恢复政策、Mac、设备/席位/生产仍待完成。

## 2026-11-15 M2进行中：个人登录会话管理

`codex/account-session-management`接续`d7ecc01`，新增[个人会话](ACCOUNT_SESSION_MANAGEMENT.md)：只看本人有效登录、稳定非凭据管理ID、未知旧时间如实标记，当前密码重验后退出指定/其他/全部。错误密码403保留当前，失效401清退；批量不影响其他员工。用户名/手机号/微信统一发放元数据，只加表不改原session列或旧凭据。

完整可移植753通过/0失败/0跳过；独立60项新专项与37项既有认证/竞态复核通过，无剩余P1/P2。真实Electron多会话及默认预览均PASS；另一端撤本端后下一请求实际清退，秘密/DOM清空。共享库在线备份与升级比对23原表及8旧session保持、仅新增metadata表、完整性/外键检查通过，具体日志和3图见进度。

本机一键入口可达，未推送、未进入main、未上线。M2及完整Goal仍进行中；下一步个人改密界面，正式主体/组织/恢复、真实供应商、电脑绑定、Mac与生产仍待完成，不能把登录会话当成设备绑定。

## 2026-11-15 M2进行中：本人改密与人工团队开通决定

`codex/personal-password-change`接续`911b53a`，[改密界面](PERSONAL_PASSWORD_CHANGE.md)已接现有API；旧密码错误403保持有效登录，body/KDF后重查同user/CAS，成功原子改密并撤全部旧会话。新密码和确认不暗改，关闭/未知结果不假称取消，晚结果不误退新账号；总29窄IPC、6form、8密码输入。

完整可移植806通过/0失败/0跳过，独立新53项及原生3图/报告复核通过，无剩余P1/P2。真实Electron证明确认不一致0请求、错密可重试、成功全旧session401/foreign保留、旧pwd拒/新pwd以同ID/权限phone登录；默认预览不提交改密。共享库schema定义、23业务表/原session/meta和演示密码保持，详见进度。

用户已确定前期由产品负责人（当前用户）人工审核团队与首管理员，员工通过邀请激活；下一M2按该路线实现，首管理员不自动获得审计资料/职级。未推送、未进入main、未上线；一键入口可达，完整Goal继续active。真实资源/恢复、Mac/设备及商业化尚未完成。

## 2026-11-15 M2进行中：人工开通和首技术管理员

`codex/manual-team-onboarding`接续`8e8ac98`，[人工开通候选](MANUAL_TEAM_ONBOARDING.md)已实现独立reviewer录入/密码＋CAS审核、一次性票及首管理员本人验证。只有激活才建团队；technicaladmin无审计membership、业务grants或自动session，可通过独立来源邀请员工。低职级误授grant、跨team、旧票复活和重复激活均拒绝。

完整913通过/0失败/0跳过；独立39项对抗及代码/原生四图复核无剩余P1/P2。真实Electron＋loopbackHTTP/SQLite＋明确合成SMS闭环、默认未配禁用与旧会话/改密兼容均PASS。旧demo原26表/全部行保持，仅追加8空表；普通9用户不授reviewer。37窄IPC、8form、11密码输入。详细命令、备份与日志见根目录进度。

一键审核预览 `Start-Team-Review-Preview.cmd` 已实际启动，独立合成数据目录；真实SMS缺席，不能直接激活。未推送、未进入main、未上线；M2及完整Goal保持进行中，真实审核账号部署、主体/SMS/HTTPS、组织恢复/移交、设备绑定、Mac和付费生产关卡仍待完成。

## 2026-11-15 M2进行中：找回密码与确认的设备/恢复规则

`codex/phone-password-recovery`接续`6aa4848`，[找回密码](PASSWORD_RECOVERY.md)已接桌面，39窄IPC、9form/14秘密。默认服务未配如实禁用；合成SMS＋独立按user/challenge/期限匹配批准后只重设本人密码及撤旧登录，不自动登录或变团队权限。独立复现并修复手机号同值重绑旧恢复票仍可用，追加snapshot/HMAC，旧无快照reset拒、bind保持。

完整987通过0失败0跳过；独立36对抗、38桌面专项及原生4图/报告复核通过，无剩余P1/P2。恢复真实Electron/HTTP/SQL合成闭环、默认禁用及三项原生兼容PASS。两demo各原34表定义/所有行保持，仅追加空bindings，普通9用户不增权。

用户已确认：每账号1台绑定/1台在线，每次换机须团队管理员审核；员工密码恢复由团队管理员、管理员本人由产品负责人审核，仍须本人SMS。下一M2实现该审批和一次性授权签发撤销链，不能把现注入authorizer当生产审批已完成。未推送/进入main/上线，一键预览仍可达；Goal保持active，设备绑定/Mac/真实供应商/商业化继续推进。

## 2026-11-15 M2进行中：内建恢复审核与原子重设

`codex/recovery-review`接续`b7fb381`，[内建恢复审批](RECOVERY_APPROVAL.md)已连通SMS验证申请、own operator审员工、独立owner审管理员及一次性凭据；密码重验/CAS批准拒绝撤销，不自审或跨team。reviewed模式同密码事务fresh核权/消费，不以external true绕过；44窄IPC、9form/15秘密，4追加表/20trigger保持旧表定义，同值撤销重授不复活票。

首轮完整1078通过；随后独立复现并修复申请写入恰过期的列表边界，新42对抗及相关114通过，最终完整1079通过/0失败/0跳过，195.59秒。双窗口真实Electron＋HTTP/SQL及合成SMS首轮/修后均PASS，独立4图复核无剩余P1/P2；默认禁用及四项旧原生兼容PASS。两库原35表所有行保持，新恢复审核seed仅显式reviewdemo追加1合成身份，普通9用户不增权。

未推送/main/上线；一键预览可达，真实SMS缺席恢复仍available=false。M2和Goal继续进行；下一阶段核对M2验收缺口及首版设备绑定，Mac、生产身份/供应商及商业化不因这些检查视为已完成。

## 2026-11-15 M2进行中：任务指派/退回桌面闭环

`codex/collection-task-management`接续`c6f2067`，[任务管理](TASK_MANAGEMENT.md)已补桌面入口和管理写CAS/sameactor。用户确认候选仅本团队有效intern/assistant；manager/partner另须当前任务read和项目manage交集，技术管理员/误授低role不能使用。48窄IPC，9form/15秘密不变，无schema改动；管理不扩他人提交/原件授权。

完整1158通过0失败0跳过，独立28对抗及35桌面、三窗口真实Electron/HTTP/SQL和4图复核通过，无剩余P1/P2。改派撤旧范围、新人无旧附件、退回重交、陈旧409需刷新，3份ID/bytes/hash保持；picker仅测试拦截合成文件，非本轮人工OS选择。两demo各39表/62schema对象及全部已有行保持，默认smoke只读通过。

未推送/main/上线，一键窗口已更新可达。M2和Goal继续进行：上传“可提交”前置检查、成员停用管理入口/权限答复仍需完成；真实SMS/微信/HTTPS/Mac/设备/商业化继续分层验收，不能凭本轮通过整体收口。

## 2026-11-15 M2进行中：上传前置能力

`codex/collection-upload-preflight`接续`e284a73`，[上传前置授权](UPLOAD_PREFLIGHT.md)已补服务端只读能力、renderer按钮及main三次fresh核权/版本检查。任务可读或可管理不代表本人可提交；最终POST继续重新授权/sameactor/CAS。49窄IPC、9form/15秘密，无schema迁移。

完整portable单元1256通过/0失败/0跳过，214.05秒；新增98项属于该总数，独立复核无剩余P1/P2。双窗口原生Electron/HTTP/落盘SQLite证明严格仅read管理者无manage/assignment、强RPC不选文件/不读取/不上传；取消、picker内版本/撤权/冻结及正常62bytes原件/hash均验。picker为明确测试拦截；旧任务三窗口兼容及默认一键服务smoke也通过，不能代替真人OS/Mac/生产验收。

两旧demo各39表/62schema对象启动时全部旧行保持；随后默认smoke登录仅使review三张认证表正常变化，其他业务及全部schema保持。未push/main/上线，一键新版窗口可达；M2/Goal仍在进行，成员停用管理与原权限问题答复、真实供应商和首版设备绑定等继续推进。细节和失败夹具边界见`进度.md`。

## 2026-11-15 M2进行中：原件副本保存前复查

`codex/collection-download-preflight`接续`a06293a`，[保存前授权](DOWNLOAD_PREFLIGHT.md)修复两项独立复现P2：选框期间撤权仍落盘、旧下载结果污染新账号提示/busy。附件HEAD复用GET授权且不读取blob，main选保存路径后HEAD＋generation再写；renderer隔离actor/team/task/view/busy代次。没有新增schema或preload，仍49窄接口/9form15秘密。

完整portable单元1332通过/0失败/0跳过（215.09秒），新增76属于总数；独立安全30、UI17等不重复累计，无剩余P1/P2。双窗口Electron/HTTP/隔离落盘SQLite证明正常62bytes/hash三方一致，取消、附件撤权、会话撤销均零写盘，401回登录清空资料；保存框明确为合成测试拦截。旧upload及任务管理原生兼容、默认smoke通过。两demo启动旧schema/全部行保持，验收登录后仅review认证表正常变化；未push/main/上线，一键可达。

用户本轮已确认成员停用分工：团队管理员可停用本团队业务成员（含经理、合伙人），管理员本人由产品负责人处理；不是按业务职级授予停用权。下一M2实现该管理入口及访问撤销，保留原件历史，不等于删除。完整Goal继续active，设备、Mac、真实供应商和生产关卡尚未完成。

## 2026-11-15 M2进行中：成员停用与原子访问撤销

`codex/team-member-deactivation`接续`cf68127`，[成员停用](MEMBER_DEACTIVATION.md)已实现独立技术管理员/owner权限、最小人员列表、当前密码复核、CAS/ABA、同事务停用账号/撤旧会话/grant/指派/未完成授权和专用审计。技术管理员不默认有审计资料，审计职级也不自动有停用权；复杂归属/self/特权身份拒绝，原件、提交历史和身份映射保留。新2表/3trigger，54窄操作、10form/16秘密。

最终完整portable单元1442通过/0失败/0跳过（238.72秒），新增110属于总数；独立安全33/核心26/client8/demo7及UI36等不重复累计，无P1/P2。四窗口Electron/HTTP/落盘SQL验证错密、停intern阻止挂起保存、停partner、owner停管理员、401清空和3审计事件；62bytes原件/hash、历史和合法旧副本保持。4张清晰图及5份SQLite独立复核；partner依据HTTP/DOM/阶段SQL验收，无其专用截图结论。保存框为明确测试拦截。

旧8项原生兼容及默认smoke通过。两入口实际顺序启动升级至41表/67对象；普通9用户不增权，review仅追加两独立合成身份至13用户。旧39表/62定义及全部旧行保持，默认登录后仅review三认证表正常变化；新audit均0，自动化没有在共享演示停用账号。未push/main/上线；一键review预览可达。M2/Goal仍进行，下一步核本地阶段门与M3绑定前置，真实供应商/HTTPS/Mac/生产继续单列。

## 2026-11-15 M3A：设备身份底座本地已验证

`codex/device-identity-foundation`从`8ea2f73`接续；[M2本地阶段门](M2_LOCAL_ACCEPTANCE.md)独立复核通过，但真实SMS/微信adapter及部署配置代码、真人身份/国内HTTPS/Mac/生产均未完成。只把当前实现里程碑切换M3，没有把正式M2或完整Goal标完成。用户已确认断网暂停、同机唯一业务会话新完成持钥登录接替旧会话、管理员本人换机由产品负责人审核。

[设备基础](DEVICE_IDENTITY_FOUNDATION.md)实现canonical Ed25519挑战、单历史绑定/单业务租约、不可换绑authsession、15分钟同步到期、本人撤销及严格逐请求签名门；保留旧业务角色scope。main-only OS加密vault在Windows真实验证。独立发现的错误签名耗尽合法user额度P2已修为验签成功才消耗，回归保留限制。最终无剩余P1/P2。

Node24完整portable 1552通过/0失败/0跳过，271.29秒；新4专项110项包含在内。无窗口真实Electron45.3.2＋OScrypto＋严格HTTP/隔离SQL证明持钥登记、同钥登录替换旧业务会话、重放/错误key拒绝、62bytes原件/hash及HEAD空体、撤销后不能重新首次登记；不等于普通UI已绑定。旧9项原生兼容和默认Electron smoke通过。两入口实跑升级46表/76对象，旧67定义和全部旧行保持，只加设备schema与单行serverId；普通9/review13用户不变、新设备表空。登录后仅review三认证表正常变化，独立保全审查通过，详见根进度和仓库外证据。

正常main/preload/renderer仍54接口/10form16密码，一键预览可达但为M2诊断模式。M3B必须接正常登录/逐请求证明/续接/旧端清退/断网与强制入口，并选每机非漫游key目录；M3C再接换机审批。DPAPI不等于硬件防复制，同OS上下文复制密文实测可读；Mac/跨机/安装升级另验。未push/main/上线，Goal保持active。

## 2026-11-15 M3B：正常Windows客户端设备会话已验证

`codex/desktop-device-session`接续`77f6c1d`，[正常设备会话](DESKTOP_DEVICE_SESSION.md)把用户名/手机号/微信统一接入异步设备关卡，首次须重新输入密码和明确同意，同key持钥证明后才进入。不同key/撤销历史阻断；main逐请求签名、5秒心跳、15分钟单飞续接、断网暂停和fresh重连。两正常一键入口固定开启严格门，缺vault/旧服务不降级；57窄接口、10form16密码，无私钥/token/lease secret进入renderer。每机key目录独立于业务profile和漫游userData。

最终完整portable 1662通过/0失败/0跳过（297.46秒），新110项包含在内，41份运行/单元源文件在最终运行前后hash一致。独立55安全与296UI通过；曾实际发现并修复微信采纳后及IPC回复未交付时取消遗留业务会话，私有receipt+CAS只撤本次、保留后来账号。未知写结果明确提示核对且不自动重放，修前失败均保留。

真实Windows严格Electron/OSvault/随机HTTP/落盘SQL三实例验证通过：首次取消不绑定、明确确认、实际合成phone路由、断网Open不读文件、提交已COMMIT后丢响应恰1POST、fresh恢复、同keyB替A约5223ms清退并阻挂起Save零写、异key及真实撤销历史阻断。5图5DB、原件62bytes/hash与合法旧副本独立核对；默认strict smoke8图亦通过。11旧原生仅以显式test-only诊断夹具证明兼容，不混为设备证据。OS选框是合成拦截，不称真人操作。

两入口本轮实际重启required=true、UUID稳定、窗口可达；两库46表/76对象及全部行与只读online before备份完全相同，普通9/review13用户与空设备表保持，没有自动给演示账号绑定。未push/main/上线，完整Goal active。下一M3C审批/撤旧/新设备激活；M2真实供应商adapter和生产配置、Mac/HTTPS/安装更新、后续业务/年费/官网及上线仍未完成。

## 2026-11-15 M3C：员工/管理员换机审批已本地验证

`codex/device-replacement-approval`从`e37eaab`接续，[换机流程](DEVICE_REPLACEMENT.md)已实现新key持钥＋当前密码申请、本人撤回、独立权限审核及明确激活。员工本团队技术管理员审，管理员本人产品负责人独立device.replace审；审计职级、停用、恢复、开通权限不复用，不自审/跨团队。批准不撤旧机，激活事务才消费批准、撤旧绑定/全部旧登录、发新binding与15分钟会话。revoked历史受审恢复、fresh密码登录后同key新挑战恢复、CAS/ABA/期限/MAX和审计失败回滚均验；审计权限、任务版本和原件保持。

最终完整portable 1830通过/0失败/0跳过，437.96秒，新168项包含；54运行/单元源在完整运行前后hash一致。独立89安全/314UI通过，修复激活采纳后/IPC回复未交付切账号遗留业务会话P2、列表全库JS筛选及同毫秒旧终态遮新pending。正常64窄RPC、10form17密码，无私钥、lease secret或approval token到renderer。

严格Windows4个OSvault/main窗口/fresh14用户/随机HTTP/落盘SQL通过，6图5DB独立重开核对：批准仍保旧，显式claim后旧端实测318ms清退、保存中失效0新增写盘；管理员仅独立owner批准，激活已COMMIT丢回复实际仅1POST并人工登录恢复。62bytes/SHA与合法副本/taskrev1保持，合成选框不称真人OS操作。13旧原生兼容分别标明11诊断及M3B严格/default，不代替新换机验收。

真实两个一键入口升级至50表/87对象，旧76定义/46表原行保持，普通9不增权、review仅加一个独立合成device-reviewer-demo及credential/epoch2/ACL/marker共五行至14；没有audit/operator/membership。startup及之后全部50表行/DDL与快照相同，无auth豁免，设备/换机流程表空，未自动绑定。当前strict预览可达，未push/main/上线。完整Goal/M3仍进行；下一核本地阶段门与M4权限/模块接入，Mac/真实跨PC、最高owner恢复、真实供应商/HTTPS/安装签名及商业化仍未完成。

## M4A 普通员工职级调整（Windows本地候选已验）

- 用户确认teamadmin管普通员工四职级，管理员本人兼职业务role由productowner审核；manager/partner均可建项目且创建者管理该项目授权。本轮实现第一项，其他待后续独立切片，不赠项目/原件/邀请或签发权。
- strict device+当前密码、SQL最小人员scope、CAS/ABA/事务改role，撤旧session/lease/grants/未完成票、逐task版本一次；保留账号/membership有效、credential/phone/wechat/binding/原件history。专用1table1index，不改旧schema。
- 完整portable2000/0fail/0skip、524.43秒、45源hash不变；新170项包含于总数。独立安全87/UI333、新client14/DOM19/entry3及strict原生4vault/5图5SQL/62Bhash均通过，unknown只1POST、heldSave0write，独立无剩本地P1/P2。14旧native兼容通过，11诊断与3strict分层记录。
- 两真实一键升级51表/89对象，原50表/87定义及全部旧行保持；普通9/review14，无新seed/自动角色/自动设备。startup后全表row/DDL不变、auth豁免[]。最终review cmd37584→Node2128→Electron5124窗口/strict methods可达，8773原网页HTTP200；未来操作进程须重新核路径/父链。
- 根证据D:/codex-temp/shenyi-m4-foundation-20261115/。未push/main/上线。管理员兼职、项目创建/任务及专业模块/迁移仍待M4；正式身份/远程配置/最高owner恢复、Mac/真实跨电脑/安装发布等外部版缺口不隐去，完整Goal active。
