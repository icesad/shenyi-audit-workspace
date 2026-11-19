# 团队库离线备份与恢复演练

## 受管库加密备份

受管库使用独立的加密备份及恢复演练入口。先停受管服务并停止其他写入者，选用已获授权的现有 SQLite 文件，手工核对服务配置中的 UUID。源库须为可独立打开的回滚日志格式，旁边没有 WAL、SHM 或事务日志附档。工具检查文件及身份，停服由操作方确认。

```sh
node scripts/team-database-backup.mjs create-managed-sealed \
  --source "/var/lib/shenyi-team/team.sqlite" --server-id "$server_id" \
  --key-file "$backup_key_file" --output-root "$backup_root"
node scripts/team-database-backup.mjs rehearse-managed-sealed \
  --bundle "$sealed_bundle_directory" --server-id "$server_id" \
  --key-file "$backup_key_file" --output-root "$rehearsal_root"
```

所有路径均为本机实际绝对路径。私有输出目录位于发布树之外，备份和演练应使用受控的加密存储。密钥文件为单独保管的 32 个随机字节。备份通过 SQLite 一致性快照保全表结构、身份、权限及原件，再封存为 `sealed-UUID/snapshot.sealed`。封存成功后目录只剩密文。异常中断或断电可能留下隐藏暂存文件，按敏感数据管理，等待核实后处理；只有成功回执和通过验证的归档才交给恢复方。

演练时先验证 AES-256-GCM、备份类型、预期 UUID、完整快照 SHA-256、表结构和分类型行摘要，再在新目录生成演练数据库。输出库只添加离线标记。现有和上一版受管服务均会按库内标记拒绝启动，改名或移动文件依然生效。回执中 `authenticatedSnapshotSha256` 是归档中原始快照的哈希，`database.sha256` 是添加标记后演练副本的哈希。演练副本和回执同样保存在受控存储，副本含原始资料和凭据记录。

### Linux 跨虚拟机恢复演练

源 Ubuntu 虚拟机停服后，从有采集和设备绑定记录的合成受管库生成加密归档。另一台从独立基盘写层启动的 Ubuntu 虚拟机只读挂载密文介质和独立密钥介质，并将恢复结果写入空目录。归档中已认证的原始快照摘要与恢复回执相同。独立读取核对 98 张表、SQLite 架构、2 KiB 原件及两条设备记录。除新增的演练标记外，分类型数据摘要一致。

演练确认错密钥无恢复输出，同一启动配置可读取原库，完整标记随恢复文件保留，原路径和改名路径均拒绝启动。相同状态比较返回 0，有一条账号停用变化的独立副本返回 2。实际备份介质存放、密钥保管、授权数据核对和正式切换由部署方分别验收。

### 恢复前核对变化

停服并停止其他写入者后，选择当前权威库与拟恢复的加密归档，核对它们的服务 UUID，再执行以下命令。`--source` 指向当前库；演练副本带有隔离标记，会被拒绝。

```sh
node scripts/team-database-backup.mjs compare-managed-sealed \
  --source "/var/lib/shenyi-team/team.sqlite" --bundle "$sealed_bundle_directory" \
  --server-id "$server_id" --key-file "$backup_key_file"
```

命令验证归档认证标签和解密快照的字节哈希，并将当前库的结构及分类型全表行摘要与归档的已认证清单核对。全程只读，无需恢复暂存库。结果仅包含结构和物理字节是否一致，以及修改、新增和移除的表数量。账号和设备、团队和项目权限、账务和权益、其他资料分别汇总表数。表数包括同一行数量下的字段变化，输出不带表名、行值、摘要或路径。

| 退出码 | 结果 | 含义 |
| --- | --- | --- |
| `0` | `match` | 结构和表内容摘要一致。SQLite 文件布局可能不同，见 `databaseBytesMatch`。 |
| `2` | `different` | 核验已完成且发现结构或表内容差异。先保留当前库，依据可信台账检查切换会丢失的变化。 |
| `1` | 核验失败 | 标准错误输出固定错误码。先确认实际库、归档、密钥、UUID 以及停机状态。 |

