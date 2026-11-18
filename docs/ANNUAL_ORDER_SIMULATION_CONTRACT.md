# M5D 年续费订单与模拟收款候选

2026-11-18，`codex/annual-order-simulation`，基点 `d88e809`。承接[订阅决定](SUBSCRIPTION_SEAT_DECISION.md)，完整 M5 和 Goal 继续进行。

本片只做服务端单年续费闭环。方案金额来自可信服务端合成 catalog，返回 simulation=true；默认关闭，启用须严格设备证明和 team-management-v1。本团队有效技术管理员可看金额、建单、主动查单，到期后仍可操作。业务职级或付款不授账务及审计资料权。body/查单等待后及建单事务末重查设备、会话、身份版本和管理员资格。

存 UTC 毫秒，固定 UTC+08:00 北京自然年。未到期保留原起点，从原终点续一年；已有 scheduled 期限不提前激活。无期限或精确到期/过期，从首次成功持久验真收款 confirmedAt 起算；2月29日对应次年2月28日同一北京时间和毫秒。签名 paidAt 仅审计，不控制权益。

三张 STRICT 不可变表：team_annual_orders 锁价、team_annual_verified_payments 留事实、team_annual_fulfilments 留兑现回执。状态派生为 pending/payment-verified/paid。事实先短事务持久，订阅 event/head 与兑现回执再同事务发布。失败回滚兑现、保留事实，重试及重启复用原 confirmedAt；不承诺保留提交前崩溃的内存时刻。延迟补偿不从重试当天重新送一年。

同订单/事件/交易标识的相同完整事实幂等，异内容冲突；不多授一年。相同建单请求锁价，下架/升版后仍可回放原单，新请求须选当前方案。跨团队查询和分页锚点先按团队过滤。回执不含交易号、付款JSON、摘要、签名或密钥。同团队更早未兑现事实按 confirmedAt/paymentId 排序先补偿，不丢弃坏记录或改历史。保留原 recordSubscriptionTerm 独立事务契约，内部同步 append 须调用者已开事务，没有 HTTP 直接授期入口。

接口：

- GET /api/teams/:teamId/billing/offers：合成方案。
- GET/POST /api/teams/:teamId/billing/orders：有限分页；建单只接 requestId/offerId/offerRevision。
- GET .../orders/:orderId：本团队最小回执。
- POST .../orders/:orderId/reconcile：空JSON，可信服务端查单adapter，5秒上限；返回仍须验签及匹配请求订单。
- POST /api/billing/simulation/notifications：仅这一精确路径以HMAC替代用户设备证明；仍执行原Origin检查，拒绝查询参数、错误方法、非JSON及声明/实际超过16KiB的流。

协议 shenyi-simulation-payment-v1 仅接精确规范十字段JSON：protocol/merchantId/eventId/transactionId/orderId/product/amountMinor/currency/status/paidAt。HMAC-SHA256输入为固定域 shenyi.billing.simulation.v1\0 加规范原字节，独立服务端密钥、严格小写64位hex与恒时比较。只接受 team-annual-renewal/CNY/succeeded，再核锁单商户、订单、产品、整数金额、币种；客户端成功页、设备签名或提交时间不能授期。查单也须可验签来源，无真实供应商实现。

未实现生产定价、增席订单/容量/折算、退款/发票/关单、自动对账调度、桌面购买界面、真实商户/资金/HTTPS。购买入口位置仍待定，现有续费不等于购入任意员工席位。旧预览、共享库、vault不操作；Mac、原生安装和国内上线另验。不进main、不push、不重验一键、不上线。

日历、网关、存储、严格application、精确schema保全分别测试，独立agent另验有界TCP及持久失败恢复。原失败、命令、源清单和最终计数见 D:/codex-temp/shenyi-annual-order-simulation-20261118/。仅投影精确且空的新层，保持历史数字、业务断言和原11表物理peel。事务参考[SQLite官方文档](https://www.sqlite.org/lang_transaction.html)，具体行为用Node24真SQL验证。
