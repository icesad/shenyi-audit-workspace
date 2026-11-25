# M4F 桌面窄接口

本文件补充 `docs/LEGACY_PROJECT_REGISTRATION_CONTRACT.md`，共新增7个preload方法；原始source、文件路径和密码不作为返回值。

| 方法 | 输入 | 成功value |
|---|---|---|
| `getProjectMigrationAccess` | 无 | `{canReview:boolean}` |
| `listProjectMigrationTeams` | `{q?,after?,limit?}` | `{items:[{id,name}],total,hasMore}` |
| `listProjectMigrationOwners` | `{teamId,q?,after?,limit?}` | `{items:[{id,displayName,role,revision}],total,hasMore}` |
| `chooseProjectMigrationSource` | 无 | `{canceled:true}` 或 `{handle,sha256,summary}` |
| `approveProjectMigration` | `{handle,sourceSha256,teamId,ownerUserId,ownerRevision,read,manage,review,currentPassword,confirmed:true}` | `{status:'registered',receipt}` 或 `{status:'unknown',requestId}` |
| `getProjectMigrationReceipt` | `{requestId}` | 合同exact receipt |
| `discardProjectMigrationSource` | `{handle}` | `{discarded:true}` |

`handle`为main生成的UUID，同时是该来源唯一的`requestId`。UI在调用approve之前保留公开查询编号；一个handle最多启动一次POST，未知结果不重发。关闭或discard删除main持久引用的来源和本机路径，不撤销已发审批；公开requestId可由同一审核人重新登录后只读核对。receipt 404仅表示当前未查到，不证明在途请求永不提交。

summary精确为`projectId,title,businessNumber,legacyManagerName,initiationRevision,workspaceRevision,firstWonAt,initiationWonAt,latestWonAt`，由codec提供。历史经理名只作来源文本，不映射任何账号。列表q最多80个Unicode字符，after为同scope的ID，limit为1..50且默认20，按服务端hasMore明确加载下一页。

IPC channel依次为`project-migration-access`、`project-migration-teams`、`project-migration-owners`、`project-migration-source-open`、`project-migration-approve`、`project-migration-receipt`、`project-migration-source-discard`，均有`shenyi:`前缀、主frame来源核验及精确keys。

main在来源选择前后核审核权，读取128KiB内普通文件并由codec预检，保存不可变私有副本；提交时重新核SHA和同actor/device guard，server再做全部业务校验。discard发生在实际POST发出前时，main的beforeSend guard阻止发送；POST一旦发出，旧UI结果仅作迟到结果处理，不能宣称取消或回滚。设备epoch、账号generation或窗口dispose使私有来源失效。
