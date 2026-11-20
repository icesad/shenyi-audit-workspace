# 审易官网首发收款准备

当前已确认由同一家上海企业运营和收款。正式订单在官网创建和付款，Windows 与 macOS 客户端打开对应订单页。团队技术管理员发起本团队的续费和增购，服务端根据获准价格及锁定的席位计算应付金额。 [订阅与席位决策](SUBSCRIPTION_SEAT_DECISION.md#28-首队试点和正式收款入口)

## 首发渠道

2026-11-20 产品负责人确认首发采用微信支付 Native 扫码。官网显示当前订单的二维码，付款人通过微信扫码付款。接入前确认上海企业商户号、Native 产品权限，以及已经认证并绑定商户号的适用 AppID。二维码显示期限和订单可付款期限分别处理。 [产品介绍](https://pay.wechatpay.cn/doc/v3/merchant/4012791874) · [接入准备](https://pay.wechatpay.cn/doc/v3/merchant/4015614538) · [Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)

受管服务提供只读订阅与席位查询，并可选启用微信通知及已锁定订单的官网付款。官网合成下单在回环 HTTPS 和独立合成库内运行。正式通道启用前，可沿用已批准的限期试点方案。 [试点审批](MANUAL_TEAM_ONBOARDING.md#受管服务首个试点) · [合成验收](M5_LOCAL_ACCEPTANCE.md)

## 微信支付通知本地验收

`server/team/wechat-native-notification.mjs` 接收原始报文字节。服务端按预先配置的微信支付公钥 ID 验签，通过后使用商户 APIv3 密钥解密支付结果。配置可在公钥轮换期间同时接受已确认的新旧公钥。 [微信支付公钥验签](https://pay.wechatpay.cn/doc/v3/merchant/4013053249) · [支付成功通知](https://pay.wechatpay.cn/doc/v3/merchant/4012791882)

通过只读查询核对锁单的应用、商户、商户订单号、人民币币种、订单总金额和创建时间。付款使用优惠券时，以原订单总金额核对。保留微信给出的实际支付时间，验证时允许与本地锁单同一秒，服务端的五分钟验签窗口和未来时间限制分别按同一接收时刻计算。延迟到达的通知可保留原付款时间供后续对账。 [通知字段与验签流程](https://pay.wechatpay.cn/doc/v3/merchant/4012791882) · [签名时间戳](https://pay.wechatpay.cn/doc/v3/merchant/4013053420)

核验函数只返回对账所需的订单、通知、交易、金额和时间等字段。九项专项测试使用在本机生成的 RSA 公私钥和 AES 密钥，覆盖正确收款、带优惠金额、验签失败、解密失败、金额或归属不符、公钥轮换及时间边界。

## 微信支付下单和主动查单适配

`server/team/wechat-native-orders.mjs` 使用服务端持有的商户 API 证书私钥签名，分别携带商户证书序列号和微信支付公钥 ID。对官方下单与查单响应复用通知的公钥验签逻辑，再解析原始报文。下单请求使用已经锁定的商户订单号、人民币分值和整秒截止时间，重试仍使用原单号和原金额。微信下单应答中的二维码链接保留原文供官网生成二维码。 [请求签名](https://pay.wechatpay.cn/doc/v3/merchant/4012365337) · [Native 下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791877) · [二维码](https://pay.wechatpay.cn/doc/v3/merchant/4012791878)

主动查单按商户单号核对应用、商户及订单号，支付成功时还要求 Native 类型、交易号、原订单总金额、人民币和有效付款时间。仍可查询已过截止的原单。已验签的未付、关闭、退款或未查到只返回查询状态，网络错误或无法验真的应答返回查询失败。后续履约仍以本地锁定的期限和实际付款时刻核对，已核实的超期付款保留供复核。 [Native 主动查单](https://pay.wechatpay.cn/doc/v3/merchant/4012791880) · [查单与回调指引](https://pay.wechatpay.cn/doc/v3/merchant/4012075249)

已使用本机回环 HTTP 和合成 RSA 凭据验收。微信按收单时刻检查付款截止的允许范围，适配器在一分钟下限之外加留六秒请求和秒级时间裕量，临近截止可继续查原单。官网需按本地锁定时间显示可付款状态。 [Native 下单的支付时限](https://pay.wechatpay.cn/doc/v3/merchant/4012791877)

## 微信支付锁单与收款账本

独立 SQLite 账本覆盖团队年费和在有效期内的席位增购。由服务端锁定团队、报价版本、席位、金额和整秒截止时间，生成同商户内唯一的外部单号。同团队的相同请求重试返回已存原单。官网换单前需要查明原单状态。核对技术管理员及订单归属后才能读取、出码或查单。增购出码前后均复核对应订阅期。

微信成功通知和主动查单经已有的验签适配后，在写事务中重读锁单。相同交易合并为一笔收款，通知事件和查单来源可独立核对。保留微信实际付款时间与首次服务端验真时间。截止时刻及之后的款项保存待复核，重复通知和迟来的未付查单结果不会覆盖已保存款项。即使查询人在等待期间被撤权，仍保留验真的付款，查询人失去查看权限。 [查单与回调指引](https://pay.wechatpay.cn/doc/v3/merchant/4012075249)

账本已用隔离数据库、两条 SQLite 连接及重开验证。安装入口单独执行并校验结构，现有受管启动按原配置运行。

## 已验收款的年费和席位兑现

服务端显式调用 `fulfilPayment`，在写事务内重新核对本团队技术管理员、订单和收款事实。同一订单只保存一份兑现回执，重试返回原结果。订阅版本、席位容量和回执一起提交。失败回滚本次权益，已验收款与来源可继续核对。

- 年费使用首次可信确认时间及北京时间自然年。现有订阅未到期时从原到期日顺延，到期后从该收款确认时间开始。新一期按锁定数量生效，检查启用员工、邀请预留及容量区间。候选按同团队可兑现的已付年单排队，收款确认时间相同按订单号排序。
- 期中增购从首次可信确认时刻生效，到原锁定订阅期结束。提前续费延长了现有年期时，原增购不会随之延长。覆盖区间被截短、旧年期已结束或席位无法发布时，原收款留待核对。
- 到期时刻及之后付款、已验签查单返回退款或关单时，留存事实并暂停尚未执行的兑现。退款或关单观察可以先于实际收款入账。已发的权益和异常记录分别保留，由后续复核流程处理。

显式安装器支持从原四表账本增量加入兑现及复核事实，保留历史付款。已锁定订单的设备会话授权和官网付款见下文。正式定价、报价时效、晚款和退款复核、商户开通与对账仍待确认或验收。

## 受管服务接收微信支付通知

受管 HTTPS 服务可通过启动配置中的可选 `wechatNativeCallbackProfile` 启用 `POST /api/billing/wechat-native/notify`。配置项省略时入口返回 404。该入口只接受规范路径、无查询参数的 JSON 报文，按原始字节验签、解密并核对原单。收款和来源已入账才返回空 204。同一通知重试只对应同一份收款。失败响应只返回通用结果，微信可按其规则重试。年费及席位继续由独立的兑现事务处理。 [微信支付通知和重试规则](https://pay.wechatpay.cn/doc/v3/merchant/4012791882)

通知配置是仓库外的独立 JSON 文件。路径按现有 `service.json` 的本机文件规则填写，值为一个绝对路径。配置字段如下。

| 字段 | 值 |
| --- | --- |
| `schemaVersion` | `1` |
| `provider` | `wechat-pay-native-v3` |
| `appId` 和 `merchantId` | 已核准的微信支付应用及商户 |
| `apiV3Key` | APIv3 密钥原始 32 字节的无填充 base64url 编码 |
| `keys` | 微信支付公钥列表，每项含 `id` 和 SPKI PEM 文本 `key`，轮换时可并存 |

启用前须单独完成账本安装。受管服务启动和 `--check-startup --config` 会核对结构及配置，在运行时用 `/ready` 复核。Linux 权限检查按密钥文件规则检查通知配置，发布预检后会校对该文件有无变化。原始报文上限为 1,052,672 字节，读取最长三秒，回调各段 SQLite 锁等待在原连接设置较大时临时上限为 500 毫秒。生产验收仍需核对实际域名、TLS、反向代理原样转发、办公网络和微信收件时限。当前本机 HTTPS 使用合成密钥和隔离 SQLite 验证。 [国内部署说明](LINUX_TEAM_DEPLOYMENT.md)

## 授权官网原单付款

已绑定电脑的本团队技术管理员可通过设备签名请求 `POST /api/teams/:teamId/billing/native-website-handoff`，为指定已锁定订单领取短时授权。调用方把授权放在受管 HTTPS 页 `/api/website-pay/#handoff=<短时授权>` 的片段中，由浏览器在请求前清除片段。授权最长两分钟，随原会话、设备租约及撤权变化失效。每次操作都复核原账号、团队、设备和订单。

同一受管 HTTPS 地址下，付款页用 `POST /api/website-pay/order` 查看锁定金额、截止时间和当前状态。管理员点「生成微信付款码」时，`POST /api/website-pay/code` 才按账本原金额向微信请求 Native 付款链接，由受管服务生成二维码。点「查询付款结果」调用 `POST /api/website-pay/check`，按微信验签结果确认收款，并在满足条件时发放权益。同一笔订单可复查，收款核实与权益到账分别显示。已核实的晚付款、退款或关单按照已有规则留待复核。 [Native 二维码](https://pay.wechatpay.cn/doc/v3/merchant/4012791878) · [Native 主动查单](https://pay.wechatpay.cn/doc/v3/merchant/4012791880)

此能力默认关闭。启用时，受管启动配置同时指定 `wechatNativeCallbackProfile` 和仓库外独立的 `wechatNativeWebsiteProfile`。后者的字段为 `schemaVersion: 1`、`provider: wechat-pay-native-v3`、商户证书序列号 `certificateSerial` 与 2048 位 RSA PEM 私钥 `merchantPrivateKey`。启动检查核对账本、配置和网页资源。本阶段将付款页、团队接口和支付回调放在同一受管 HTTPS 地址，公开官网展示页继续单独提供静态预览。

原单付款通过本机 HTTPS 验证，使用设备签名、独立 SQLite 和合成商户应答。Windows 桌面已接通对应支付页。真实商户及公网回调、对账和退款复核待验。 [桌面付款入口](DESKTOP_BILLING_CONTRACT.md#受管服务的微信-native-官网付款)

## 官网报价和确认

受管服务在独立的 `wechatNativeWebsiteProfile` 中配置 `catalog` 后，已绑定电脑的本团队技术管理员可以为团队年费或席位增购申请 `POST /api/teams/:teamId/billing/native-website-order-handoff`。请求包含商品 `product` 和本次购买的 `requestId`。桌面在同一次购买的重新打开、查询和重试中复用该 UUID。开始下一笔时同时提交 `previousRequestId`，由服务器复核上一笔已安全终结，并在首次确认时复验。关闭 `catalog` 时，可凭原订单编号申请原单付款页。

报价页按服务端提供的可选席位展示方案。管理员先获取报价，再核对人民币合计和席位并确认。报价有效期和订单付款截止分别显示。报价和确认调用 `POST /api/website-pay/quote` 与 `POST /api/website-pay/confirm`。浏览器提交席位数和报价编号，服务端决定单价、报价版本、期限和应付金额。确认在同一个 SQLite 写事务内复验设备及权限、原订阅与占席并保存原单。确认结果不明或页面已关闭时，从客户端补发同次购买授权，再查原单；已锁订单保持金额和截止。只有点击获取二维码才请求微信。

| 目录字段 | 用途 |
| --- | --- |
| `annual.id`、`annual.revision`、`annual.baseAmountMinor`、`annual.unitAmountMinor` | 年费方案和版本、基础年费、每席年费。金额单位为人民币分。默认使用原到期前的已购容量，确认时至少覆盖启用成员和有效邀请。已有容量超出当前 Native 年单的 1000 席范围时，页面返回需负责人核对。 |
| `seat.id`、`seat.revision`、`seat.annualUnitAmountMinor`、`seat.prorationBasis` | 增购方案和版本、每席年价、折算分母。当前可配置 `beijing-calendar-year-from-quote`，按报价时刻至原期结束的精确时长与北京时间一个自然年时长折算，整单向上取整到分。原期版本变化需重新报价。 |
| `quoteDurationMs`、`paymentDurationMs` | 报价有效毫秒数（1–120 秒）、付款窗口毫秒数（187 秒至 7 天，整秒）。订单截止向下取整，增购不超过原期。新单预留原网页授权剩余时间和微信出码所需的 66 秒，剩余期限不足时暂缓建单。 |

目录应由负责人批准后随受管配置版本管理。当前本机验收使用合成目录。生产价格、折算分母和时效需要正式确认，实际商户收款继续待验。

## 超时未付原单

付款截止后，可在原官网订单页点「关闭未付款订单」。新的微信账本会在锁单时保存追踪记录，在首次向微信请求出码之前持久保存该请求已启动。到期且可核实从未发出出码请求的订单可本地关闭。对于已尝试出码或较早的原单，服务端先对同一商户单号验签查单。仅在回报未付时请求关单，随后立即验签复查。落账以复查确认的关单结果为准。 [微信 Native 接入易错点](https://pay.wechatpay.cn/doc/v3/merchant/4054257695) · [微信关单](https://pay.wechatpay.cn/doc/v3/merchant/4012791881)

若查到付款，系统保留实收证据。到期或关单后才出现的付款，以及退款异常，继续按既有规则留待复核。关单应答缺失、复查失败或历史订单仅查到不存在时，继续核对同一笔，下一笔仍待确认。官网显示待核实状态并保留原订单号。

既有受管服务升级时先停止并排空旧版本的结算、出码和回调进程，并完成离线备份。在已验签且解包的候选根目录，用受管服务账号对获准的独立数据库执行账本升级。`db_file` 和 `server_id` 分别取已核对的绝对库路径和服务 UUID。 [离线备份](TEAM_OFFLINE_BACKUP.md#受管库加密备份)

```sh
node --input-type=module - "$db_file" "$server_id" <<'JS'
import { realpathSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { assertManagedDatabaseReady } from './server/team/managed-database-readiness.mjs'
import { sqliteExistingFileUri } from './server/team/sqlite-existing-file.mjs'
import { assertWechatNativeBillingReady, installWechatNativeBillingSchema } from './server/team/wechat-native-billing.mjs'

const [file, serverId] = process.argv.slice(2)
if (!file || realpathSync(file) !== file) throw new Error('Use the verified absolute database path')
const db = new DatabaseSync(sqliteExistingFileUri(file, 'rw'))
try {
  assertManagedDatabaseReady(db, serverId)
  installWechatNativeBillingSchema(db)
  assertWechatNativeBillingReady(db)
  console.log('Native billing ledger ready')
} finally {
  db.close()
}
JS
```

迁移保留原单和收款事实，无从核实历史出码情况的订单继续验签查单。再用 `--check-startup --config` 核对完整受管配置。生产切换获准后仅启动新版写入进程。当前验收在隔离本机数据库完成。

## 接入时从现有产品继承的规则

- 沿用本团队技术管理员权限、显式选择的订单类型、北京时间自然年和席位兑现事务。官方商户配置保存独立通道、商户、应用及接收结果所需的可信身份。
- 官网显示的待支付订单记录锁定的商品、金额、人民币币种、席位、期限和原订单编号。服务端保存官方渠道的订单对应关系。付款页面回跳只引导查看原订单，到账来自验真的回调或可信主动查单。
- 正式订单和回执使用渠道原生的商户、交易和事件标识。相同回执重试、通知与查单同时到达以及中途退出须能复查原单。已保存金额、支付流水和已兑现权益可以独立核对。
- 付款确认后按已确认的续期和席位规则兑现。退款由产品负责人受理。正式退款执行、部分退款和历史权益的处置按另行确认的合同办理。 [订阅及退款决策](SUBSCRIPTION_SEAT_DECISION.md)

## 负责人确认及验收证据

| 需要确认的事项 | 可接受的验收证据 |
| --- | --- |
| 上海企业开通微信支付 Native | Native 产品权限、主体与应用绑定状态、可用测试环境。通过官方控制台核对状态，只记录非敏感的状态和时间。 |
| 正式下单规则 | 签收团队年费、年度席位单价和购买范围，签收增购分母及报价有效期。分别核对普通续费、到期恢复及期中增购订单。 |
| 官网付款结果及异常 | 同一官网订单的锁定金额、真实或官方测试回执、主动查单结果和权益版本可对应。分别记录拒绝金额不符、商户不符及重复通知的结果。 |
| 对账及退款 | 有权限的负责人能把订单、渠道账单及批准的退款与权益处置逐笔对应，记录发生时间、处理结果及核对人。 |
| 生产上线 | 域名、HTTPS 回调服务、备案或许可适用路径、正式商户授权及双方验收。测试环境、正式商户小额验收及正式上线分别留证。 [首次上线准备](LAUNCH_INITIAL_APPLICATION_PACKET.md) |
