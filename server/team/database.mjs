import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {hashPassword} from './passwords.mjs';
import {ensureSessionMetadata} from './auth-api.mjs';
import {installRecoveryEpochTriggers} from './recovery-review-epochs.mjs';
import {ensureDeviceServerId} from './device-policy.mjs';
import {installMaterialQualificationTriggers} from './materials-scope.mjs';

export function initializeTeamDatabase(db) {
  db.exec('PRAGMA foreign_keys = ON');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  if (tables.length) {
    const metadata = tables.some(row => row.name === 'team_database_metadata') && db.prepare("SELECT value FROM team_database_metadata WHERE name='prototype-version'").get();
    if (metadata?.value !== '2') throw new Error('Not an isolated M2 database; no automatic migration');
    db.exec(readFileSync(fileURLToPath(new URL('./identity-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./activation-schema.sql', import.meta.url)), 'utf8'));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(fileURLToPath(new URL('./provisioning-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./recovery-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./recovery-review-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./member-access-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./device-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./device-replacement-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./business-role-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./project-access-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./administrator-business-role-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./migration-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./materials-schema.sql', import.meta.url)), 'utf8'));
      installMaterialQualificationTriggers(db);
      ensureDeviceServerId(db);
      installRecoveryEpochTriggers(db);
      db.exec(readFileSync(fileURLToPath(new URL('./session-schema.sql', import.meta.url)), 'utf8'));
      ensureSessionMetadata(db);
      db.exec('COMMIT');
    } catch(error) { db.exec('ROLLBACK');throw error; }
    db.exec('PRAGMA foreign_keys = ON'); return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8'));
    db.prepare('INSERT INTO team_database_metadata VALUES (?,?)').run('prototype-version', '2');
    db.exec(readFileSync(fileURLToPath(new URL('./identity-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./activation-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./provisioning-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./recovery-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./recovery-review-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./member-access-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./device-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./device-replacement-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./business-role-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./project-access-schema.sql', import.meta.url)), 'utf8'));
      db.exec(readFileSync(fileURLToPath(new URL('./administrator-business-role-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./migration-schema.sql', import.meta.url)), 'utf8'));
    db.exec(readFileSync(fileURLToPath(new URL('./materials-schema.sql', import.meta.url)), 'utf8'));
    installMaterialQualificationTriggers(db);
    ensureDeviceServerId(db);
    installRecoveryEpochTriggers(db);
    db.exec(readFileSync(fileURLToPath(new URL('./session-schema.sql', import.meta.url)), 'utf8'));
    db.exec('COMMIT'); db.exec('PRAGMA foreign_keys = ON');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Explicit demo-only bootstrap; all names, tasks and the shared demo password are synthetic. */
export async function seedDemoTeamData(db) {
  if (db.prepare("SELECT value FROM team_database_metadata WHERE name='demo'").get()?.value === 'true') return;
  if (db.prepare('SELECT COUNT(*) AS n FROM team_users').get().n !== 0) throw new Error('Refusing to seed nonempty database');
  const records = [];
  for (const team of ['a', 'b']) for (const role of ['intern', 'assistant', 'manager', 'partner']) {
    records.push({id: `${role}-${team}`, team, role, hash: await hashPassword('ShenyiDemo!2026')});
  }
  records.push({id: 'invitee-a', team: null, role: null, hash: await hashPassword('ShenyiDemo!2026')});
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const team of ['a', 'b']) {
      db.prepare('INSERT INTO teams VALUES (?,?)').run(`team-${team}`, 'active');
      db.prepare('INSERT INTO team_projects(team_id,project_id,title,status) VALUES (?,?,?,?)').run(`team-${team}`, `project-${team}`, `合成项目${team.toUpperCase()}`, 'active');
    }
    for (const record of records) {
      db.prepare('INSERT INTO team_users(user_id,status) VALUES (?,?)').run(record.id, 'active');
      db.prepare('INSERT INTO team_credentials(user_id,username,display_name,password_hash) VALUES (?,?,?,?)').run(record.id, record.id, record.id, record.hash);
      if (!record.team) continue;
      const teamId = `team-${record.team}`;
      db.prepare('INSERT INTO team_memberships VALUES (?,?,?,?)').run(teamId, record.id, record.role, 'active');
      if (['intern', 'assistant'].includes(record.role)) {
        const taskId = record.role === 'intern' ? 'task-a' : 'task-assistant';
        db.prepare('INSERT INTO team_collection_tasks(team_id,task_id,project_id,title,instructions,status) VALUES (?,?,?,?,?,?)').run(teamId, taskId, `project-${record.team}`, record.role === 'intern' ? '收集银行对账单' : '收集业务凭证', '仅使用合成文件验证采集与保存；请勿上传真实客户资料。', 'open');
        db.prepare('INSERT INTO team_task_assignments VALUES (?,?,?,?)').run(teamId, taskId, record.id, 'active');
      } else {
        for (const permission of ['collection.read', 'collection.manage']) db.prepare('INSERT INTO team_project_grants VALUES (?,?,?,?,?)').run(teamId, `project-${record.team}`, record.id, permission, 'active');
        db.prepare('INSERT INTO team_admin_grants VALUES (?,?,?,?)').run(teamId, record.id, 'member.invite', 'active');
      }
    }
    db.prepare('INSERT INTO team_database_metadata VALUES (?,?)').run('demo', 'true');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
