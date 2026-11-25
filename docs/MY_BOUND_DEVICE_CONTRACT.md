# M3E 本人电脑信息与操作记录合同

2026-11-17，base `93fb7d10cc9a9ad061488fa3424b7f082f452bf3`，branch `codex/my-bound-device`。前轮M3D是progress，已本地提交并独审；当前Goal active，正式M3/M4/商业化仍未完成。开工clean、fetch核main060a98e/report894078b不变。1093原文件51,181,247B已逐raw备份且一次Git batch核对，13纯EOL既存不规范化；证据 `D:/codex-temp/shenyi-my-device-20261117/`。

## 本片完成目标

按TEAM_PRODUCT_REQUIREMENTS §4设备权限及§6.1补正常工作台“我的绑定电脑”：本人当前绑定名称、Windows/macOS、状态、绑定时间、可信最近使用信息和历代本人绑定/换机操作记录，懒加载、稳定分页、可刷新。不能只把本地getDeviceStatus转显就称历史完成；不拿租约到期、本地Date.now、页面轮询或易清理nonce表冒充最后使用。

纯本人账号安全功能，与team选择、业务职级、项目权限无关，零业务memberships的技术管理员也可在持钥ready后看自己。只读界面，不新增改名、解绑、自助换机、遗失恢复或业务授权；员工换机teamadmin、管理员本人productowner审核保持，最高审核账号恢复继续待后续。无整体UI升级、订阅/支付/专业模块/官网开发；专业模块新权限仍待答默认关闭。无push/main/生产、采购/真实供应商/客户资料；Mac/真实跨电脑/发行及两负责人业务签收另验。

## 可信使用时间与兼容

新增独立 `team_device_usage(device_id,user_id,last_used_at)` 元数据侧表，device/user归属约束、整数安全非负时间、不可换归属及不可倒退。不更新bindings，不能触动旧binding epoch trigger或放宽原lease/nonce/密码/审批语义。新INSERT/UPDATE guard校验binding同owner且active；helper固定owned语句、MAX保持单调，禁止任意ID侧写。增加有必要的owner/time查询索引；所有旧217定义和70表原行保持，只作明确加法schema，不自动回填历史、不伪造旧活动。

时间来源仅成功持钥身份：①valid签名、body hash、freshLease及nonce成功所在原事务后记录当前device；②leasedSession成功写新lease后记录，同一处覆盖enroll/prove/claim；③合法签名revoke可在改revoked前记一次，与撤销同事务。失败签名/body/重放、password-only、未获准新key及申请/审批/撤回不算已绑定电脑使用。有效设备认证后即使业务接口403/404也可记认证活动，不授业务权。usage/nonce/lease任一失败必须原事务回滚，usage不是认证依据，不延长租约。不额外要求clock>=bound_at以改变旧认证；服务时钟回拨已有usage保MAX，不伪造校准事实。

新usage属于认证历史事实：device-policy的ensureDeviceServerId固定历史表guard仅追加team_device_usage，孤立usage且UUID缺失也不得重建身份；先建新schema再运行原guard，不改变其它policy或原UUID。此必要一处接线纳入server agent文件归属，独立验证有效旧库保全及损坏拒绝。

界面叫“最近在线核验”，说明包含成功持钥登录、心跳和本次查看，是设备认证活动而非审计业务操作/人在电脑前。旧绑定无usage显示“未记录（早期版本未采集）”，不推算。历史binding归属变化不得把旧owner活动投影给新owner；复用ID冲突宁可拒绝也不移交旧usage。

## 单一受保护读接口

新增且仅新增 `GET /api/auth/devices/overview`，可选一次 `before=D.uuid` 或 `R.uuid`。固定25条、内部取26判断hasMore；拒未知/重复/空/格式错查询、任意user/team/device/url/limit字段。保持旧bootstrap `/api/auth/devices`精确DTO和allowlist完全不变；overview不进bootstrap，在strict持钥ready许可下读取，diagnostic/password-only/未绑定/不同key/撤销/过期均拒绝。

handler重新用currentDeviceLease核身份，逐项匹配gate context，不仅相信其userId；应用分发存在await。Gate的私有context须固定nonce认证时的identity stamp与serverId，overview初读与末读都比原值，不得在await之后重建成新代上下文。两字段不进入HTTP/renderer DTO，不改签名协议。当前摘要只能是该许可对应本人active binding；查询快照及最后验证防body await/并发撤销、owner/epoch/lease ABA和clock故障。只投影白名单，无raw SQL行、key/publicKey/fingerprint、令牌、lease/hash、server UUID、用户/团队ID、审核人或客户/项目资料。

