# main 分支保护配置与验收

更新日期：2026-11-22

## 当前状态

GitHub API 最近一次读取显示 `main.protected=false`。当前连接可读取仓库和 PR，但没有可用的分支保护写入操作；本文件给出仓库管理员在 GitHub 网页端的配置步骤。配置完成后必须重新读取规则并验证，不以“点过保存”作为完成证据。

仓库：<https://github.com/icesad/shenyi-audit-workspace>

## 配置入口

1. 打开仓库 **Settings**。
2. 进入 **Rules → Rulesets**。
3. 选择 **New ruleset → New branch ruleset**。
4. 名称建议：`protect-main`。
5. Enforcement status 设为 **Active**。
6. Target branches 选择 **Include default branch** 或明确选择 `main`。
7. Bypass list 保持为空；除非组织另有明确的紧急运维策略，不给个人或团队绕过权限。

如果当前仓库界面仍提供经典 Branch protection rules，也可创建针对 `main` 的规则；不要同时建立相互冲突的规则。

## 建议启用的规则

- **Require a pull request before merging**：启用。
- **Required approvals**：1。要求至少一位非 PR 作者的协作者审核；若当前没有第二位具备写权限的审核人，先邀请/确认协作者，再启用该项，避免把主分支锁死。
- **Dismiss stale pull request approvals when new commits are pushed**：启用。
- **Require conversation resolution before merging**：启用。
- **Require status checks to pass**：启用，并添加准确的必需检查名称：
  - `unit`
  - `tools`
- **Require branches to be up to date before merging**：启用。若 GitHub 当前界面不提供该选项，则以最新合并基线上的完整 CI 结果作为人工验收要求。
- **Block force pushes**：启用。
- **Restrict deletions**：启用。
- 不启用允许管理员绕过规则的例外；紧急绕过必须另行记录原因、审批人和回滚方案。

## PR #3 的特殊验收

PR #3 是大型整合（约875个变更文件），不能只凭一个旧 SHA 的绿色状态合并。必须确保：

1. PR #8 安全修复已合并进其 head 分支。
2. PR #3 最新 head SHA 的 `unit` 和 `tools` 两项检查均成功。
3. 最新 Codex Review 针对 PR #3 当前 head 完成，未解决 P1/P2 事项为零。
4. 公开仓库敏感信息检查覆盖当前文件、提交历史和 PR 讨论/附件；当前文件搜索无命中不等于历史审计完成。
5. 所有审查线程已解决，至少一位非作者审核人批准。
6. 业务负责人确认版本范围和回滚方式。

## 配置后的验收

- 在 Settings → Rules → Rulesets 中确认规则为 Active，目标包含 `main`，无非预期 bypass。
- 通过 GitHub API/仓库页面确认 `main` 已受保护。
- 建立一个临时测试 PR，确认缺少必需检查或审核时不能合并。
- 确认正常 PR 在 `unit`、`tools` 和审批通过后可合并。
- 不要通过直接推送、强制推送或管理员绕过来验证。

## 当前阻塞

本文件仅为配置说明，不代表分支保护已经启用。主分支保护需要有仓库 Settings 管理权限的人员在网页端执行，并提供配置后的规则页面/状态供复核。
