# M1 团队采集授权原型

状态：隔离、只读、合成数据实验；没有挂载到既有网页/Sites服务，不对公网监听。不能用它声称生产登录、设备绑定、订阅或团队软件已经完成。

架构与下一阶段见 [ADR 0001](../../docs/adr/0001-team-runtime.md)，产品权限见 [团队需求](../../docs/TEAM_PRODUCT_REQUIREMENTS.md)。本轮工作项为 `TEAM-M1`。

## 文件与可信入口

- `schema.sql`：新建隔离测试库的模型，包含复合团队外键；不是旧平台或客户数据库的升级脚本。
- `access-policy.mjs`：四角色允许读取的采集范围和返回字段白名单。
- `repository.mjs`：服务端会话查询、成员状态和参数化数据查询；范围条件先于搜索、计数和分页。
- `collection-api.mjs`：Web `Request/Response` 处理器；只接受服务端存储的有效opaque bearer会话。

测试用 `DatabaseSync(':memory:')` 执行schema，不读旧IndexedDB或平台资料库。生产仓储接口与数据库选型尚需验证；同步SQL实验不等于生产并发/容量测试。

## 已实现的读取范围

所有路径前缀为 `/api/teams/:teamId/collection`，仅GET。

| 路径 | 响应/条件 |
|---|---|
| `/tasks` | `{tasks:[{id,title,instructions,status}],hasMore}`；最多100项，支持`limit`、`after`及标题/说明字面搜索`q` |
| `/tasks/:taskId` | 同样白名单的单任务；不返回项目、客户、财务或完整目录字段 |
| `/summary` | `{taskCount}`，只计当前可访问任务 |
| `/tasks/:taskId/attachments/:attachmentId` | 同时拥有任务范围和该附件的有效个人grant才返回字节；强制下载、固定octet-stream |

实习生/助理只能通过有效任务指派取得范围，数据库中即使错误给予project grant也不放行。项目经理/合伙人除自己的任务外，可通过明确的`collection.read`项目grant取得该项目采集范围；不自动给本团队全部权限。所有角色下载原件仍需独立附件grant。这是最小授权实验，不是米老师已经签收的完整经理/合伙人业务权限。

`q`不把`%`和`_`当作查询通配符。未知/重复查询参数、非法limit或游标拒绝；未知模块、树、历史、导出、管理路径默认拒绝。写入、上传、退回/核对、权限授予接口本轮均未提供，属于后续实现。

## 认证与撤销

只从`Authorization: Bearer`读取标准32字节base64url会话凭据，计算SHA-256后查服务端会话表；凭据不在表中、已过期/撤销、用户已禁用，均返回401。不读取请求中的用户ID、角色、平台身份头或本机角色配置。

每次请求重新查当前成员、团队及授权；禁用成员/团队、移除指派、撤销grant或降职在下一请求生效。不在会话中缓存角色。项目冻结只读仍可查，归档项目不在当前采集范围。

测试预置会话不等于账号注册/密码登录。M2需加入可信凭据创建、登录限流、会话发放/撤销等，再接桌面入口；M3及订阅阶段增加设备和权益约束。生产服务必须使用HTTPS，令牌和私钥不能写日志或前端持久配置。

## 返回边界

未知资源与已存在但无权资源使用同一404内容，避免泄露对象存在性。错误只给通用代码和说明，不输出SQL/路径/凭据。所有响应`private,no-store`、`nosniff`，不开放CORS；跨站请求拒绝。

项目标题/财务/结构列专门存入合成秘密标记以验证未下发。任务标题/说明本身必须由有权人员仅填写所需采集上下文；DTO白名单不能自动脱敏一段人为塞入的敏感正文。正式数据进入前需按任务材料范围审核。

## 验证命令与证据边界

在Node 24.15以上24.x执行：

```sh
node --test tests/team-collection-access.test.cjs
node --test tests/team-collection-access.test.cjs tests/account-profile.test.cjs tests/account-client.test.cjs scripts/dev-tools.test.cjs
```

该测试无需额外npm依赖。新增文件会被现有`npm test`和可移植子集runner发现；没有为通过测试改旧断言。检查结果、独立审查和下一里程碑写在根目录`进度.md`。

这些是处理器/真实SQL证据：不覆盖HTTP监听、真实密码找回、生产数据库、对象存储、客户端/系统密钥、支付或Mac实机，也不代表客户审计业务验收。未来对象存储预签名票据、搜索索引、异步导出和共享缓存需要延续同一范围规则，不能绕过这里的判定。
