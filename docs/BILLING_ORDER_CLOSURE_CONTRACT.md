# 模拟订单超时关闭

年费和增购订单可在可信模拟网关确认未付款关闭后进入已关闭状态。团队技术管理员可在原订单、单笔核对和批量核对中查看结果。负责人仍可按原订单核对付款，并在有效迟到收款入账后登记受理。界面显示截止时间和可信关单时间，客户端时钟不决定订单状态。

候选服务显式配置 `billingSimulation.timeoutClosure: {annualTimeoutMs: …}` 后，新年单在创建事务中锁定 `paymentDeadlineAt`。同一请求重试沿用该时刻，之后改配置不影响已建订单。旧年单不补填截止时间。增购单沿用原有的 `quoteExpiresAt`。模拟年单时长只用于本地验收，正式支付时效与服务合同另待确认。

## 可信回执与补偿

`POST /api/billing/simulation/order-closures` 接收模拟网关签名关单通知。已有单笔或批量查单来源可返回 `{kind:'order-closure',body,signature}`。订单、产品、商户、锁定金额和人民币币种均须匹配。关单时刻不能早于锁定截止时间，也不能晚于服务端首次入账时间。收到有效签名和原单匹配之前，待支付状态继续保留。关单不请求扣款、退款或调用生产网关。

通知使用规范 JSON，字段依次为 `protocol,merchantId,eventId,orderId,product,amountMinor,currency,status,closedAt`。协议为 `shenyi-simulation-order-closure-v1`，`status` 为 `closed`。消息最多 16 KiB，签名消息域为 `shenyi.billing.simulation.closure.v1\0`。关单事件标识不能与已有收款或退款、拒付事件复用。已有可信收款或退款、拒付凭据的订单不能再新增未付款关单记录。

有效关单与锁定截止时间分别留痕。重复通知只复用原事实，包括在后到收款已归档后重放原关单。关单先入账时，后来验真的收款继续记入原收款账本，订单显示迟到收款待复核，不兑现该单的期限或席位。其他正常续费仍可办理。已兑现订单、成员权限、退款确认和真实资金处理继续按各自规则运行。
