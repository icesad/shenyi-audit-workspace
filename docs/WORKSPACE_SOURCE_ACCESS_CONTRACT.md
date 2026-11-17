# M4O 立项来源独立授权、查阅及保存合同

2026-11-17。分支 `codex/workspace-source-access`，实现基线 `5b855c757de459d296140c683f1ad0c61c46d8c7`；前轮是 progress：M3E 已本地提交并验收，立项来源分权政策已记录。本合同记录本片实施范围、实际冻结接口与验收边界；Windows入口／旧兼容／共享保全已验，完整严格门状态 PASS，最终本地交付以外部 `D:/codex-temp/shenyi-workspace-source-access-20261117/final-delivery.json` 为准。开工 clean，fetch 后 main／origin main 仍为 `060a98e1c678188d5005d6f0a9a5c0841013c90f`，报告分支仍为 `894078b30de8c4669e8f73c380745455b752e8ae`。1108 原文件／51,358,212B 已逐 raw 备份并与 Git blob 核对，13 处既存 UTF-8 CRLF 差异保持；证据根目录 `D:/codex-temp/shenyi-workspace-source-access-20261117/`。

## 决策与完成行为

沿[已确认决定](WORKSPACE_SOURCE_ACCESS_DECISION.md)：项目负责人验证当前密码，分别明确为自己或本团队、本项目有效经理／合伙人配置来源查阅、导出权限。职级、负责人、技术管理员、材料权及另一项来源权不自动赠送权限。授权使目标成为本项目来源模块的参与者，不隐式授予采集或材料权限。

2026-11-17用户实际答复已冻结导出前置：执行导出必须同时具备明确查阅权与导出权（read && export）。两个授权标志独立配置；00全部拒绝、10仅查阅、01不能查阅或导出、11查阅与导出均可，均仍须来源、项目、身份与设备有效。保存01不自动补授read；撤销任一项立即停止新的导出及尚未发布的保存。该规则贯穿服务端、main和UI，不能只靠按钮隐藏。

本地候选中，正常项目工作台已有独立的立项来源入口；负责人可验证密码配置两项权限，获明确授权的非负责人能从正常项目列表进入。查阅显示已保存来源中的项目、立项表、报价快照、固定编号、历史负责人文本及中标事件，所有字段只作文本显示；注明中标报价不是最终项目金额、历史快照不是实时招投标状态。导出通过系统保存对话框保存原规范来源 JSON，不改格式、不生成包含客户原件的假“完整项目备份”。

范围同时覆盖 M4L `team_workspace_formalizations.source_json` 与 M4F `team_project_migration_provenance.source_json`。两者沿原 `LegacyProjectSource` 128KiB／1000 事件限制、校验、规范字节及 SHA，不改变业务公式、原编号、Q/W、不可变来源或回执。来源文件只证明已存来源一致；不冒称现实中标验证、签发资格或新审计结论。

## 原出口与最小披露

不能仅保护新接口。旧 formalization 自动 GET 在无来源查阅权时返回既有安全 context，`confirmation:null`；`canConfirm` 仍由原业务条件决定，已确认项目用现有 `businessConfirmed` 显示一般状态，不向旧自动 UI 发送 Q、来源标题、编号或 SHA。旧后续 receipt GET 须有新的来源查阅权；拒绝不能证明在途确认从未提交，unknown 的原 requestId 与单发锁保留，可在明确获查阅权后继续 GET 核对，绝不自动再 POST。

负责人刚主动选择本人本机文件并提交业务确认时，原 POST 的必要操作回执保持，但不种下任何后续来源权限；关闭、刷新、重连、换项目或失权后不把该临时操作回执当来源读取缓存。M4F 产品审核员仅本人的治理操作回执保持原 actor／request 范围和最小投影，不能借此查询原始来源或取得业务职级；这不是新专业模块授权。

既有材料清单和保全包仍需保留原Q身份，用于原材料namespace及恢复；本片不剥除这些已有业务标识。新来源权限保护来源正文、客户／金额快照及后续来源回执，不能据此声称全部材料出口的Q身份都被隐藏。

来源选择仍是本人主动读取本机文件的原确认操作，不能作为读取服务器已保存来源的替代路径。未获新权的列表、详情、计数、查询、错误及其他来源出口均不得泄漏新来源正文或标识。technical admin 与 reviewer 不因技术身份获得新权。

## 实际冻结接口与桌面边界

实际冻结HTTP基址为 `/api/teams/:teamId/projects/:projectId/initiation-source`：`GET /access` 返回 `{access}` 最小能力；`GET /members` 返回 `{members,hasMore}`；`POST /access` 显式配置两权；根 `GET` 返回 `{source,metadata}`；`GET /export?projectRevision=…&grantRevision=…` 仅在read && export及版本一致时返回原规范来源字节。未知键、重复查询键、类型强转和外来标识拒绝；取消保存仅为本地main操作，不新增通用网络接口。

