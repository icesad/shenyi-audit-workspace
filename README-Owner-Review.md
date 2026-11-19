# 审易 Windows 双人评审包

本包用于产品负责人和米老师在 Windows x64 上走查合成资料。先使用可信交付记录中的 SHA-256 核对收到的 ZIP。将 ZIP 完整解压到可写、路径较短的本机目录，例如 `D:\ShenyiReview`，并保留目录结构。Node.js 和 Electron 已随包提供。

## 接收校验

1. 在 PowerShell 中运行 `Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\下载\Shenyi-Owner-Review-Win-x64.zip'`，将路径换成实际收到的文件。核对输出与交付记录的 ZIP 摘要一致，再解压到新目录。
2. 双击解压目录中的 `Verify-Owner-Review.cmd`。看到「评审包校验通过」后，记下文件数和清单 SHA-256，再开始走查。校验逐一读取清单内文件，核对字节数和摘要，拦截缺件、多余文件及目录链接。校验会跳过本机演练目录 `review-runs` 的内容。
3. 校验失败时保留屏幕提示和原 ZIP，先核对下载摘要，再从已核对的 ZIP 重新解压到空目录。

## 走查入口

| 走查项目 | 双击入口 | 重点 |
| --- | --- | --- |
| 采集和核对 | `Start-Team-Pilot-Candidate.cmd` | 依次检查实习生、助理、经理和合伙人的任务与资料范围。 |
| 新团队首份采集 | `Start-Team-Managed-Pilot-Candidate.cmd` | 从只含产品负责人的新库走通审批、人员激活、采集任务及只读核对。 |
| 新团队四职级走查 | `Start-Team-Managed-Pilot-Candidate.cmd` | 另起一轮，批准四席试点并激活四名员工，核对各职级的任务、项目授权和原件范围。 |
| 底稿迁入和导出 | `Start-Team-Pilot-Candidate.cmd` | 使用 `review-inputs` 中同一来源的两个合成文件，核对已保存填写、冻结及导出。 |
| 订阅和席位 | `Start-Team-Billing-Candidate.cmd` | 检查年费、增购、按订单号查询、恢复兑现及退款受理。所有收款回执均为合成。 |
| 官网年费与增购下单 | `Start-Team-Website-Checkout-Candidate.cmd` | 从桌面打开专用官网窗口，核对年费和增购报价，创建待处理模拟订单，再回桌面核对同一订单编号。此入口不收款、不兑现权益。 |
| 官网口径 | `Start-Website-Preview.cmd` | 在浏览器核对产品描述、下载与购买入口表述。 |

本轮登录信息显示在启动窗口。新团队走查中的首管理员和员工在激活时自行设置演练密码。每次启动使用独立演练编号、合成数据库和电脑绑定配置。新团队入口在当前用户的 `%LOCALAPPDATA%\ShenyiManagedPilotReview` 下保留本轮文件，具体目录和原件位置由启动窗口显示。其他桌面入口的记录位于解压目录下的 `review-runs`。请在同一次启动中完成相关角色的登出和登录。关闭桌面应用即停止对应合成服务。静态官网走查结束后，可在其启动窗口按 Ctrl+C 停止预览。

官网下单请使用启动窗口显示的合成技术管理员账号，按提示登录并绑定本轮电脑。在“订阅与席位”中分别打开官网年订阅和增购入口。专用官网窗口使用独立的本机 HTTPS 地址，关闭它后可回到同轮桌面刷新对应类型的订单。增购先取得服务端报价，修改数量需重新报价，再明确确认建单。“报价确认截止”与回执中的“订单锁价截止”分别显示。提交结果未确认时先使用官网的只读核对，或回桌面查原订单。

新入口仅保存待处理模拟订单，没有真实支付，也不会延长订阅或增加席位。原有账务入口继续用于合成验款、恢复兑现及退款受理，两种演练使用各自独立环境。

本包自带合成资料。请使用预置文件和订单完成评审，真实客户资料与正式手机号不进入本包。双方按各自负责范围填写回执。

- [双人评审单](docs/PILOT_OWNER_REVIEW.md)
- [资料采集演练](docs/TEAM_PILOT_REHEARSAL.md)
- [新团队首份采集和四职级走查](docs/PILOT_MANAGED_FIRST_TASK.md)
- [合成底稿演练](docs/PILOT_WORKPAPER_REHEARSAL.md)
- [订阅与退款受理演练](docs/M5_LOCAL_ACCEPTANCE.md)
- [官网预览说明](website/README.md)

保留接收时的原 ZIP，演练产生的 `review-runs` 留在解压目录。
