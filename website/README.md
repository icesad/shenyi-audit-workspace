# 审易官网本地候选

官网展示资料采集流程、团队权限、已确认的年订阅与席位规则、桌面版本状态和常见问题。工作台画面是页面原生排版的合成界面示意。品牌标识使用桌面版沿用的原始文件。

## 本机查看

Windows 可双击根目录的 [Start-Website-Preview.cmd](../Start-Website-Preview.cmd)。打开终端显示的 `http://127.0.0.1:<port>/`。关闭命令窗口或按 `Ctrl+C` 即停止服务。使用仓库源码时，也可在仓库根目录运行下列命令。

```text
node scripts/website-preview.mjs
```

候选只监听本机随机端口。页面可用 Tab 和 Enter 跳过导航、打开站内段落及展开常见问题。原业务工作台继续使用自己的入口和数据目录。

## 生成独立静态包

在仓库根目录使用 Node.js 24.15 以上的 24.x 运行以下命令。输出目录须在仓库外且尚未创建，其上一级须已存在。

```text
node scripts/website-preview.mjs --build D:/codex-temp/shenyi-website-static
```

静态包固定包含 `index.html`、`styles.css` 和 `assets/brand-shenyi.png`。准备上线时以该白名单和实际交付条件重新核对发布范围。

Linux HTTPS 部署见仓库 `docs/LINUX_TEAM_DEPLOYMENT.md` 的「官网静态站与团队 API 并行部署」。官网使用独立域名，公开入口为 `/` 和两项静态资源。

## 官网下单演练

Windows 双人评审包完整解压后，双击 [Start-Team-Website-Checkout-Candidate.cmd](../Start-Team-Website-Checkout-Candidate.cmd)。用启动窗口显示的合成账号登录并绑定本轮电脑，再从「订阅与席位」打开专用官网窗口。关闭桌面应用后，本轮 HTTPS 服务停止。

本团队技术管理员可在已绑定的客户端展开「订阅与席位」，点击「在官网生成合成订单」。官网显示团队、年费和席位，确认后生成一笔待处理的团队年费订单，并显示原订单编号。回到客户端刷新可核对订单。

此演练由 `scripts/website-checkout-preview.mjs` 的 `startWebsiteCheckoutPreview({db, key, cert, billingSimulation})` 启动，官网订单页及团队 API 同在一个回环 HTTPS 地址。演练方须提供单独初始化的合成库（`team_database_metadata` 中 `website-checkout-demo=true`）、本机演练证书与密钥，以及一条合成年费报价和每席价格。仅在演练客户端使用工厂返回的 `profile`。配置 v3 包含 `apiBase`、`serverId` 和 `checkoutOrigin`，目前单独用于官网演练。微信扫码的 v2 配置保持原入口。

合成配置同时提供 `seatOffer` 时，订阅有效期内的技术管理员可从同一面板点击「在官网增购席位」。官网按当前订阅剩余时间计算整单金额并向上取整到分。新增席位与当前团队订阅的到期日对齐。修改数量后须重新报价。报价供确认的时间最多一分钟，且不超过官网凭据或订阅到期时刻。确认时，若订阅版本、报价条件或折算金额已变化，须重新报价。

官网凭据最长有效两分钟。客户端会话或设备失效后，应重新登录并从客户端打开新页面。同一凭据重复确认原方案只返回原订单。如果增购请求发出后浏览器无法确认结果，先点击「只读核对订单」。已建订单会显示单独的订单锁价截止，合成账本目前按建单后 15 分钟与订阅到期的较早时刻计算。

合成订单用于查验金额和编号，不触发收款、订阅变更或席位到账。商户付款和正式部署仍待验收。原官网一键入口提供静态预览。

## 发布前核对

本机审阅时，可对照四角色采集演练和合成账务验收核对官网说法。 [采集演练](../docs/TEAM_PILOT_REHEARSAL.md) · [账务验收](../docs/M5_LOCAL_ACCEPTANCE.md)

正式订单与付款集中在官网，客户端打开对应订单页。正式发布前，仍须核对 macOS 实机、签名安装、账号及订单入口、价格与退款条款、运营主体及国内上线手续。试点条件以及双方负责的评审事项见随包评审单。 [双人评审单](../docs/PILOT_OWNER_REVIEW.md)
