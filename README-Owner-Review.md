# 审易 Windows 双人评审包

本包用于产品负责人和米老师在 Windows x64 上走查合成资料。将 ZIP 完整解压到可写的本机目录。Node.js 和 Electron 已随包提供，解压后即可启动。请保留目录结构。

| 走查项目 | 双击入口 | 重点 |
| --- | --- | --- |
| 采集和核对 | `Start-Team-Pilot-Candidate.cmd` | 依次检查实习生、助理、经理和合伙人的任务与资料范围。 |
| 订阅和席位 | `Start-Team-Billing-Candidate.cmd` | 检查技术管理员的年费、增购和按订单号查询，以及退款负责人留痕。所有收款回执均为合成。 |
| 官网口径 | `Start-Website-Preview.cmd` | 在浏览器核对产品描述、下载与购买入口表述。 |

桌面账号和合成密码显示在启动窗口。每次启动都会在 `review-runs` 创建独立演练编号、合成数据库和电脑绑定配置。采集的四个角色请在同一次启动中依次登出和登录。关闭桌面应用即停止对应合成服务；官网走查结束后，在其启动窗口按 Ctrl+C 停止预览。

本包自带合成资料。请使用预置文件和订单完成评审，真实客户资料与正式手机号不进入本包。双方按各自负责范围填写回执。

- [双人评审单](docs/PILOT_OWNER_REVIEW.md)
- [资料采集演练](docs/TEAM_PILOT_REHEARSAL.md)
- [订阅与退款受理演练](docs/M5_LOCAL_ACCEPTANCE.md)
- [官网预览说明](website/README.md)

核对交付时可使用 `owner-review-manifest.json` 中的字节数和 SHA-256。保留接收时的原 ZIP，演练产生的 `review-runs` 留在解压目录。
