# M4P 账表校验只读服务端合同（候选）

日期：2026-11-17。分支 `codex/ledger-check-readonly`；本轮起点 `2000d6ec8523fd3fa11b8ac51a08458207c5c1b4`。依据[用户决定](LEDGER_CHECK_ACCESS_DECISION.md)和[快照合同](LEDGER_CHECK_SNAPSHOT_CONTRACT.md)。本合同记录已实现服务端边界；桌面IPC、文件选择、来源核验界面、正常只读工作台、原生及独立验收仍待完成。M4O仍是最近独立验收通过的功能，完整Goal保持active。

## 权限和来源

本模块仅提供保存记录的独立查阅权。有效团队成员必须是经理或合伙人；技术管理员兼任业务身份沿用已批准的独立审核，历史最高审核身份仍不能使用普通业务入口。负责人身份、采集权、材料权和立项来源权均不推导账表查阅权。

项目负责人验证当前密码后，可为自己或本团队合格经理／合伙人明确设置本项目账表查阅权。独立账表授权本身建立该模块项目范围，不要求同时开放采集目录。专用项目列表仅含获准模块所需的项目ID、标题、状态和版本；不会扩大通用项目列表、材料原件或其他模块范围。无查阅权的负责人只能管理授权，不下发快照数量、正文或来源Q。

导入要求当前负责人身份、明确账表查阅权、active项目、已核验来源身份和当前密码。W工作区只接受已正式确认的W→Q；旧Q迁入只接受已审核的归属，不按姓名或文件中的声明猜测团队和负责人。未确认W如实为空，不能接受声称属于某Q的文件。

## 实际HTTP接口

全部接口经过当前账号、在线持钥设备、租约、服务端UUID及签名验证；查询参数、ID和方法按各自入口严格校验。下表的 `{base}` 为 `/api/teams/:teamId/projects/:projectId/ledger-checks`。

| 方法与路径 | 行为与额外条件 |
| --- | --- |
| `GET /api/teams/:teamId/ledger-check-projects` | 独立模块最小项目列表；`q/after/limit`，SQL范围先于游标及分页 |
| `GET {base}/access` | 当前独立能力及版本；无读权不返回head或来源Q |
| `GET {base}/members` | 负责人专用最小合格人员列表，含职级及授权CAS版本 |
| `POST {base}/access` | 负责人当前密码，精确项目／成员／授权版本，显式布尔read；变更与不可变审计同事务 |
| `GET {base}` | 明确查阅权；按服务端导入版本倒序分页，不下发正文、操作ID或其他模块资料 |
| `POST {base}/imports` | 负责人＋查阅权＋当前密码；仅追加保存快照，返回永久操作回执 |
| `GET {base}/imports/:operationId` | 当前负责人且有读权，仅查询本人在本项目的原导入回执 |
| `GET {base}/snapshots/:snapshotId` | 明确查阅权；必须携带精确`projectRevision`和`grantRevision`，返回原规范JSON |

授权body恰含 `projectRevision,userId,memberRevision,grantRevision,read,currentPassword`。导入body恰含 `operationId,projectRevision,grantRevision,headRevision,sourceJson,currentPassword`。`operationId`是随机UUID，不能用作Bearer或越权查询凭证。

快照正文响应携带实际规范JSON字节长度，以及 `X-Shenyi-Ledger-Sha256`、`X-Shenyi-Ledger-Snapshot-Id`、`X-Shenyi-Ledger-Version`、`X-Shenyi-Ledger-Source-Project-Id`、`X-Shenyi-Project-Revision`、`X-Shenyi-Ledger-Grant-Revision`。没有运行、重新计算、映射保存、建议生成、底稿写入、文件导出或报告签发接口。

## 导入、并发和历史

编解码器只校验原规范数据、项目绑定和保存哈希，不加载计算引擎或补造结果。保存原JSON、文件SHA、旧工作区版本、原计算时间、导入确认人和服务端导入时间。文件哈希不证明真实账套、原件或计算正确，负责人确认不等于审计签发；未来界面须如实标示原文件声明及未完成记录。

所有其他设备入口仍使用原17MiB请求限制。只有签名通过、当前负责人＋读权及来源预检通过、无query的精确POST导入路径允许 `64MiB+16384` 外层JSON；其中快照仍受32MiB规范文件限制。请求体读取前捕获授权／来源stamp，body、密码验证后及最终事务重新检查，撤权再授权不能恢复旧请求。每账号最多一项、每数据库最多两项导入；限额从读取body前保持到整个handler结束，拒绝或失败也释放。此为单进程资源边界，不等于生产压测或集群并发验收。

导入以head版本CAS追加：head与快照恰两行变更，异常额外业务写入整笔回滚。相同操作ID和完整请求摘要重放，在当前身份／权限／密码仍通过时返回原回执；不同摘要冲突。网络结果未知时查原操作ID，不盲目重发；旧版本和回执不删除、不静默覆盖。时间显示按原保存和实际导入区分，版本顺序不依赖客户电脑时钟。

快照读取在异步格式验证后再次事务核对身份、项目、授权、来源、原行和head；历史列表在同一事务取得head及分页行。读取事务不得产生业务写入。认证限流、设备nonce和在线使用记录仍按原边界工作，不宣称整个HTTP请求零认证写入。

普通项目完整移除、角色改变、成员停用会撤销账表权并保留导入历史；资格、账号／团队状态、owner或归档变化触发失效锁，恢复身份不自动恢复旧权。冻结项目可读、不能导入或编辑权限。安全整数MAX可精确读，需递增的操作拒绝并保持原数据。

## 存储与验证边界

只在已识别的隔离prototype-v2库追加四张空表：`team_ledger_check_grants/events/heads/snapshots`，共38项命名定义（四表、33触发器、一索引）。当前77表／290定义，旧73表／252定义及全部typed行和服务器UUID保持，不种入默认读权或演示记录。未知客户库拒绝迁移；任一账表历史存在而服务器UUID丢失时拒绝自动生成新身份。

原schema测试保留73/252及71/223固定历史基线，仅经明确helper核对四张指定空表和38项定义后增加新层；原DDL、typed行、原UUID及旧权限断言不放宽。适配和原失败均保留仓库外证据。

验证命令与实际数量见当前检查点和 `D:/codex-temp/shenyi-ledger-check-server-20261117/`。这些是root的合成数据库、真实签名Request应用边界检查，不是独立审查、网络负载、正常桌面UI或Mac/生产验收。独立审查额度限制仍待解除，不能绕过或用root检查替代。未打开／升级共享演示库，未接触真实客户资料，未push、进入main或上线，本轮未重验一键入口。
