# M4Q 完整项目底稿包 v1 合同

## 范围与已确认来源

用户已确认旧端显式导出完整项目底稿包，负责人核验原 ZIP、已保存填写和冻结快照并验证当前密码后首次导入团队，后续团队内版本保存。整体[三权与团队接入合同](WORKPAPER_ACCESS_CONTRACT.md)不变；本阶段实现包编解码和旧版正常页面显式下载，团队端导入、填写CAS、导出权限执行及正常桌面仍待接入。

实现为 `dist/workpaper-package.js`、`dist/workpaper-package-export.js` 和原 `workpaper-workspace.js` 的一个“导出已保存完整底稿包”按钮。没有新增原库写入、公式计算、模板关联、复核、冻结或解冻动作；不会自动扫描其他项目或上传资料。实际客户资料迁入仍另行授权。

## 白名单和来源

记录只投影 `id,rev,updatedAt,choices,directoryRevisions,archive,index,riskArchive,riskIndex,workpaperSources,workpaperRouteSelections,answers,docAnswers,workpaperLocks,industryTag,workpaperReuseProvenance,autoFillProvenance,workpaperReuseTemplates,supplementalWorkpapers` 中原来存在的字段，保持缺省／空值区别和原键顺序。未保存输入不在包内。复用模板、来源及历史核对姓名仅保存既有底稿事实，不构成团队复用、模板批准或新复核授权。

报价、客户立项表、合同、发票、报告草稿、账表结果、材料原件及归档链接不混入包内，不以整个workspace JSON备份代替白名单。它不是全软件／全项目资料备份；材料保全仍走材料合同，归档模块后续独立接入。

只接受已保存的UUID项目和正安全整数rev；明确拒绝旧版保留试用ID `00000000-0000-4000-8000-000000000033`。旧端从已有workspace、正式立项与固定编号库只读核验归属，不创建缺失库、分配新编号、保存或计算。固定身份、立项来源及白名单内容在导出中途变化即拒绝发布；记录rev不变而内容变化也要拒绝。独立本机库的最后settled读取并不构成跨库全局串行事务或身份签名。

## 二进制格式

固定stored ZIP，UTF8名称，无压缩／加密／注释／附加字段／分卷／ZIP64。仅含 `manifest.json`、`record.json` 及 `originals/<sha256>.bin`。原件按SHA去重，记录各槽位的原始MIME、长度与摘要；保留原ZIP字节而不重新序列化Office文件。同字节的不同MIME／槽位仍分别保留元数据。

清单严格固定字段与策略，保存源Q／原workspace版本、record长度与SHA、按entry排序的原件清单和创建时间。record只在明确原包或补充底稿的blob槽位使用二进制引用；用户填写中长得像引用的普通对象不转成文件。JSON严格按本版本发出的UTF8紧凑表示读回，拒绝重复键、BOM、非有限数、活动属性／函数、环、数组空洞及超深数据；原型名称作为被动数据安全保留，不改变对象原型。

检查中央目录／本地头逐项一致、CRC、SHA、成员数量及边界；拒绝路径穿越、未知／缺失／重复成员、重叠、尾随数据、伪造超大长度及清单外原件。manifest固定 `identityAuthenticated:false,professionalApprovalClaimed:false,teamImported:false`；SHA及旧冻结快照校验不证明现实业务真实性或新的审计审批。

## 原规则和容量

复用原 `WorkpaperGovernance.assertTransition` 和 `SupplementalWorkpapers.validateShape` 校验冻结绑定及补充底稿，不修改专业规则。原ZIP按自身SHA核对，原冻快照及已冻结填写必须逐项保持；获填写权不会解冻。包层将内部ZIP作为原始字节保留，不在本阶段宣称已经重新解析全部Office版式、外链或公式。

容量来自旧输入上限：16个workpaperSources加两个旧archive／riskArchive槽位，每个24MiB；补充200份、单份12MiB、合计64MiB。原件去重总量≤496MiB，record≤32MiB，manifest≤1MiB，总包≤530MiB、原件≤218份；数据节点≤1000000、深度≤40。数值是格式接收边界，最大容量的真实设备压力／部署容量验收尚未完成；不能因此放宽现有HTTP请求体或一次上传整个大包。

## 当前验证门

新编解码对抗门、原冻结／补充底稿／原stored ZIP兼容、旧HTML固定hash及原公式相关检查；真实Chrome通过旧index下载并由Node与Chrome双方读回、校验原件与冻结快照，逐库保留全部typed记录及Blob SHA，测试迟到源变化及页面关闭零发布。原浏览器测试使用已有Chrome且不豁免skip；源before／after SHA、TAP、实际截图和限制保存在 `D:/codex-temp/shenyi-workpaper-package-20261117/`。

以上是root候选检查，独立验收仍待额度条件恢复，不能由自测替代。完整M4Q仍须完成团队数据服务、正常桌面填写／导出、原生、完整严格门及独立复核；Mac、生产、真人选取、真实脱敏业务样例和双方业务签收继续按整体Goal完成。

## 2026-11-17 root检查结果

最终相关门320/320、0fail／skip／cancel／todo，18文件、43.015秒；1189候选文件before／after SHA一致，顶层274项连续与plan274、嵌套项及footer总320和exit0核对。原runner可发现新增单元和浏览器文件；完整原严格门未在本阶段运行。

真实Chrome正常index下载为5984字节，SHA `e8e16115d70fe0e2eaa54f07e6f63960ff0ec3859201cc28423dd775ffb5ca16`，源项目 `a3fc78ee-4052-4aa5-85d5-8b3f9ccf0471`／rev7，2份唯一原件／240字节及1份冻结快照。fixture使用合成内层文件，不作为真实Office解析或专业业务验收；原件作为不透明字节保全。Node与Chrome读回一致，全库typed行及Blob哈希前后相同；无pageerror或外部请求，1anchor／1URL创建释放、0save／计算／读写事务。截图1280及900宽无横向溢出并已复看，最终图与首轮已查看图raw完全相同。

初次新codec42项40pass/2fail为VM创建的冻结对象没有按IndexedDB语义克隆到本realm，已修正fixture，未放松被动对象检查。首相关300项295pass/5skip/0fail被严格wrapper判为FAIL；5旧浏览器例后按明确Chrome环境路径真实执行，原断言不变。原试用UUID可被纯codec封装的问题由新回归真实复现，随后codec／source／UI共同拒绝；修前43门41pass/2fail中另1项为随机CRC最高位导致测试自身有符号writeUInt32溢出，已改为直接异或一字节，攻击不变。失败记录和修前源／测试全部保留，均不改判成通过。

旧HTML hash守卫只添加两处明确loader投影，仍验证原固定hash；5旧浏览器文件仅10个路径表达式支持既有Chrome。六份旧测试的所有原断言、业务代码及数字常量不变，并逐byte逆向恢复前件。包loader新增变体检查拒绝缺失、重复、错序、异源、额外属性及其他未批准加载。

证据包括 `related-final/related-report.json`、`related-final/related.tap.log`、`related-final/browser/normal-index/`、`related-final/ledger-compatibility-browser/`、`loader-adapter.json`、`browser-environment-adapters.json`。上一步授权基础507门保持其原提交52e07c9证据，本阶段未改服务端源；不将320与507或旧4324相加。独审、原生、团队数据写入／导出及整体M4Q继续未完成。
