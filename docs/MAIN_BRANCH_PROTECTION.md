# main 分支保护配置与验收

更新日期：2026-11-22

## 当前状态

已在 GitHub 网页创建并通过规则页面与 API 读回核验主分支保护。规则为 [`protect-main`（27842740）](https://github.com/icesad/shenyi-audit-workspace/rules/27842740)，状态 **Active**，精确匹配 `refs/heads/main`；API 确认 `main.protected=true`。

规则的 `bypass_actors=[]`，当前用户的 `current_user_can_bypass=never`。已核实协作者 `mixue117` 具有仓库 **Write** 权限；该权限不等于已批准 PR，实际批准仍须由非 PR 作者提交。

仓库：<https://github.com/icesad/shenyi-audit-workspace>

## 今后复核或重建的配置入口

已有上述规则时直接打开并复核，无需重复新建。以下步骤供今后复核或必要时重建参考，规则参数以本文件的已核验配置为准。

1. 打开仓库 **Settings**。
2. 进入 **Rules → Rulesets**。
3. 打开现有 **protect-main**；仅重建时选择 **New ruleset → New branch ruleset**。
4. 名称：`protect-main`。
5. Enforcement status 设为 **Active**。
6. Target branches 精确选择 `refs/heads/main`。
7. Bypass list 保持为空。

维护现有规则即可；不要重复建立相互冲突的规则，也不要通过临时放宽目标或 bypass 完成验收。

## 已启用并读回核验的规则

- **Require a pull request before merging**：启用。
- **Required approvals**：1（`required_approving_review_count=1`）。要求至少一位非 PR 作者的审核人批准。
- **Dismiss stale pull request approvals when new commits are pushed**：启用（`dismiss_stale_reviews_on_push=true`）。
- **Require conversation resolution before merging**：启用（`required_review_thread_resolution=true`）。
- **Require status checks to pass**：启用，必需检查名称为 `unit`、`tools`；两项均绑定 GitHub Actions（`integration_id=15368`）。
- **Require branches to be up to date before merging**：启用，严格模式为 `true`。
- **Block force pushes**：启用（`non_fast_forward`）。
- **Restrict deletions**：启用（`deletion`）。
- 无管理员、个人或团队 bypass 例外。

## PR #3 的特殊验收

PR #3 是大型整合，验收以最终实际 head 为准，不能只凭一个旧 SHA 的绿色状态合并。必须确保：

1. PR #8 安全修复已合并进其 head 分支；PR #10 微信限流修复、PR #11 路径修复仍待完成各自检查与审查后合入协作分支。
2. PR #3 最新 head SHA 的 `unit` 和 `tools` 两项检查均成功。
3. 最新 Codex Review 针对 PR #3 当前 head 完成，未解决 P1/P2 事项为零。
4. 公开仓库敏感信息检查覆盖当前文件、提交历史和 PR 讨论/附件；当前文件搜索无命中不等于历史审计完成。
5. 所有审查线程已解决，至少一位非作者审核人批准。
6. 业务负责人确认版本范围和回滚方式。

## 配置核验与真实合并验收

- **配置核验已完成**：网页规则页面显示 Active；API 读回确认精确目标、空 bypass、必需审批与检查等上述参数，并确认 `main.protected=true`。这是本次保护配置完成的证据。
- **真实合并工作流仍待验收**：后续正常 PR 须在最终 head 的 `unit`、`tools`、非作者批准及线程解决要求均满足后按规则合并，并记录结果。
- 本次未创建临时违规测试 PR，也未进行直接推送、强制推送或管理员绕过测试；配置读回不作为这些行为已经实测的证据。

## 当前阻塞

主分支保护已启用。PR #3 仍需完成 PR #10、PR #11 的修复集成，针对最终 head 的 CI 与审查、所有线程解决、非作者批准和业务验收。公开仓库当前文件、可达历史及 PR 讨论/附件的敏感信息验收边界保持不变；当前文件匿名化和单项 Code Review 通过不能替代这些工作。
