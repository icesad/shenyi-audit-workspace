# 审计准则基线与账表校验边界（v52）

核验日期：2026-11-12。仅使用财政部、中国注册会计师协会公开原文；本次已实际打开下列五份 PDF 及发布通知、档案管理办法。本文是产品设计基线，不是事务所执业制度、全套准则清单或项目合规结论。

## 一、版本定位

五份 PDF 首页均标注 **2022 年 12 月 22 日修订**。财政部财会〔2022〕36号通知规定，1211 等本次修订及其余准则的一致性修订于 **2023 年 7 月 1 日**同步施行。不得以下载路径中的 `202105`、文件抓取标题、2007 年版本或 2022 年 1 月版本代替正文版本。[财政部发布通知](https://kjs.mof.gov.cn/zhengcefabu/202301/t20230103_3861825.htm)、[中注协转载通知](https://www.cicpa.org.cn/xxfb/tzgg/202301/t20230103_63902.html)。

以下是本次核验范围内采用的版本；上线或执业制度变更时仍须重新核验，不宣称覆盖后续所有修订。

| 准则 | 本次核实的要求（摘要，非原文摘录） | 对产品的限制 |
| --- | --- | --- |
| [1101：注册会计师的总体目标和审计工作的基本要求](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412544783594856.pdf) | 第20、22条：合理保证并非绝对保证，整个审计过程需要职业判断与职业怀疑。 | 算术相符不得显示“审计通过”“无错报”或自动生成审计意见。 |
| [1131：审计工作底稿](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412544634066713.pdf) | 第9—11条：及时记录程序、结果、证据、重大判断，以及测试标识、执行人与日期、复核人与日期和范围；第13条要求记录矛盾信息的处理。 | 自动建议、人工确认与复核须区分；修改、证据来源及矛盾不能被界面状态掩盖。 |
| [1211：重大错报风险的识别和评估](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412543439237956.pdf) | 第17—19条：风险识别评估为进一步程序提供依据，不能排斥矛盾证据；程序还包括询问、观察和检查。 | 账表钩稽只是辅助步骤，不替代风险识别评估或完整审计程序。 |
| [1301：审计证据](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412542695263912.pdf) | 第11、13、15条：评价相关性及可靠性；使用被审计单位生成信息时，评价准确性、完整性和适用精度；矛盾或可靠性疑虑需考虑追加或修改程序。 | 导入成功、哈希相同或借贷相等本身不能证明真实性或完整性。 |
| [1313：分析程序](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412542529330962.pdf) | 第5—7条：考虑适用性、数据可靠性、预期精度和可接受差异；必要时调查差异并获取佐证或实施其他程序。 | 本版精确算术比较不等于已执行完整实质性分析程序；不代设重要性或可接受差异。 |

## 二、归档规则

- 1131 **第17条**：报告日后或业务中止后 60 天内归档；**第18—20条**：最终归整后不得提前删除，至少保存 10 年（从报告日或中止日起）；后续必要修改须记录具体理由、变更人员和时间以及复核人员和时间。报告日后追加程序另见第15条。这些条号以本次 2022 修订原文为准。[1131 官方全文](https://www.cicpa.org.cn/ztzl1/Professional_standards/xxzztx/zyzz/sjzz/202105/P020240412544634066713.pdf)。
- 《会计师事务所审计档案管理办法》（财会〔2016〕1号，2016-07-01 施行）第7—8、10、13、23—28条分别涉及立卷索引、变更记录、最低保管期、保密、到期鉴定及销毁程序、电子档案防篡改和备份检查。到期不等于可自动销毁，导出 ZIP 也不等于完成制度性归档。[财政部、国家档案局官方全文](https://www.mof.gov.cn/gkml/caizhengwengao/wg2016/wg201603/201607/t20160705_2344734.htm)。

## 三、本版工程解释（不是准则原文）

产品顺序为：接收并保留原始资料 → 人工确认项目范围、列映射和资料完整性 → 有限账表算术检查 → 显示差异及来源 → 人工调查、确认或拒绝填写建议 → 执行人员记录与复核 → 按事务所制度归档。此顺序是软件工作流，不声称准则规定只能按该线性顺序执业。

本版纯引擎不读文件、不联网、不访问存储、不回写底稿、不决定权限或归档状态。它不能证明完整的账簿已导入，也不能识别故意未标注的汇总行、虚假交易、遗漏资料、财报编制基础错误或需要调整/重分类的业务判断。实际适用性由事务所与项目人员负责。

### 已冻结接口

浏览器全局 / CommonJS：`AuditReconciliation`。

```js
const input = AuditReconciliation.createInputTemplate(scope);
const download = AuditReconciliation.templateDownload(scope);
// download = { filename, mimeType, content }；UI自行创建下载动作，无隐式网络请求。
const result = AuditReconciliation.reconcile(input);
```

`scope` 必须包含下列七项，三个数据集的 scope 须逐项完全相同：

```json
{
  "projectId": "明确的项目ID",
  "entityId": "明确的主体ID",
  "currency": "CNY",
  "unit": "元",
  "periodStart": "2025-01-01",
  "periodEnd": "2025-12-31",
  "scale": 2
}
```

- 根对象：`schemaVersion:1`、`scope`、`ledger`、`trialBalance`、`statements`、`statementMappings`、`balanceEquation`。
- 每个数据集：`scope`、`mappingConfirmed:true`、`complete:true`、`rows`。前两者还须有 `accountLevel:'leaf'`。模板将确认项置 `false`，不得导入后自动改为 `true`。
- 序时账行：`{rowId,voucherId,lineId,date,accountCode,debit,credit}`。凭证 identifier 在确认期间内唯一；`voucherId + lineId` 为重复检测键，同一凭证不同分录不是重复。
- 科目余额行：`{rowId,accountCode,opening,periodDebit,periodCredit,closing}`。余额为 `{signed:'-40.00'}`（借正贷负），或 `{debit:'0.00',credit:'40.00'}`，不得混用。借贷余额列非负且至多一方非零；发生额允许明确负数表示红字冲销，不取绝对值。
- 财报行：`{rowId,lineId,opening,closing}`。本版只处理**期初/期末余额式行**；不可将利润表、现金流量表发生额或带调整/重分类的财报金额直接冒充余额映射。相关事项须后续单独模型和人工确认。
- 财报映射：`[{lineId,confirmed:true,terms:[{accountCode,sign:1}]}]`，`sign` 仅允许数值 `1` 或 `-1`。逐行明确映射到末级科目，不按名称、科目号前缀或方向自动猜测。
- 恒等式：`{confirmed:true,assets:[lineId],liabilities:[lineId],equity:[lineId]}`。三组均明确选行，禁止同选总计和明细而重复计数；不存在的行及映射科目重叠均提示待处理。
- 每行必须保留稳定、唯一的原 `rowId`。可选 `parentAccountCode`、`level`、`isTotal`、`isSummary` 用于明确的混级拦截；不能仅凭科目号前缀判定层级。若原行带 `scope` 或任一范围字段，必须与根范围一致。
- 金额**仅接受十进制字符串**。允许 0 至 6 位指定小数精度、最多 30 位整数；内部使用 BigInt，无浮点舍入。空白、未知、JSON number、千分号、指数、小数位超限均不是零。应由列映射界面明确保留原数值及格式转换选择；本引擎不自动换币种/单位。
- 每数据集 1 至 50,000 行，每财报行最多 2,000 个映射科目。不支持空集合默认为全部为零；完整且有效的序时账中某科目没有分录，才将该科目发生额作为已知无发生额进行对比。

### 输出与颜色

`checks` 每项含 `id`、`label`、`status`（`pass` / `fail` / `incomplete`）及 `references`；能比较时另含十进制字符串 `actual`、`expected`、`difference = actual - expected`。`issues` 含 `code`、`severity`、`message`、`references`。引用为 `{dataset,rowId,rowIndex,field?}`，`rowIndex` 从 0 起，仅辅助定位，不替代原始行标识。

校验包括总借贷、逐凭证借贷、逐科目发生额对比、期末滚动公式、余额表期初/期末平衡、财报逐行明确映射和资产负债恒等式。`summary` 只统计检查状态。

全部有限检查满足且没有待处理问题时，`eligibleForSuggestions:true` **仅表示具备生成待人工审核建议的技术条件**。始终 `automaticWriteAllowed:false`、`auditOpinion:null`。颜色只能表示该检查/建议的状态，必须同时有文字；不得让绿色表达“资料真实”“已复核”“已归档”或“审计通过”。

把建议应用到表格属于调用方责任：需绑定原始资料/映射版本及目标单元格、显示前后值，检查锁与会话状态，明确人工确认并留痕；数据或映射变化后旧建议必须作废。引擎不提供可绕过这些要求的写入接口。

## 四、验证范围

`tests/audit-reconciliation.test.cjs` 使用合成数据，覆盖缺数、方向、精度、重复、混级、范围、映射及恒等式等算法边界。通过这些测试不代表真实客户账套已经验证，不替代真实资料及事务所认可样例的人工验收。
