# M4Q 底稿团队接入合同

## 当前接续：旧端完整包导出已测，团队数据仍待接

M4Q完整项目底稿包及旧版显式导出已接候选：保留原 ZIP、已保存填写、补充底稿原件及既有冻结快照，按底稿白名单排除报价／合同／发票／报告／账表等模块；旧版正常底稿页提供“导出已保存完整底稿包”。原冻结校验沿用，保存版本、原件字节／MIME和原项目Q保持，试用保留UUID明确拒绝。团队端首次导入、实际原表查阅／填写CAS／导出与正常桌面仍待接入；不以旧端导出代替完整M4Q完成。

固定Node24按18个相关文件，最终320/320通过、0失败／跳过／取消／todo，43.015秒；1189候选文件before／after raw一致。真实Chrome旧正常index实际下载，并由Node和Chrome双向读回；逐库typed行／结构及全部Blob哈希保持，1次下载／1次URL创建释放、0业务写入／计算。1280×900和900×900均已复看，最终图与早先已看图逐byte同SHA，无横向溢出；来源同rev填写／编号／立项变化和页面失效拒绝发布，独立试用按钮禁用。上述为root相关门，不是完整严格门、Windows原生或独立验收。

前项M4P及本项授权基础的独审仍待额度条件恢复，不因root通过改判。包层没有新增HTTP／schema／IPC，实际共享库未打开／升级；团队一键入口未针对本轮重验。未push／进入main／上线，M4及完整Goal继续active。详见[完整底稿包合同](WORKPAPER_PACKAGE_CONTRACT.md)；证据 `D:/codex-temp/shenyi-workpaper-package-20261117/related-final/related-report.json`。


## 目标及决定

最终形成正常桌面可用的底稿查阅、填写、导出闭环；沿用[已确认三项独立授权](WORKPAPER_ACCESS_DECISION.md)，填写／导出同时要求查阅。此目标包含实际原表、已保存填写和导出，不以仅能配置权限或只读快照代替完成。

已完成的第一步只接服务端授权基础：独立项目选择、本人权限、负责人候选人员与密码授权、撤权与资格变化；本步不是完整底稿模块。后续按原表／来源适配、服务端数据与CAS、桌面填写与导出、分层和独立验收顺序继续。不新增第二套审计计算或模板系统。

分支 `codex/workpaper-access`，base `af0c942d53520bcf6ad36dddc8eb723fb65fc4e0`。前项M4P仍待独立复核，证据绑定其原实现，不因本项开发被重新标为通过。M4和完整商业化Goal均继续进行。

## 授权基础接口

- `GET /api/teams/:teamId/workpaper-projects`：仅本人负责人项目或明确底稿查阅项目，先授权再搜索／分页，仅投影团队、ID、标题、状态和项目版本；不返回底稿目录、内容、来源Q、客户金额或其他模块摘要。
- `GET /api/teams/:teamId/projects/:projectId/workpapers/access`：本人三项配置及有效AND能力；负责人无读权也仅可管理授权。
- `GET .../workpapers/members`：仅当前负责人可查本团队合格经理／合伙人的最小姓名／职级和必要版本及本模块配置。技术管理员业务兼任仍须既有独立批准；最高审核身份排除。
- `POST .../workpapers/access`：八字段固定JSON，`projectRevision,userId,memberRevision,grantRevision,read,write,export,currentPassword`；前四版本／账号绑定，三权限布尔值必须齐全，当前密码不入审计。409要求刷新，不隐式重发。

以上均要求真实现有设备签名网关、当前持钥租约、服务UUID、有效团队／普通业务身份。body／密码工作后及事务内重查actor、owner、目标资格和版本；授权恰好一份grant更新及一条不可变审计，额外业务写入导致回滚。八种三权组合可分别保存；无read时write／export不能执行，读权撤销不隐式回补。

只读列表与access不得产生业务数据写入。冻结项目可查已有权限与允许的只读范围，不能改授权或填写；读＋导出不代表后续导出内容已实现。本阶段没有底稿原件、目录、编辑、导入、复核或导出数据接口，新路径不得借旧模块旁路。

## 数据和撤销

只在隔离团队数据库新增两表 `team_workpaper_access_grants`／`team_workpaper_access_events`；旧77表／290定义的行与定义保留。新表和资格触发器只保存三权、版本、资格与审计，不自动扫描本机IndexedDB或上传原件。

grant身份不可改／不可删，版本从1单调加一，溢出拒绝；审计不可改删。角色／成员／团队／账号／技术兼任／最高审核历史及owner资格变化使已有授权失效，恢复旧身份不能自动复活。员工停用、职级变化和项目全撤权在原事务内清三权并留痕；不能只隐藏菜单。已有底稿授权历史存在时不得重建服务UUID。

## 完整底稿包（来源流程已确认，数据实现待接）

