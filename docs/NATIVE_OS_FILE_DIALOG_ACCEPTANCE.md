# Windows真实文件对话框验收：部分事实成立，门未通过

日期2026-11-18，分支`codex/native-os-file-dialogs`，起点`705bcabf62c1f40bca10e5bce30b1211fbc7f6f3`。产品和旧测试未改；本项是M4必要验收尝试，不能替代完整商业化完成。

## 目标与实际结果

目标是在全新合成候选中，用正常main/preload/renderer/client、严格持钥会话和DPAPI，实际操作来源JSON Open、完整底稿包Open、所选已保存版本导出Save三次系统对话框。不包装或替换dialog，不注入文件选择路径，不改client/fetch/fs/worker/IPC返回。

唯一实际运行：`D:/codex-temp/shenyi-native-os-dialogs-20261118/author/run-2026-11-17T22-46-09-810Z-6af6808a/`。candidate=`fb312ce1-5d27-4c24-91a9-3071a0fb1dde`，actualMainPID33120、launcher48676，原生窗句柄对应Sky9770296，端口4667。

| 范围 | 当前证据与结论 |
|---|---|
| 正常启动、登录、设备登记 | 9合成账号／0绑定起步，正常DPAPI登记后1绑定；创建W、负责人核验来源及本人三权均正常UI执行 |
| 来源JSON真实Open | Sky在新窗口原生文件名控件填入本run文件路径，实际选择“预检来源快照”；正常摘要与DB的1945B UTF8原字节及SHA一致。W=`6bee3012-cebd-4231-9183-a326759ca652`、Q=`8d24177a-36d3-4461-b3af-b8718c7af0fc`映射正确；这是已证的bootstrap部分 |
| 底稿完整包真实Open | 原生框已出现，工具文字树给出控件512，但设置时报缓存中不存在；坐标聚焦及文件名快捷键后报告焦点仍为搜索框543。重建JS连接、重新选定并激活同一返回Window后同错；停止继续输入。未确认选包 |
| 导出真实Save | 未到达。保存目标不存在，不能声称导出或Open/Save pair通过 |
| 持久底稿 | 三份静态快照的五个底稿数据表均0；迁入写请求、填写及导出请求均0。三权111／eligible1／rev1已保存不等于底稿已迁入 |

## 证据边界与失败保全

`sky.get_window_state`初次返回的新窗文字树与旧候选图像不一致，未输入前即排除该截图；明确激活新窗后图像正确。没有向两份旧预览输入或请求激活，未读其DB/vault；但工具确曾意外捕获旧候选，不能宣称完全未见旧UI。

外部记录器最初按可重复的`screenshot-0/1`全局去重，导致来源阶段正确图只在原工具输出显示，未落成独立PNG；本地保留完整原生UIA及action日志。错误旧图排除不作证，修复记录器后逐capture保存完整包对话框图。工具setter错误原文另由root如实抄录，标明非独立原始错误文件，不补造截图或重放动作。

按长任务保护规则，在同路径失败及一次有新证据的绑定恢复仍失败后，root写精确candidate停止控制。运行exit1、`failure.json`记录`ROOT_STOP_OWN_CANDIDATE`。外部driver随后在`app.close()`后调用`app.process()`触发Playwright disposed dispatcher异常，未完成其自有cleanup报告；原冻结driver、错误日志及失败状态全部保留，不改写成PASS。

root随后实查原记录5个自有PID均消失、4667无监听，才对已停机的独占合成DB作只读backup得到`02-stopped-owned.sqlite`；未读取候选vault。三份静态SQLite integrity ok／FK0，独立物理73项断言只验证部分终态事实，不证明OS全流程成功。session／lease的revoked_at仍null，未声称正常退出或撤销完成；合成环境与数据留存，不当作生产恢复。

293条HTTP均完成，139项业务签名由运行时真实核验；200×288、201×4、404×1，404为首次迁入前本项目空底稿读取；无429或5xx。底稿仅1次授权POST与1次import-capabilities只读查询，不能把能力查询误记为迁入。

实际fresh输入包38277B；两份存储原件为31420B原ZIP＋44B补件，原ZIP内四个Office文件，1份既有freeze；5个ZIP容器／35成员CRC、A2／C1和freeze hash仅在输入验证。不能把codec预检的Q／SHA代替本次实际输入身份，更不能称四个SQLite原件BLOB或导出物。

1152原运行／测试文件全程原字节保持。正常native文件选择成功证据、已保存source、未完成的包Open／Save、工具记录不足和驱动清理错误分别列证。没有再跑249旧门／全量strict，不以它们代替本次未通过关卡。

## 接续条件

实际控件缓存／焦点前提变化或人工真实选件前，不原样自动重启候选或重试同一路径；先核对新的工具证据，再从保全状态制定单次验收。不以纯路径注入替代本关，不因本关失败修改专业规则或扩大模块权限。

两份保留预览的4进程／2窗口／2公开server UUID前后核同；未升级实际共享库，原一键入口本轮未重验。未push／main／线上发布，M4与完整Goal active。报告权限仍待原答复；canonical原包、Mac、发行及后续商业化关卡仍分别未完成。原来源文件只是负责人业务确认，不是审计签发。

证据根：`D:/codex-temp/shenyi-native-os-dialogs-20261118/`；根代理`root/stopped-snapshot.json`、`root/owned-cleanup-root.json`、`root/protected-audit.json`、`root/sky/observations.jsonl`、`root/sky/actions.jsonl`及`root/sky/issues.jsonl`；独立物理`physical/index.json`，整体独审收口报告另列于`independent/`。历史已通过的功能与本次未通过状态并存，不回滚前项交付。
