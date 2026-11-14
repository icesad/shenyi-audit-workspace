# 报价规则目录与版本包试行规范

状态：技术试行，未接入界面或持久化，不含正式费率。使用 `dist/rule-catalog.js` 的 `RuleCatalog`，Node 与浏览器均可加载。

## 地区范围

`PROVINCES` 是 34 个省级地区名称与六位编码的前端选择目录；不提供地级市和区县的计费配置。台湾、香港、澳门仅为地区范围占位，其执业资格、币种、税务和收费规则均需另行核实，不暗示已支持当地业务。不默认存在收费标准，也不从任何其他省份自动套用。行政区划数据与业务适用性应在正式发布前按权威资料另行复核。规则包的地区名称只能使用与编码对应的完整名称或去除省、市、自治区、特别行政区等后缀的简称；校验后统一保存完整名称，不接受名称与编码不匹配。

## 规则包结构

示例纯属虚构，不作为收费依据：

```json
{
  "schemaVersion": "1.0", "firmId": "TEST-FIRM", "ruleId": "DEMO", "version": "1",
  "region": {"code": "450000", "name": "广西", "level": "province"},
  "auditType": "annual", "status": "custom_unverified",
  "source": {"type": "example", "title": "虚构示例", "url": null},
  "effectiveFrom": "2025-01-01", "effectiveTo": null,
  "review": {"reviewer": "", "reviewedAt": null},
  "calculation": {"mode": "fixed", "basis": "assets", "fixedYuan": 123},
  "notes": "仅测试，不构成实际收费"
}
```

`status` 取 `draft`、`historical_unverified`、`custom_unverified`、`approved`。`source.type` 取 `official`、`third_party`、`firm_internal`、`example`。已核定必须具备审核人和审核日期，且不能以示例来源冒充。上述状态是数据标记，不证明来源真实、现行或适用。生效日期闭区间，不确定时不能自行猜测。

`calculation` 为 JSON 数据，不接受函数。模型目前只检查计算模式和基数名称，不检查档位完整性、金额精度或全部模式参数；接入计算前须调用计算引擎并做独立校验。`budget` 需要工时预算数据，不适用于 `calculateScale`。本规范不承担任何市场费率真实性保证。

## 操作与安全边界

`emptyCatalog()` 创建空库；`append(catalog, rule)` 返回新库，不会在同一事务所、规则编号、版本组合下覆盖旧记录，同一规则编号的地区与业务类型不可改变；`snapshot(catalog, {firmId,ruleId,version})` 返回独立深冻结快照。更新规则需新版本，已保存报价应保存引用与完整计算快照。

`lookup(catalog, {firmId,regionCode,auditType,onDate,allowedStatuses})` 默认只查 `approved`。允许列入历史或自定义规则必须显式传对应 `allowedStatuses`，UI 必须展示未核定状态；无匹配返回 `missing`，多条匹配返回 `ambiguous`，不能默默算零或自动挑最新。查询时由调用方确认选择和适用性。

此模块是内存内的不可变模型，不是数据库、权限、签名或防篡改系统。深冻结只防止正常代码误改；任何有执行环境控制权的人仍可替换整个对象。真正的版本唯一性、审计日志、跨所隔离、并发控制以及快照持久化，必须在有认证与事务支持的服务端单独实现。当前地区选项未经集成，不能称“所有地区有报价能力”。

## 回归验证

`node --test tests/rule-catalog.test.cjs`：覆盖版本不覆盖、外部输入变更不影响快照、来源和审核元数据、有效期、精确地区、默认只查核定规则、跨所隔离过滤、缺失、重叠歧义、34 个选项及港澳台占位。以上为单元测试，不替代服务端权限和业务核定。
