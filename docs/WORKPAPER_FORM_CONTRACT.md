# M4Q 原表解析、字段准入与授权查阅合同

## 后续填写保存状态（2026-11-17）

本文件的原阶段之后已接入服务端填写CAS、不可变追加版本和本人原操作回执，详见[填写合同](WORKPAPER_ENTRIES_CONTRACT.md)。原证据保持其范围；团队导出与正常桌面仍待完成。

以下历史记录保留各自阶段范围，当前状态以上述检查点为准。

接续[首次导入与版本](WORKPAPER_DATA_CONTRACT.md)和[底稿三权](WORKPAPER_ACCESS_CONTRACT.md)。本阶段从已迁入的不可变原件解析真实Excel／Word，给出原表内容及可写位置的技术约束，并提供独立read下的只读原表接口，为后续填写CAS提供服务端准入。当前不提供填写、复核、冻结、重开或团队导出；完整M4Q和Goal继续进行，不以字段模型代替可用的团队填写。

## 来源与读取

新增 `GET /api/teams/:teamId/projects/:projectId/workpapers/forms/:fileSha256`。精确查询为version、projectRevision和grantRevision三个正安全整数；要求既有设备签名／当前单会话持钥租约、团队与项目普通高级业务资格、明确底稿read及当前正式来源。owner、职级、采集／资料／立项来源／账表权和技术管理员均不替代read。

从指定不可变版本解析原件引用。原包按项目作用域取出并核对外层SHA及字节长度，再按原始路径定向读取、核对实际Office SHA；保存的index不是内层内容认证。补充底稿可用自身已引用原件，不必伪造归档别名；存在未引用物理文件也不放行。同SHA候选不能跨Excel／Word类型猜测。W→Q及已审核旧Q均复用现有来源解析。

正文／原件收集和最终响应分别在同步只读事务内检查总写入数；解析等待期间不持有数据库写事务，以便合法撤权。线程完成后再检查当前账号、权限／grant版本、来源stamp和所请求版本的记录SHA；撤销、ABA或重新登录后不返回迟到内容。解析失败返回一般422，不回传Office内部异常或部分字段。无效／异团队／无读权返回既有拒绝语义；除GET外405。

响应给出原表、历史版本／当前head版本、保存rev、记录SHA、来源Q、项目及grant版本。物理可编辑位置属于原件模型描述，不是用户填写权限；未来写入仍须当前read && write、active项目、CAS及原件／冻结校验，不能提交客户端自报字段清单。

## 复用原实现与隔离

使用已有 `workpaper-xlsx-source.js`、`workpaper-sheets.js`、原Excel版式plan、`workpaper-original-word.js`、完整 `tender-import.js` Office容器读取、`workpaper-docs.js` 与原DOC工厂。没有改写dist专业源码／公式／版式／模板。实际解析在Node worker_threads内；浏览器Worker API由线程内部VM适配（self、onmessage、postMessage、对象URL及错误事件），仅执行仓库内固定脚本，上传文档作为数据。JSDOM用于原Word XML／DOM逻辑，不运行上传脚本或加载外部资源；不执行公式、宏、链接、域或Office对象。

单进程复用现有大包permit：每账号／数据库一个相关操作，进程最多一个大解析；成功、失败和中止均释放。线程45秒、V8老生代192MiB／新生代32MiB／栈4MiB，响应模型上限32MiB；这些不是OS总内存或集群配额，也不是最大容量压力证明。原件文件最多16MiB，旧DOC仍按原2MiB／150000字符，DOCX继续原12MiB／正文XML4MiB及辅助XML512KiB限制。

Excel的ZIP按真实PK内容识别，改扩展名为.xls也不能绕过。先复用原压缩包读取检查全部成员的实际解压长度和CRC，总声明展开≤64MiB，再交给现有表格引擎；不只相信中央目录长度。原解析的120工作表、100万扫描／20万非空单元格等限制保留。原件原始字节和摘要始终不改写。

## 字段准入

Excel复用原模型中的公式、链接、数组和合并信息；补读同一引擎样式元数据以保护隐藏行列。隐藏工作表、隐藏行列、原公式／链接、整个数组范围及合并非锚点不允许改写。已登记原版式用原plan确定实际可见的原单元格引用，包括隐藏合并锚点在可见位置重新呈现的原引用，以及原打印区域空白格；不误将它们收窄为统计用fields清单或解析器已用区域。没有原版式时保留原通用视图的合法范围与合并锚点；严格阶段缺原版式仍拒绝。坐标须完整规范匹配并在Excel边界内，不能用尾随换行或替代拼写绕过只读格。

Word复用原render／parseXml／renderModel：native:pN等ID来自原段落与表格；公式／域／链接／对象等原锁定段落及被合并隐藏的内容不开放。普通文字仍为原位置的独立纯文本填写，不将统计用空格／占位符清单误作全部编辑权限。旧DOC有准确版式时沿用其正文长度／索引；缺版式且原规则允许时保留原pN正文视图；严格阶段不降级。未以合成样例宣称已验所有真实旧DOC原版式。

复用原WorkpaperGovernance.isLocked，已冻结Excel作用域标记readonly，Word冻结清空可写位置；历史快照仍可读。技术校验不构成专业复核或新的冻结／重开规则。

## 验证与后续

新检查覆盖真实合成XLSX、含显式BIFF8 FORMULA／ARRAY／ROW的XLS、DOCX和CFB旧DOC，及公式／链接／数组覆盖／隐藏／合并／坐标／原型名称／明文值／畸形容器／实体／CRC和改名绕过。服务端使用真实Ed25519签名Request与隔离SQLite，覆盖独立read、低职级／跨团队、伪造内层index、补充原件、冻结、只读额外写回滚，实际工作线程完成点的撤权／重新登录及正常释放对照。

真实Chrome加载旧解析源码，对四类同字节样例与Node原始值／Word模型和字段ID作对照，并检查无pageerror／远程请求。上述是解析器对照，不是正常桌面UI、原生窗口、TCP/TLS、业务模板或独立验收。证据 `D:/codex-temp/shenyi-workpaper-entries-20261117/`；最终相关门及源before／after另附结果。

下一步继续同一M4Q：使用这里的服务端原件准入实现read && write下的填写CAS、不可变追加版本／原编号回执，保护原冻结及人工修订来源，再接团队read && export与正常桌面。实际客户迁入仍另行授权；独立agent受既有额度限制待恢复，不由root自测替代。实际共享库本轮未打开／升级，正常一键未针对新增接口重验，未push／main／上线。

## 当前root结果（2026-11-17）

最终36文件相关门756/756、0fail／skip／cancel／todo，483.969秒；1217源before／after raw一致，TAP SHA `a9e20b4197f3dde390e1a39bdb5c21ca7e05cc82c2a84527c2e5818866bd685d`。原runner发现241个可移植文件／63个整browser文件粗排除；本阶段未运行完整严格门。实际Chrome四种原件解析对照另有报告，包含在本相关门中，不重复累加。

保留首轮Worker浏览器事件／self适配失败；合成XLS工具未写公式和隐藏行，补显式BIFF8 FORMULA／ARRAY／ROW并调整BOUNDSHEET偏移，原断言未放宽。最初DOCX容器代理过宽，被真实Chrome对照发现后替换为完整原TenderImport；补齐合法合成容器并保留缺Content_Types拒绝测试。初版线程结果截停harness实际等到45秒超时，未作最终证据；改在真实once完成点等待，增加未撤权正常释放200对照，撤权／重登录仍拒绝，最终门执行。
