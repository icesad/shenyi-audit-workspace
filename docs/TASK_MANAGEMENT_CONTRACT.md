# M2 任务指派与退回实现合同

日期2026-11-15。阶段门只读核对发现桌面缺指派/退回，既有服务端管理写无版本前提。本轮补这两个原有M2动作，不改专业审计公式/模板、旧dist、客户数据、不开放员工原件/提交历史给管理者、不新增员工停用政策。

## 权限与已确认规则

当前任务可读且当前manager/partner且该项目有active collection.manage的交集，才可管理；不因业务职级或技术operator自动获得资料/管理权。lowrole误授grant仍拒，跨team/撤权/冻项拒，输入body与事务后再校验same actor。

用户已确认指派对象仅为本团队有效实习生/助理（intern/assistant）；候选和新assignment写入均执行该规则，不开放经理/合伙人或技术管理员为新采集对象。已有当前分工允许最小展示，不能据此给新对象扩权。确认前仅以相同边界做过保守合成实验，不把当时等待期间的实验冒充已获用户批准。

## 固定RPC/API

新增4窄操作，总48，旧auth DTO不变；参数exact keys，主进程固定URL和令牌保管。

| RPC | API | 输出 |
|---|---|---|
| getTaskManagement({teamId,taskId}) | GET /api/teams/:teamId/collection/tasks/:taskId/management | {canManage:false}，或{canManage:true,revision,status,assignees:Member[],hasMoreAssignees:boolean} |
| listTaskAssignees({teamId,taskId,q?,after?,limit?}) | GET 同task/assignees | {members:Member[],hasMore:boolean}，默认20/最多50 |
| assignTask({teamId,taskId,userId,revision}) | POST 既有task/assignment，body{userId,revision} | {revision}，必须是输入revision+1 |
| returnTask({teamId,taskId,revision}) | POST 既有task/return，body{revision} | {revision}，必须是输入revision+1 |

Member={id,displayName,role}，角色四枚举，名称最长80，无手机号/密码/其他业务数据。当前assignees最多50，hasMoreAssignees如实反映截断。候选搜索限定任务管理scope、当前团队、选定角色策略及active账号/成员，SQL授权/过滤先于搜索/游标/limit；q最多80字符，LIKE通配当字面，稳定id分页，无权/不存在游标同404。

GET management先验证任务可读，lowrole/缺manage/frozen project只返回canManage:false，不返回人员信息。候选和写操作按管理条件拒绝；只有submitted能退回。指派延用既有单目标替换所有active分工语义，UI明确提示；已关闭任务不提供管理写，不能让新界面改动已关闭资料。

管理POST本轮正式要求nonnegative revision，对旧无版本调用400，不能保留绕过CAS的旧通道。对相关旧测试只补其场景的真实版本，并保留拒绝断言/新增stale和race；不改上传版本合同。事务内fresh版本、scope、status核对，nextRevision一次，活动事件同事务。改派使原lowrole失去任务及下载，不能给新人旧原件grants或擦历史。不能用管理权读取他人GET submissions或附件。

## 桌面与验收

详情增加“任务分工与退回”最小操作，仅server canManage开放；已授权管理者选择候选姓名/职级、确认替换当前分工或退回待补充。没有专业审计结论/签发行为。角色/账号/任务/团队切换清当前管理状态；actor/task代次、跨刷新写锁避免重复及迟到污染，401只清当前代次，409要求刷新，不自动重试写。冻结/撤权/变更后不能保持可用假象。

新form/password数量由UI报告，尽量复用button/select维持9form/15秘密，不全局UI升级。真实Electron至少验证经理已授权→从intern改派assistant（原人任务/附件404、新人无旧附件）→assistant提交→经理退回→assistant重交；保留原件/历史/hash。仅合成原件，可拦截native dialog的harness须注明，不冒充本轮真实文件选取。独立server对抗/DOM/client、完整portable以及旧共享两库备份/表行保持验证；新增能力不等于Mac/设备/供应商/生产完成。

状态：本机候选按上述合同已实现，48IPC/9form/15秘密；实际结果及剩余阶段门见[交付说明](TASK_MANAGEMENT.md)。
