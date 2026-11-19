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

## 发布前核对

本机审阅时，可对照四角色采集演练和合成账务验收核对官网说法。 [采集演练](../docs/TEAM_PILOT_REHEARSAL.md) · [账务验收](../docs/M5_LOCAL_ACCEPTANCE.md)

正式发布前，仍须核对 macOS 实机、签名安装、账号及订单入口、价格与退款条款、运营主体及国内上线手续。官网和客户端将使用同一套订单与权益服务，具体收款入口由产品负责人决定。试点条件以及双方负责的评审事项见随包评审单。 [双人评审单](../docs/PILOT_OWNER_REVIEW.md)
