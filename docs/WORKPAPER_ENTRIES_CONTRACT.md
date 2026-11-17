# M4Q 团队底稿填写CAS与不可变版本合同

接续[三权](WORKPAPER_ACCESS_CONTRACT.md)、[首次迁入](WORKPAPER_DATA_CONTRACT.md)和[原件字段准入](WORKPAPER_FORM_CONTRACT.md)。本阶段实现服务端真实原件准入后的填写保存，追加版本及本人原操作回执；沿用已有表结构，不以客户端字段清单、角色字符串或JSON整包覆盖放行。团队导出、正常桌面接入、完整严格门、原生和其他范围独审仍待完成；完整M4Q及Goal不判完成。

## 请求及权限

新增 `POST /api/teams/:teamId/projects/:projectId/workpapers/entries/:fileSha256`。只接受requestId、headRevision、projectRevision、grantRevision、changes五字段；requestId为精确36字符UUIDv4，三个版本为正安全整数。changes为1–500条精确sheet、field、value对象；同一位置不得重复，value为≤150000字符的有效Unicode纯文本，拒绝不支持的控制符。Excel用原工作表名／规范坐标；Word用$document及原native:pN／旧pN键。文本前导等号、HTML样文字均作为文字保存，不求值、不执行。

要求真实设备签名／当前持钥租约和单业务会话、当前团队／项目资格、明确read && write及active项目。经理、合伙人可以在负责人已单独授予两权后填写，不额外要求其成为owner；owner本身也不补授read或write。授权动作仍执行既有负责人验密规则，不把每次填写误作新的授权。职级／技术管理员／采集／资料／立项来源／账表权不能代替底稿两权。

必须已有已核验并首次迁入的head；有填写权也不能跳过负责人首次核验、验密和完整包迁入。以当前不可变版本定位真实原包路径或补充原件、核对实际SHA，再复用原隔离Office解析和字段准入，不能提交自报可写格。公式、链接、数组范围、隐藏、合并非锚点、不存在坐标及原锁定Word位置均拒绝。既有冻结范围仍只读，不阻止其他独立未冻结范围按权填写；冻结项目不写。没有新复核／冻结／重开／审计签发动作。

## 版本与撤销

设备网关在读取正文之前记录授权／来源stamp及当前head stamp，精确新路径正文上限1500KiB并持有已有大操作permit到请求结束；不提高全局17MiB请求体上限。伪造未来grant或head版本不能救回原请求。正文后、实际原件线程完成后和提交事务内重查当前账号／租约、权限、来源及head／记录SHA，覆盖撤销再授ABA、重新登录和并发头变化。

headRevision是团队版本，record.rev是迁入工作区版本：例如迁入version1／record.rev7，首次填写为version2／record.rev8。服务器只改准入的answers或docAnswers叶值、必要的原人工修订来源标记、rev和updatedAt；原Q、choices／目录、原包索引／二进制引用、模板、冻结快照和其他模块事实保持。对象键以显式own属性处理，原型名称作为被动键，不污染对象原型。

沿用原WorkpaperGovernance.noteManualEdit，将已存在的复用／自动填写来源仅对实际改变的位置记为manual-corrected／pendingReview并保留历史；其他来源不变，不伪造已复核。沿用assertTransition保护原冻结事实。原人工来源时间与服务器committedAt分别保存；保存版本不代表专业审批。

一个事务执行head条件更新和一条不可变entries版本插入，核对精确两笔写入、最终JSON／SHA及旧版本原JSON；无关写入、撤权触发器、插入失败或COMMIT故障整体回滚。复用既有连续版本／最大安全整数／不可变行约束，原件、来源、旧历史、导入记录和回执不能被覆盖／删除／替换。保存后记录仍≤原32MiB格式上限；相同已保存值的批次不新建版本，空字符串是明确保存值而非删除键。

## 旧冻结表示适配

持久化完整包中的blob槽是SHA引用，而原Governance的sourceMeta要求Blob元信息。不能因此跳过校验或让整个有冻结的项目都只读。服务端按锁的sourceBindings从本项目读取对应原包，核对真实字节长度和SHA，生成仅含已验证元信息的Governance视图；Blob MIME使用标准Blob归一语义。原assertTransition仍逐项比较原包、索引、冻结快照及scope内容，标准不变。

该视图不提供二进制，arrayBuffer调用会失败；它不是原件，也不用于下载／导出。最终存储始终是原来的持久化引用，不能把视图写回记录。缺证明、长度错误、同长度内容损坏、改名或改快照均不能通过。原件内容读取／后续团队导出仍须使用真实已核验字节。

## 回执和未知结果

操作ID在imports和versions中永久唯一，不复用、不自动重发POST。成功201仅返回本次不可变receipt；首次迁入来源包SHA一直指原迁入包，当前填写JSON由receipt.recordSha256区分。成功响应丢失时使用原GET /workpapers/receipts/:requestId，在当前read／来源下仅原操作者查回已提交版本；他人即使有read/write也不能查其操作回执。关闭或断网不能谎称撤回已提交成果，撤销read只阻止继续读取，不删除历史。

## 验证和交付范围

使用真实签名Request／隔离SQLite和实际Office线程，覆盖四类原件、独立读写双权、低职级／技术／跨团队、无严格设备配置、伪造签名、正文／线程阶段撤权、ABA／重登录、过期CAS／预测未来版本、同进程并发、不可变原件／旧历史、响应丢失、故障回滚、人工来源、字节上限、规范坐标、原型键、独立补充原件及首次迁入前拒绝。第二服务进程的并发head变化以受原表约束的SQL提交模拟，不宣称真实跨进程／TCP集群验收。冻结Excel／Word保持，未冻结其他工作表仍可保存。

旧dist／desktop／shared产品源码和专业规则不改；既有原件解析Chrome对照、首次导入、授权、角色／项目／成员／设备与schema兼容按相关性复跑。正式结束门保留原TAP、退出码、连续plan、零skip／cancel／todo和候选源before／after指纹。证据根 `D:/codex-temp/shenyi-workpaper-cas-20261117/`；本次填写保存链路已有独立复核，范围见最终报告；前序独审不自动通过，root自测不能代替剩余独审。

实际共享库未打开／升级，正常一键未针对本轮重验；未push／进入main／上线。最大真实设备容量、Mac、生产、真实脱敏资料及两负责人业务签收仍按整体Goal单列；不将本阶段服务端填写视为正常桌面已经可用。后续继续团队read && export及正常桌面窄IPC／UI，完整M4Q后再执行相应完整门和独立验收。

## 当前检查结果（2026-11-17）

41文件root相关门798/798、0fail／skip／cancel／todo，583.859秒；1227源raw保持，TAP SHA `ae4f32b4803892fd18259631735055581d62795571be0f1922a6a48b2b5a91b5`。原runner发现246个可移植文件／63个整browser文件粗排除，本阶段未运行完整严格门。

保留冻结其他范围首次失败：直接把持久化blob引用送旧Governance会误拒，增加真实字节证明的元信息视图后按原标准通过，没有跳过冻结校验。伪造签名fixture原来用了错误格式却期望403，改为分别验证原网关格式错误400及合法形状错误签名403，不改产品放行标准。40项新增诊断及两项迁入／补充边界通过后运行本最终门，不把分项累加当作完整回归。

本次填写保存链路已完成独立安全／数据复核，范围及自行执行证据以独立报告为准，前序未独审范围不自动通过。