用户已确认由旧端显式导出完整项目底稿包，负责人核验原 ZIP、已保存填写和冻结快照并验证密码后首次导入，后续团队内按版本保存。旧版治理JSON序列化整个record且省略二进制，不能直接充当该完整包。实施须按底稿白名单封装，排除报价、合同、发票、报告草稿等无关模块内容；保留Q、原包／原文件SHA及冻结绑定，不自动扫盘、迁移或重编身份。

完整包的二进制布局、容量与嵌套解压限制须依据原读取器实测确定，不能凭此合同宣称导出、上传或恢复已实现。实际客户资料另行授权，专业复核／冻结／重开规则仍待米老师明确。

## 旧版适配边界

- `project-workspace-store.js` 的 `choices,directoryRevisions,archive,riskArchive,workpaperSources,workpaperRouteSelections,answers,docAnswers,workpaperLocks,workpaperReuseProvenance,autoFillProvenance,supplementalWorkpapers` 分属目录、二进制原包、填写、冻结和来源；不把整个record当作可任意覆盖的JSON。
- `workpaper-workspace.js`／`workpaper-directory-ui.js` 的打开、在线填写、原件下载、填写副本、目录JSON及治理备份是不同数据出口。原有本机备份明确省略二进制，不可当作完整团队迁入包。
- `workpaper-governance.js` 已冻结范围继续只读，保持原件、选择、路由及快照哈希绑定；旧姓名不成为团队复核身份。
- `workpaper-reuse-ui.js` 涉及跨项目通用文字选择和回填，现有三权不自动允许搜索或读取未授权来源项目；具体复用能力单独明确后接。
- `report-inline-tb.js` 的9200同样读写 `answers`，必须与底稿填写统一CAS／冻结规则，不能通过报告入口绕过权限。
- 原公式／链接、原包哈希、原项目Q和团队W关联、原件与版本历史必须保持；原库不自动迁移。报告PR #2仍待验收，不自动合并。

## 验证与完成门

当前基础结束检查：固定Node24新API／对抗／schema测试，加原账表、立项来源及项目／角色／停用相关测试；保存原TAP、失败记录、before／after源指纹。新增测试应覆盖三权八组合、无继承、低职级及跨团队、候选分页、body／KDF和事务竞态、角色ABA、超限版本、恶意触发器及COMMIT回滚、停用／全撤权、旧表行与DDL及幂等升级。相关测试通过不称完整严格门或桌面验收。

整个M4Q完成仍需：来源和原件适配；实际读取、填写CAS与导出；正常UI及窄IPC；真实Windows正常入口与旧兼容；完整原严格门；独立agent安全／数据验收。Mac、生产、真人选取和两负责人业务签收按整体路线分别完成。独立额度不足不能由root自测替代，不为绿灯放宽旧测试或历史schema基线。

当前检查结果与证据以[进度](../进度.md)、[状态](STATUS.md)及仓库外报告为准；无证据项目保持未完成。

## 服务端授权基础检查点（2026-11-17）

固定Node24按合同运行16个相关文件，507/507通过，0失败／跳过／取消／todo，353.500秒；1181候选文件before／after raw SHA一致，连续TAP1..507及footer／exit0已核对。此为root相关门，不是完整原严格门、原生或独立验收；4个新增测试文件已被原单元runner发现（当前230选入／61整文件浏览器粗排除）。

隔离库为79表／319定义，新增两空表、26触发器和1索引；原77表／290定义所有typed行（含auth）及UUID保留，幂等／integrity／FK通过。19份旧测试只23处精确导入／状态投影适配，原断言调用与数字常量逐byte可逆保持；新增层以29项确切DDL SHA和两空表校验，不允许任意偏移、额外对象或非空资料被剥离。范围root核对为6份旧服务端文件加5份新服务端文件，dist／desktop／shared产品源未改。

早期API门8pass/1fail为旧fallback未知POST返回405/Allow GET而非404；固定已验证的原拒绝语义，未改产品放行。首轮35项门34pass/1fail真实发现旧“全撤权”外层预检遗漏底稿-only授权，已修复，后续507门同时证明进入真实撤权审计及恶意恢复回滚。原失败及修前源、测试改动均保留。孤儿历史测试使用无任何旧设备历史的全新隔离库，分别证明新grant和event本身阻止重建UUID。

证据 `D:/codex-temp/shenyi-workpaper-access-20261117/related-report.json`、`related.tap.log`、`legacy-import-adapters.json`、`scope-root-audit.json`；旧端9份关键源只读SHA清单为 `legacy-workpaper-source-inventory.json`。两实际共享库本轮未打开／迁移，当前桌面一键未针对新增授权重测；前项M4P当次一键记录仍仅覆盖其原候选。原生、完整严格门和独审继续保留。