返回精确DTO：`{device,events,nextCursor,hasMore}`。device精确 `{id,displayName,platform,status,boundAt,lastUsedAt}`（lastUsedAt可null）；events每项精确 `{id,kind,action,displayName,platform,createdAt}`，kind为device/replacement，id为D.uuid/R.uuid；nextCursor有更多时为末项id，否则null。status只active；action分别固定bound/proved/revoked与request/approve/reject/revoke/withdraw/claim/expire/stale，整数安全时间。不得隐式类型转换或传递多余字段。

D事件JOIN binding双owner；R事件JOIN本人replacement request，过滤目标user而非审核actor。R名字/系统是“拟更换电脑”，批准并未绑定，claim才激活；不输出actor或旧snapshot。expire/stale.createdAt是系统记录失效时间，不能说实际失效时刻。cursor先按kind查本人anchor，不存在/外人/类型错配统一拒绝；按(created_at DESC,kind DESC,event_id DESC)稳定跨源分页，同毫秒排序不宣称因果先后。不得先取全库或全账号历史再在客户端过滤。

## 客户端与正常界面

新增一个窄 `getMyDeviceOverview({before?})` bridge/preload RPC，117总RPC、21form/26秘密输入；保留原getDeviceStatus同步六键、1s本地轮询和guard，不偷用旧RPC异步联网。新私有client helper走现有request，包括HTTPS固定origin、秘密前probe、响应pin和device.guard；处理headers/body前后guard，迟到A和同账号新epoch均不清/暂停B。严格验证输入及整个响应，混入他人/私有字段拒绝；不新增renderer通用网络/文件能力。

新“我的绑定电脑”折叠面板复用identity-panel风格，默认关闭，正常展开才读取。显示本机当前绑定和分页时间线；说明换机既定规则，无新form/password/操作权。device名字和文案仅textContent，时间可用语义time元素。关闭、刷新、pause/重连、退出、换actor/epoch、unload同步清空详情及记录，失效promise不可回填。先判上下文有效再处理401；重开不复用旧缓存，分页不交错/不重复。不可把session列表当电脑列表。

## 分工与结束验证

server agent拥有usage schema/helper、database装载、device-api leasedSession/revoke、device-gate、application-api和新my-device-api及新team-my-device-server/usage/security测试；不改client/UI/旧测试。client agent拥有新my-device-client、team-client接线、bridge/preload及新team-desktop-my-device-client/entry测试；不改server/UI/旧测试。UI agent拥有index/team-ui.js及新team-desktop-my-device-ui测试和新my-device-smoke；不改client/server/main/CSS/旧测试。root拥有合同/使用/四检查点、全部旧fixture必要精确适配、全量/原生/共享/提交。关键逻辑独立agent验收，未root green禁止正式GUI/full/shared process。

先跑server/usage/client/entry/UI直接专题及相关旧device/session/security测试，覆盖：双owner、同key跨账号、仅密码/撤销/旧lease、timestamp/MAX/rollback/旧表与epoch不动、D/R历代及同毫秒分页、cross-cursor/未知字段/非法UTF8/精确DTO、late body/late401/关闭重开/pause-reconnect/ABA、HTTPS错服0派发、无秘密及恰好117/21/26。新RPC使旧116计数须root逐点备份适配，只改确实RPC总数，不弱化frame/input/guards。

产品/测试冻结并独审后，root正式Windows实际main/preload/renderer＋真实TLS/OS vault：正常绑定→打开面板与独立SQL逐字段核对，真实proof/换机申请审批激活记录、分页夹具来源分开记录，intern和零业务成员管理员自身可查/外人拒绝，断网暂停和换actor旧内容清空；原件/任务/审计权限保持。新usage写和auth计数如实记录，近在线时间允许心跳并发区间，不冒称逐毫秒精确重算。原严格 `scripts/test.mjs --unit --strict`、相关旧原生兼容、两原cmd及四真RO保全；旧70 typed表/217DDL精确保持、新usage为空的共享库和9/16用户/UUID不变。最终记录新增DDL实际数，不预写测试成功。失败前件留存，只有全部实际结束门通过才称本片Windows候选已验，Goal继续active。
