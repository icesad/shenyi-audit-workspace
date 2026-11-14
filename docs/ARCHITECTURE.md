# 架构与数据边界

## 六大模块

1. 招投标：报价测算、报价单、标书、报价历史。
2. 立项：中标项目登记、业务编号、项目安排、合同及发票信息。
3. 审计程序：资料收集核对、账表校验、底稿目录及各阶段表单、补充底稿。
4. 报告：9200试算平衡表、审计报告编制、底稿归档。
5. 核算：项目成本核算、费用报销填报。
6. 基础资料：投标方信息库、底稿模板、收费依据。

侧栏显示名和底层数据键不是同一回事。历史兼容键中的 hengdu 不应因品牌改为审易而擅自替换。

## 文件地图

| 区域 | 主要源码 |
|---|---|
| 页面骨架/导航/保存入口 | `dist/index.html`、`dist/app.js`、各模块CSS |
| 报价和地区规则 | `calc.js`、`regions.js`、`rule-catalog.js`、`quote-*.js` |
| 投标方资料和文档导入 | `bidder-*.js`、`tender-import.js`等现有读入器 |
| 立项/合同/编号/成本 | `project-*.js`、`contract-template.js`、`travel-expenses.js` |
| 资料层级/核对/预览 | `audit-outline.js`、`audit-checklist.js`、`audit-program.js`、`audit-preview-*.js` |
| 底稿原表和索引 | `workpaper-*.js`、`*-layout-catalog.js`、`workpaper-layouts/`、`workpaper-word-layouts/` |
| 报告与9200 | `report-workspace.js`、`report-inline-tb.js`及报告分支新增模块 |
| 本机项目存储 | `project-workspace-store.js`及模块专用store |
| 平台账号资料 | `server/profile.mjs`、`hosting-server/app/api/account/route.ts` |

## 数据流

```text
授权用户文件 → 本机格式身份检查/解析 → 明确选定项目的资料与表单
                      ↓                            ↓
                   原件哈希                   人工核对/版本保存
                      ↓                            ↓
               原公式/链接保留       报价Word / 底稿填写 / 本机归档副本
```

多数业务数据在浏览器 IndexedDB/localStorage，代码仓库只包含解析和展示逻辑及通用布局。平台账号资料服务不是客户账表的云端业务数据库。隐私提示与真实数据流需一致，不能为迁移电脑而暗中改成上传客户原件。

## 必须保持的约束

- 原件不可覆盖；多工作表、合并单元格、公式、链接按既有读取器处理，不能靠重新序列化声称百分百保真。
- 数值和资料有明确项目/主体/期间/单位来源，不能跨项目套用。
- 上传仅代表收到；核对由获指派人员确认，不把算术正确当作证据充分。
- 缺资料、不能唯一映射、公式缓存未重算时必须提示，不能猜数。
- 本机保存与版本比较（CAS）防止部分误覆盖，不是服务端强制权限。
- 报告意见、签发日期、注册会计师签字等不得从上年报告自动复制充当本年结论。

## 待验收报告分支

`work/report-four-sources` 新增 `report-evidence.js`（本项目来源读取）、`report-compilation.js`（严格校验/编制草稿）、`report-compilation-ui.js`（映射核对/编辑/保存/Word）。仅编制可编辑无章草稿，尚需真实脱敏样本和业务验收；主干与原网站不因此已更新。
