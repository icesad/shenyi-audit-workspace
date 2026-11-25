# M2：个人登录会话管理

日期：2026-11-15；分支`codex/account-session-management`从`d7ecc01`接续。适用本机合成账号实验，不是设备绑定或生产上线。最新检查点见[进度](../进度.md)。

## 使用行为

登录后展开“我的登录会话”，查看本账号的有效登录、有效期和当前标记；不会展示同事、团队目录或会话令牌。四个业务角色都能管理自己的账号安全，这不会增加业务数据权限。列表可刷新或分页；旧登录未记录创建时间时显示“登录时间未记录”，不推算日期，不虚构电脑名称/IP。

填写当前账号密码后，可以退出某一登录、保留当前退出其他登录，或退出全部。退出当前/全部会返回登录页并清除旧任务、会话列表及秘密输入。错误密码返回可重试提示，保持原登录；真正已失效的当前会话才由401清退。另一端撤销本端后，下一次受保护请求会被拒绝，不能再沿用缓存角色放行。

关闭面板会清除本地列表和密码，不能撤销已经提交的退出请求；如果当前登录确已被退出，同一账号仍应回到登录页。若已切换为新的登录代次，旧响应不会误退新账号。退出成功但后续刷新失败时，界面明确说明退出已完成、列表需刷新，不谎称撤销没有发生，也不保留旧列表继续操作。

## API和秘密边界

| 接口 | 当前行为 |
|---|---|
| `GET /api/auth/sessions?limit=20&after=...` | 每页1至50项，默认20；只返回当前账号未撤销且未过期的会话 |
| `POST /api/auth/sessions/:id/revoke` | 当前密码重新验证；退出指定本人有效会话，返回`{revoked:true,signedOut}` |
| `POST /api/auth/sessions/revoke-others` | 当前密码重新验证；退出提交时其他本人有效会话，保留发起会话；可返回0 |
| `POST /api/auth/sessions/revoke-all` | 当前密码重新验证；退出包括当前在内的本人有效会话 |

列表DTO为`{sessions:[{id,isCurrent,createdAt,expiresAt}],hasMore}`。`id`是随机、持久化的UUID管理标识，不是Bearer，也不包含令牌摘要。`createdAt`为服务端实际发放时间或`null`；`expiresAt`沿用已有服务端期限。响应不返回账号归属ID、token/hash、IP、OS、物理设备或完整团队结构。

查询先限定当前用户和有效状态，再做游标、排序和数量限制；排序为有效期倒序、管理ID倒序。未知、他人、撤销或过期的游标/单项目标统一404。单项已失效不冒称成功，用户刷新后核对；“退出其他”在没有其他有效登录时可幂等返回0。

写操作使用共享异步密码工作并发限制和账号10次/15分钟实验限额。读取请求体后及KDF完成后重新核验发起会话、用户状态、凭据hash/revision和目标归属；事务内完成撤销，失败不部分更新。错误密码固定403，避免被当作当前会话失效；失效发起会话返回401。其他账号不受批量退出影响。

桌面增加4个窄操作，总计28项IPC；仍固定本机API、检查当前窗口/主frame/来源和参数白名单。Bearer保留主进程；管理ID仅用于受限会话操作。迟到响应不能清除新账号，密码不写持久存储、日志或返回DTO。

## 加表与兼容

`session-schema.sql`只在具有M2隔离标记的数据库增加`team_session_metadata`，不改变`team_sessions`列、原token、有效期或撤销状态。用户名、手机号及微信统一经`issueSession`同时写入凭据摘要和管理元数据；旧会话补稳定ID且`created_at=NULL`。初始化和本人列表读取可幂等补缺，重启不更换ID。

共享合成库升级前已在线备份。升级后23张原表与备份一致（排除正常变化的auth limits和会话表整体比较），另逐条确认原有8条会话原字段保持、旧时间均为null，仅新增元数据表；完整性检查ok、外键错误0。证据在`D:/codex-temp/shenyi-sessions-20261115/live-migration-preservation.json`。这是本机合成库保留证据，不代替生产迁移或恢复演练。

当前会话期限和验证限额沿用/采用实验参数，未替用户确定正式并发、允许电脑数或离线政策。此模块不登记设备公钥、不能证明同一物理电脑，更不能远程撤回已合法保存的资料。

## 验证

```sh
node --test tests/team-account-sessions.test.cjs tests/team-session-management-races.test.cjs tests/team-desktop-sessions.test.cjs tests/team-desktop-sessions-ui.test.cjs
node scripts/test.mjs --unit --strict
node desktop/sessions-smoke.cjs
node desktop/smoke.cjs
```

最终可移植子集753通过、0失败、0跳过；其中新增核心21、确定性竞态8、客户端12、UI19共60项，不重复累计成额外总数。独立安全agent复核60项及既有认证/竞态37项，未发现剩余P1/P2；原生报告和3张截图也独立核对一致。

`sessions-smoke.cjs`使用真实Electron45.3.2、随机端口HTTP、内存SQLite及合成账号，验证本人3会话、旧时间未知、稳定ID、错密保留、单项/其他/当前/全部退出、他人会话拒绝、同账号另一端撤销后桌面下一请求清退，以及5处密码/任务/列表清空。报告及截图在`D:/codex-temp/shenyi-sessions-20261115/real-electron/`，无页面错误。默认预览的`smoke.cjs`另验证28项IPC、个人列表与未配SMS/微信/激活的诚实禁用状态。

真实用户、电脑绑定、Mac、生产数据库/HTTPS及正式运营政策仍须各自验收，M2与完整Goal继续进行。