`access` 为8字段：teamId、projectId、projectRevision、grantRevision、canManageAccess、sourceAvailable、read、export。成员页每项为id、displayName、role、memberRevision、grantRevision、read、export，q／after／limit沿已验搜索分页（默认20、上限50）。HTTP授权body恰为projectRevision、userId、memberRevision、grantRevision、read、export、currentPassword；桌面另收confirmed:true但不传入HTTP。成功为 `{changed:true,projectRevision}`，本操作不增加项目版本；目标来源grantRevision增加1，随后重读能力和成员。project／member版本仅比较，可到MAX安全整数；须递增的grant版本不能溢出。

查阅metadata为teamId、projectId、projectRevision、grantRevision、sourceKind、sourceProjectId、sourceSha256、byteLength；sourceKind实际取 `workspace-formalization` 或 `project-migration`。查阅根响应包装不改变来源JSON本身。导出固定UTF-8 JSON、private/no-store，校验规范长度与SHA和来源身份；renderer只接收保存结果的requestId／basename／字节数／SHA或取消结果，不接收目的路径、原始下载字节或私有传输hook。

实际追加六个窄RPC于原117完整前缀之后：`getWorkspaceSourceAccess`、`listWorkspaceSourceMembers`、`changeWorkspaceSourceAccess`、`getWorkspaceSource`、`exportWorkspaceSource`、`cancelWorkspaceSourceExport`。对应channel依次为workspace-source-access、workspace-source-members、workspace-source-access-change、workspace-source、workspace-source-export、workspace-source-export-cancel（均为shenyi前缀）。实际123方法／channel、22 form／27秘密输入已由preload／DOM及Windows入口核验；不暴露任意URL、IPC、路径、bearer、私有请求hook或文件系统。

access 只提供当前团队／项目、版本、本人有效能力、负责人管理能力及来源是否存在的最小事实，不含 Q、客户、金额或源 SHA。members 仅负责人可访问，先授权再搜索／分页，只给配置所需的用户ID、姓名、业务职级、身份／授权版本和两个显式标志。配置携带当前项目／目标身份／授权 CAS、当前密码与明确确认；原权限事实由服务端读取，不信任客户端角色或 owner。

查阅仅授权后下发经原 codec 校验的完整来源及必要校验信息；界面使用业务标签展示表单四项、报价八项、编号身份和事件，不执行来源 HTML／脚本或链接。保存字节仅留 main 私有内存，renderer 不收到原文件路径或保存目标路径。受信 HTTPS identity／UUID、每次设备证明、actor generation 和 stale-response 守卫均沿原机制。

main 对原始 JSON 采用专用、路径限定、GET-only、128KiB 上限的私有传输；不借材料 export flag 或放宽通用 responseLimit。逐 chunk 核验、取消时清私有缓冲区，内容须通过 canonical/SHA 校验。选择前、网络正文后、保存对话框返回后、原子发布前均 fresh 核验当前能力／项目和授权版本，换账号、撤权、暂停、取消或来源变化不能产生额外发布。保存用既有 wx 临时文件、fsync／close、fresh guard、rename 模式，旧目标和清理状态如实报告；任何可能已派发的业务写不得自动重放。

界面默认不自动加载财务正文。关闭面板、换项目／账号、设备 pause、重连、卸载以及授权版本变化清来源与密码；晚到响应、401及关开 ABA 不能污染后续账号。面板打开且空闲时每5秒刷新最小capability，发现失权清正文；正文读取中先清旧正文并暂停空闲轮询，避免慢网读取被反复取消，正文返回后再fresh核验才显示。保存处理中仍刷新capability，失权清屏并请求停止尚未发布的保存。关开后的新cap会淘汰旧正文请求；不声称撤回用户曾合法导出的文件。仅export而缺read时明确提示仍须查阅权，两个flag不联动补授。

## 真实操作与原JSON范围

1. 在正常团队工作台选择获授权项目，打开“立项来源与独立授权”。负责人在该区选择自己或本项目有效经理／合伙人，分别勾选read／export、确认目标并验证当前密码；只配一权不会自动勾另一权。来源尚不存在时可配置权限，但不补造正文。
2. 获read后主动点击“查阅已保存的立项来源”。source-only非负责人也从正常项目列表“打开项目”进入，只获来源模块，不随之获得采集或材料权；默认不自动取客户或金额正文。
3. 获read && export后，明确勾选本次保存范围并点击“保存原立项来源文件”，通过系统保存对话框选择位置。保存前后与原子发布前在线复核；main接受的取消请求及发布前fresh核验发现失权／账号或设备变化会阻止发布。进入原子发布后不能承诺撤回；结果未知时应核对先前位置，不自动重试，也不宣称已回滚。

| read | export | 查阅 | 保存原JSON |
| --- | --- | --- | --- |
| 0 | 0 | 拒绝 | 拒绝 |
| 1 | 0 | 允许 | 拒绝 |
| 0 | 1 | 拒绝 | 拒绝；另需明确read，不自动补授 |
| 1 | 1 | 允许 | 允许 |

