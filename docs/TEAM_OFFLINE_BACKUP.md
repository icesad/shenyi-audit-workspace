# 合成团队库离线备份与恢复演练

本工具补齐 M4 的合成库备份／恢复核验：把一个明确指定的合成团队数据库备份到全新目录，再从该备份恢复到另一个全新目录，核对整库字节和业务记录。它不替换运行中的数据库、不启动恢复服务、不接桌面，也不提供生产切换命令。

## 用法

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

## 安全与生产边界

整个数据库含全部团队数据、密码哈希、会话、设备及恢复／邀请事实；备份文件不是加密容器。它是敏感的运维工件，不是员工可领取的项目导出包，也不经过普通业务 IPC 或 HTTP 下载接口。权限参数 `0700/0600` 不代表已经验收 Windows ACL、加密、异地保管、保留期限或合规策略。

历史快照还会保留当时的密码、有效成员、旧角色／项目授权和设备状态。恢复它可能倒退备份后的改密、停用、撤权、换机和审批；清空会话无法解决旧密码重新登录或旧 grant 复活。因此本工具始终标记 `offlineOnly=true`、`onlineCutoverSupported=false`，没有自动“清理安全表后上线”。生产恢复点、可信撤销事实重放、身份策略、证书／密钥、迁移和正式切换须在 M7 单独设计、获授权并实证。

本工具不包含 OS 设备私钥、TLS／支付／短信／微信密钥、外部文件存储或其他部署配置的恢复，不把数据库可读当作软件已在生产恢复。当前原件全在 SQLite 的事实不能替代未来外部存储加入后的完整备份设计。

验收命令、原失败、修复和独立审查见根目录 `进度.md`、`docs/STATUS.md` 及仓库外 `D:/codex-temp/shenyi-team-backup-20261118/`。Mac、生产恢复和完整商业化 Goal 仍分别未完成。
