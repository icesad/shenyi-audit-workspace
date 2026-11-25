import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../server/team/http-utils.mjs';

const teamId = 'team-a';
const projectId = 'project-a';
const taskId = 'pilot-review-task';
const title = '银行对账说明（已提交示例）';
const filename = '合成银行对账说明.txt';
const actors = { submitter: 'intern-a', otherCollector: 'assistant-a', reviewer: 'manager-a', otherManager: 'partner-a' };
const original = Buffer.from('审易合成验收资料\n银行对账说明\n本文件用于练习采集和核对，全部数据为演练内容。\n');
const followUpFile = 'pilot-follow-up.txt';
const followUpText = '审易合成验收资料\n银行对账说明补充件\n本文件用于练习退回和补交，全部数据为演练内容。\n';

export function preparePilotPreview(db) {
  return transaction(db, () => {
    if (db.prepare("SELECT value FROM team_database_metadata WHERE name='demo'").get()?.value !== 'true') {
      throw new Error('负责人验收示例需要独立合成数据库。');
    }
    const { submitter, reviewer } = actors;
    const submittedAt = Date.now();
    const submissionId = randomUUID();
    const attachmentId = randomUUID();
    const sha256 = createHash('sha256').update(original).digest('hex');
    db.prepare('INSERT INTO team_project_access_projects(team_id,project_id,created_by,created_at) VALUES (?,?,?,?)')
      .run(teamId, projectId, reviewer, submittedAt);
    const assignProjectAccess = db.prepare("INSERT INTO team_project_access_grants(team_id,project_id,user_id,permission,status) VALUES (?,?,?,?,'active')");
    assignProjectAccess.run(teamId, projectId, reviewer, 'project.owner');
    assignProjectAccess.run(teamId, projectId, reviewer, 'collection.review');
    db.prepare("INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,'submitted')")
      .run(teamId, taskId, projectId, title, '核对已提交的合成说明。收到退回后，使用演练补充件再次提交。');
    db.prepare("INSERT INTO team_task_assignments VALUES (?,?,?,'active')").run(teamId, taskId, submitter);
    db.prepare('INSERT INTO team_collection_attachments VALUES (?,?,?,?,?)').run(teamId, taskId, attachmentId, filename, original);
    db.prepare('INSERT INTO team_task_submissions VALUES (?,?,?,?,?,?,?,?)')
      .run(teamId, submissionId, taskId, attachmentId, submitter, sha256, original.length, submittedAt);
    db.prepare("INSERT INTO team_attachment_grants VALUES (?,?,?,'active')").run(teamId, attachmentId, submitter);
    db.prepare('INSERT INTO team_task_versions VALUES (?,?,1)').run(teamId, taskId);
    return {
      cases: { schemaVersion: 1, kind: 'shenyi-pilot-rehearsal', actors: { ...actors }, teamId, projectId,
        task: { id: taskId, title }, original: { submissionId, attachmentId, filename, sha256, byteLength: original.length }, followUpFile },
      followUpText,
    };
  });
}
