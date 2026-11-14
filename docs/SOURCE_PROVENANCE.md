# 源码快照来源

初始GitHub main从原Sites仓库提交 `d4bc1f42b81604f01ec63a6bd74e3573f9c3717f` 导出当前需要的源码，不复制原Git历史和工作区外文件。原工作目录与远程均保留。

## 筛选

- 保留 authored dist、tests、server、hosting-server源码与非案例敏感技术文档。
- 不复制旧delivery-source重复交付副本。
- 不复制真实Sites部署manifest、依赖、生成输出、QA、业务原件、浏览器数据库。
- 旧README/GOAL/BACKLOG混有陈旧状态与具体业务核验细节，因此新写协作接续文档，不把它们作为当前完成证明。

## 跨平台调整

main不修改应用运行时代码、布局、公式或存储键。新增运行/测试工具、锁定开发依赖、协作和隐私文档。

一项历史测试曾以Windows CRLF全文哈希约束批准范围，新clone的Git文本为LF。仅将该断言改为统一LF后比对；三个旧基线均先验证其CRLF哈希确实匹配原批准值，再转换成等价LF基线。未删除断言或放宽改动范围。这不是应用业务修改。

此前本地报告和成本导航修改另存 `work/report-four-sources`，提交与PR差异可查看；不混进main基线、不把“有代码”称作已发布。