恢复演练仍需打开归档恢复出的 SQLite，核验它能读取且完整。当前库不可用时，需要依据可信记录核对快照之后的停用、换机、撤权、凭据、支付和业务状态。正式切换须使用批准的恢复流程。 [Linux 变更与回滚](LINUX_TEAM_DEPLOYMENT.md#变更与回滚)

## 合成库工作流

本工具补齐 M4 的合成库备份／恢复核验：把一个明确指定的合成团队数据库备份到全新目录，再从该备份恢复到另一个全新目录，核对整库字节和业务记录。它不替换运行中的数据库、不启动恢复服务、不接桌面，也不提供生产切换命令。

### 用法

使用 Node.js 24.15 以上 24.x，在仓库根目录执行：

```sh
node scripts/team-database-backup.mjs create --source "<获准合成SQLite的绝对路径>" --output-root "D:/codex-temp/shenyi-team-backups"
node scripts/team-database-backup.mjs verify --bundle "<上一步返回的backup-UUID绝对目录>"
node scripts/team-database-backup.mjs rehearse --bundle "<已核验backup-UUID绝对目录>" --output-root "D:/codex-temp/shenyi-team-backups"
```

尖括号内容须替换为本次获准的实际绝对路径；不要选正在保留的旧审核预览或用户留开的新候选库。研发验收只使用本轮另行建立的合成 fixture。CLI 不接受覆盖、启动、切换、重复或未知选项。输出根目录可省略：Windows 默认 `D:/codex-temp/shenyi-team-backups`，macOS 为用户 Application Support 下的专用目录；Mac 实机未验。

输出根须在仓库外。每次只创建新的 `backup-UUID` 或 `rehearsal-UUID` 子目录，既有目录和源库不会被覆盖。失败目录保留用于排查；不得把未成功发布清单、带失败标记或核验不符的目录当有效备份。关闭、清理或替换实际预览不属于本工具流程。

## 包含与核验

源库按只读方式打开，必须具备 `prototype-version=2`、`demo=true`、规范服务 UUID，并通过 SQLite 完整性与外键核验。工具不调用初始化、迁移或种子程序。识别标记只说明当前合成格式，不构成来源认证，也不能保证有人没有把真实资料放进演示库。

备份使用 [Node24 的 SQLite backup API](https://github.com/nodejs/node/blob/v24.22.1/doc/api/sqlite.md#sqlitebackupsourceDb-path-options)。该 API 会覆盖已有目标，因此目标只限本工具预留的全新私有子目录文件。并发源库是一个一致性快照；不承诺它等于备份返回时刻的全部最新写入，也不把备份前的 live 行摘要当成同一快照。

WAL 源也支持。仅在本次全新备份副本上，由 SQLite 正常切换为 DELETE 日志模式，非 DELETE 转换前后核对完整 schema／分类型行摘要相同，再关闭并检查它是没有事务附档的独立文件；不修改源日志模式，也不手工删除附档来强行核验通过。

大库创建过程在 stderr 输出限频页数进度，stdout 仅输出最终 JSON 摘要。程序接口的可选 `onProgress` 是同步观察器，只接收冻结的 `remainingPages/totalPages`；观察器抛错或返回 Promise 时，本次不发布成功清单。进度不输出业务正文或凭据。

完成后，对快照计算：

- 整个 SQLite 文件的流式 SHA-256 与长度。
- 完整 schema 定义摘要、所有普通表的行数及分类型行摘要；区分整数、大整数、实数、文字、空值和 BLOB。
- `integrity_check` 和 `foreign_key_check`；服务身份、原件 BLOB、项目 UUID、版本／CAS、已保存填写、冻结记录、授权及审计历史随整库保留。

规范 UTF-8 JSON 清单最后独占发布；拒绝 BOM、重复／未知字段、错误标量类型、路径注入、过大清单、残余数据库事务 sidecar 和不一致文件。静态 symlink／junction／硬链接别名会拒绝；文件核验期间的 inode、长度、时间和摘要变化会导致失败。校验和用于确认一致性，不替代备份来源认证。具有同一 OS 写权限的人能修改程序和工件，本工具不承诺防止其在返回后篡改。

`rehearse` 先完整核验备份，排他复制到另一个全新目录，再核对恢复文件的原字节、schema 和全部表摘要，成功才发布 `rehearsal.json`。它不会自动删除源库，也不会将恢复目录注册为正常候选或启动在线服务。恢复核验可在原路径已不可用时完成；测试只把自己的合成源改名保留，未删除用户文件。

## 加密封存与异地恢复演练

使用 `seal` 封存已经通过核验的 `backup-UUID`。运维人员单独保管一个用安全随机源生成的 32 字节二进制密钥文件。`--key-file` 取该文件的本机绝对路径。密钥与工件使用独立保管位置，复制封存工件时只复制新的 `sealed-UUID` 目录。

```powershell
node scripts/team-database-backup.mjs seal `
  --bundle 'D:/owned-backup/backup-<UUID>' `
  --key-file 'D:/operator-keys/backup-key.bin' `
  --output-root 'D:/sealed-artifacts'

node scripts/team-database-backup.mjs rehearse-sealed `
  --bundle 'D:/transferred-artifacts/sealed-<UUID>' `
  --key-file 'D:/operator-keys/backup-key.bin' `
  --output-root 'D:/offline-recovery'
```

`<UUID>` 用实际返回的目录名替换。封存目录中只有 `snapshot.sealed`。数据库和包含服务标识、表摘要的清单一起使用 AES-256-GCM 加密。包头包含格式、随机 nonce 与长度，并纳入认证。文件末尾含认证标签。密钥原始字节不写进工件或命令行输出。输出使用支持硬链接的文件系统（Windows 可选 NTFS）排他发布，之后可复制密文目录到其他介质。 [Node.js 加密与认证接口](https://github.com/nodejs/node/blob/v24.22.1/doc/api/crypto.md#deciphersetauthtagbuffer-encoding)

恢复先认证密文，再逐块比对两次读取的原始密文，匹配后才写入新目录中的候选 SQLite。通过第二次认证、原始文件哈希、SQLite 完整性、外键和分类型表摘要核验，才发布恢复演练结果。损坏、截断、追加数据或不匹配的密钥会触发拒绝。恢复目录含有明文 SQLite，请留在受保护的离线运维位置。

## 安全与生产边界

整个数据库含全部团队数据、密码哈希、会话、设备及恢复／邀请事实。`create` 生成的原始工件与恢复数据库使用明文 SQLite，`seal` 完成后原始文件仍由运维人员保管。备份和恢复都是敏感运维操作。权限参数 `0700/0600` 仍需结合实际操作系统权限配置，生产环境的 Windows ACL、密钥管理、异地保管、保留期限和合规流程待验。

历史快照还会保留当时的密码、有效成员、旧角色／项目授权和设备状态。恢复它可能倒退备份后的改密、停用、撤权、换机和审批；清空会话无法解决旧密码重新登录或旧 grant 复活。因此本工具始终标记 `offlineOnly=true`、`onlineCutoverSupported=false`，没有自动“清理安全表后上线”。生产恢复点、可信撤销事实重放、身份策略、证书／密钥、迁移和正式切换须在 M7 单独设计、获授权并实证。

本工具不包含 OS 设备私钥、TLS／支付／短信／微信密钥、外部文件存储或其他部署配置的恢复，不把数据库可读当作软件已在生产恢复。当前原件全在 SQLite 的事实不能替代未来外部存储加入后的完整备份设计。

验收命令、原失败、修复和独立审查见根目录 `进度.md`、`docs/STATUS.md` 及仓库外 `D:/codex-temp/shenyi-team-backup-20261118/`。Mac、生产恢复和完整商业化 Goal 仍分别未完成。
