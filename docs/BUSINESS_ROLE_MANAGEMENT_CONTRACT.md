# 普通员工业务职级调整（M4A）执行合同

2026-11-15；从 `6a343f8` 接续，关联 `TEAM-M4`。本轮先实现本团队普通员工的四职级配置与调整，不扩成所有业务模块授权。

## 已确认规则和本轮范围

用户本轮确认：团队技术管理员管理本团队普通员工的实习生、助理、项目经理、合伙人职级；技术管理员本人兼任业务职级须由产品负责人审核。经理和合伙人均可新建项目，创建者管理该项目授权。后两项分别进入后续独立切片，本轮不提供管理员自授、管理员兼职或项目创建接口。

普通员工仍通过已确认的定向实习生/助理邀请激活，再由技术管理员调整职级，即可产生新团队首个经理/合伙人。职级不自动附送项目、资料、邀请、签发或技术管理权；不修改旧六模块的专业字段、项目编号、模板、布局、UUID/CAS/冻结和原件语义，不加载或迁移旧本机资料。

## 授权与数据

- 当前有效独立技术管理员 `canOperateTeam`，且当前账号、凭据、团队均有效，才能管理本团队普通员工。业务职级、开通/恢复/停用/换机审核权不赠送该能力。
- 目标必须账号和membership均active、全历史恰好一个本团队membership、没有任何历史operator或四类privileged reviewer记录；拒绝自己、技术管理员、复杂/跨团队/停用身份。目标范围先于搜索、游标和分页应用SQL，返回最小姓名/职级/状态/版本，无手机号、凭据或项目资料。
- 不改身份归属，不创建新membership，不重新启用员工。四种role变化均可；同职级提交409，不产生副作用。`revision`使用现有可信identity epoch，不建立客户端职级事实或假定epoch只增加1。
- 改职级是高风险动作：必须当前管理员密码；body读取前/后、密码KDF后和最终事务内重新核对actor、credential、technical authority、目标当前role/identity epoch，观察ABA；不以请求头/客户端role鉴权。
- 同事务更新唯一membership.role，撤目标全部旧session/lease及未用设备挑战；撤本团队全部有效任务assignment、project/attachment/admin grants，实际撤assignment的每个task版本只增加一次。失效该员工已发但未完成的legacy/phone邀请、邀请激活挑战、SMS、ready微信登录、pending/approved恢复与换机请求/挑战，避免降级后再晋升使旧票复活。
- 保留账号active、membership active、credential/phone/wechat映射、设备binding/key、原件字节/提交历史/合法导出和未涉及成员。下次本人须重新登录并用原key证明；升职后也须重新分配项目权限。
- role变更、全部撤销、每task CAS、identity安全整数和专用audit原子提交；任何MAX、CAS、审计/约束异常全回滚。所有可信版本读取用整数文本防SQLite损失精度，事务末复核实际epoch，禁止溢出或靠修改测试过关。

## 精确接口与窄RPC

全部经正常strict设备保护，不加bootstrap例外；处理器还须验证真实currentDeviceLease与中央gate的deviceContext，诊断模式关闭设备证明也不能使用新职级API。Origin/HEAD/异常继续走统一application边界。非授权对象和不存在对象均404。

| HTTP | 响应/输入 |
|---|---|
| `GET /api/auth/business-role-management/access` | `{teams:[{teamId,teamName}]}`，最多50，独立于审计成员列表 |
| `GET /api/teams/:teamId/business-role-members?q=&after=&limit=` | `{members:[{id,displayName,role,status,revision}],hasMore}`；沿用80字符字面搜索、最多50行、scoped cursor |
| `POST /api/teams/:teamId/business-role-members/:userId/role` | body仅 `{revision,role,currentPassword}`；成功仅 `{changed:true,role,revision}`，返回实际新epoch |

三个preload/IPC方法：`getBusinessRoleManagementAccess()` → `business-role-management-access`；`listBusinessRoleMembers({teamId,q?,after?,limit?})` → `business-role-members`；`changeBusinessRole({teamId,userId,revision,role,currentPassword,confirmed:true})` → `business-role-change`。确认字段只由main校验，不下发HTTP。总67 RPC，不暴露任意路径、raw fetch/SQL/token或代签能力。

默认新增独立职级面板，选择team/员工/不同职级、确认撤旧授权和会话、当前密码；一个新form/一个密码，总11form/18秘密输入。只有ready设备且服务端teams非空显示，缺方法/旧server失败关闭。未知结果不自动重放，成功后刷新失败明确“已更改、待核对”，409强制刷新；wrong-password403可重试。actor/设备代次、team、关闭/重开和读代次必须在处理迟到401/结果前核对；mutation锁跨关闭存在，登出/切账号/暂停/关闭/unload清身份资料和秘密，不清后来账号。

## 数据库与验收

仅新增 `team_business_role_events` 与必要的单一审计索引，旧50表/87对象定义和所有旧行升级时不变，无自动角色修改/授权/登录/绑定/新演示账号；新schema预期51表/89对象。review沿用14个、ordinary9个合成账号。审核事件包含actor/team/target、before/after role、before/after identity revision、server时间；无密码/token/原件。

结束证据：真实SQLite/API允许与拒绝、四职级各方向、密码/撤权/body/KDF/txn并发/ABA/MAX/audit回滚、旧票复活拒绝、原件/身份映射hash保持；main/client/DOM来源和秘密/迟到竞态；真实Windows strict Electron管理员调整、旧端退出/在途保存0write、重新登录不赠项目、新结果未知只1POST、非目标不受影响；相关旧回归、完整portable、独立安全审查、两共享库只读before及升级/预览后全部旧行/schema保全。Mac/真实身份/跨电脑/生产另外保留，未push/main/上线，完整Goal保持active。