所有允许项仍须项目未归档、身份／设备／会话／版本及来源有效。导出的是原 `LegacyProjectSource` 规范JSON（format／schemaVersion／initiation／quote／numbering／policy六个顶层字段，128KiB／1000事件原限制），不是查阅接口的 `{source,metadata}` 包装、材料ZIP、客户原件或完整软件备份。包含原立项四字段、报价八字段、固定编号／历史经理文字与报价事件；报价金额非最终合同金额，快照不追踪实时招投标变化，不构成专业签发。

## 服务端授权与保全

新增独立来源授权／审计侧表，原71表223定义和 typed 业务行逐字保留。新索引与触发器单列，不改旧 CHECK、主键或源 JSON。支持新 W 在来源尚未关联时明确配置项目模块权，但来源不存在时不伪造正文；Q来源及已确认W均沿原 namespace 验证。

来源权是独立项目可见性分支，不赋 `collection.read/manage/review` 或任何材料 flag；普通 projectScope／projectContext 的默认可见性须一致支持 source-only，高级采集动作仍走原显式采集条件。原“全部撤销项目授权”在同事务内覆盖来源 read/export，包括旧权限已全 false 的 source-only 目标；partial 采集变更不自行授新来源权。身份停用／职级与管理员兼任变动、离开团队、owner资格失效和项目归档须拒绝访问；ABA 不自动复活旧来源权，重新授予须负责人新操作。

正文读取、配置、传输及最终保存均核当前会话、设备私有 stamp／serverId、团队资格、项目状态、owner／目标身份及授权版本。POST body／KDF／BEGIN／审计写入后的事实变化、MAX、触发器或 COMMIT 故障须全部回滚；新增 source revoke 不使原项目 revision 双增。冻结项目可按既有显式权只读，不能修改授权或业务；归档拒绝当前数据。新 schema 与历史事实检测须使缺 UUID 的有历史库继续 fail closed，不为通过测试重建 serverId。

## 分工、结束门和交付

server agent 独占新授权 schema／policy／API／resolver／scope、必要 database／application／project visibility、旧 formalization 读出口及全局 revoke 接线、新 server tests。client agent 独占新 main／client helper、team-client／bridge／preload与新 client／entry／main tests。UI agent 独占 team-ui JS／HTML、一个新 DOM test 和本片原生 driver。root 负责合同／检查点、所有旧测试精确适配、跨层集成和最终证据；作者完成后交叉独立审查，不自行给自己安全验收结论。源文件改写前使用本次 baseline 或单独前件备份。

先专题真实 SQLite／client／DOM与相关旧测试，再固定源和独立权限审查；必须覆盖跨团队／项目／角色、source-only正常入口、无 read 的旧自动出口、owner不自动获权、单项撤权和全撤销、职级／停用ABA、body/KDF/BEGIN/COMMIT竞态、失权 held body／held save／换actor／断网、规范源字节与原件保持、unknown单发／GET核对。导出四组合按已确认read && export逐项验证，不提前写“通过”。

实际 Windows 正常入口完成负责人逐项授权、非负责人查看、规范JSON原字节保存、撤权清空／零发布及旧确认流程保持；真人系统picker和 Mac 不在场时明确未验。相关旧原生按影响选定一批，顺序执行，先失败停止，不扩大为无必要全21组。

完整沿原固定 Node24 `scripts/test.mjs --unit --strict`。开跑前盘点完整方法／channel数组及所有历史 schema peel；旧66/189、69/209等历史预期必须真重建旧库，不能抬历史数字或删保全断言。所有失败日志和不同 source epoch 保留；以全深 TAP 连续项／plan／footer／零skip和 raw before-after-current 证明通过，不拿4036旧结果代替新片。

共享库只由 root 在事先验证只读快照器后做前后真正 RO online backup；保全部旧71表223定义、auth无豁免、9／16合成账号及两UUID，新增表空，不自动授权或迁入客户数据。升级经两个原cmd正常启动，不碰8773旧端；禁止agent操作共享库／进程。仅本地候选与提交，未获授权不push/main/上线，整个Goal保持active。最高owner恢复、真实供应商／支付／国内资源、双平台签名发行及两负责人业务签收仍分别未完成。

## 本片验证索引

Windows正常入口12场景／7PNG／148依赖、旧8组strict兼容（265.265秒／577源）及四实际RO保全／两原cmd当次窗口协议均独审通过。server51、client93、UI34及client实际独审29等专题有重叠，不累加。旧71表223定义和全部typed行／auth、9／16账号／UUID保持，新增source两表空；原71→73／223→252仅加2表26trigger1index。完整Node24严格门状态 PASS，最终数量／耗时／日志／独审只见当前检查点和外部 `D:/codex-temp/shenyi-workspace-source-access-20261117/final-delivery.json`。M4整体及Goal仍active，未push／main／上线；Mac、真人系统picker、真实身份／商户／支付供应商、客户业务／生产、签名发行和两负责人业务签收未据此验收。
