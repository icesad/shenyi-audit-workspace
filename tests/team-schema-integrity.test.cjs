'use strict';
// Independent relational-boundary regression: actual SQLite and synthetic data.
// This does not claim a production database, login or network integration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const path = require('node:path');

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(path.resolve(__dirname, '../server/team/schema.sql'), 'utf8'));
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.exec(`
    INSERT INTO team_users VALUES ('user-a', 'active'), ('user-b', 'active');
    INSERT INTO teams VALUES ('team-a', 'active'), ('team-b', 'active');
    INSERT INTO team_memberships VALUES
      ('team-a', 'user-a', 'intern', 'active'),
      ('team-b', 'user-b', 'partner', 'active');
    INSERT INTO team_projects VALUES
      ('team-a', 'project-a', 'Synthetic A', '', '{}', 'active'),
      ('team-b', 'project-b', 'Synthetic B', '', '{}', 'active');
    INSERT INTO team_collection_tasks VALUES
      ('team-a', 'task-a', 'project-a', 'Synthetic A', 'Collect A', 'open'),
      ('team-b', 'task-b', 'project-b', 'Synthetic B', 'Collect B', 'open');
    INSERT INTO team_collection_attachments VALUES
      ('team-a', 'task-a', 'file-a', 'synthetic.txt', X'01');
  `);
  return db;
}

test('task assignment cannot use a member from another team', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_task_assignments
    (team_id, task_id, user_id, status) VALUES (?, ?, ?, ?)`)
    .run('team-a', 'task-a', 'user-b', 'active'), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_task_assignments').get().count, 0);
});

test('project collection grant cannot use a member from another team', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_project_grants
    (team_id, project_id, user_id, permission, status) VALUES (?, ?, ?, ?, ?)`)
    .run('team-a', 'project-a', 'user-b', 'collection.read', 'active'), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_project_grants').get().count, 0);
});

test('attachment grant cannot use a member from another team', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_attachment_grants
    (team_id, attachment_id, user_id, status) VALUES (?, ?, ?, ?)`)
    .run('team-a', 'file-a', 'user-b', 'active'), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_attachment_grants').get().count, 0);
});

test('collection task cannot reference another team project', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_collection_tasks
    (team_id, task_id, project_id, title, instructions, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('team-a', 'foreign-project-task', 'project-b', 'Synthetic', 'Collect', 'open'), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_collection_tasks').get().count, 2);
});

test('collection attachment cannot reference another team task', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_collection_attachments
    (team_id, task_id, attachment_id, display_name, bytes) VALUES (?, ?, ?, ?, ?)`)
    .run('team-a', 'task-b', 'foreign-task-file', 'synthetic.txt', Buffer.from([2])), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_collection_attachments').get().count, 1);
});

test('session cannot reference a nonexistent user', t => {
  const db = fixture(t);
  assert.throws(() => db.prepare(`INSERT INTO team_sessions
    (token_hash, user_id, expires_at, revoked_at) VALUES (?, ?, ?, ?)`)
    .run('a'.repeat(64), 'missing-user', 1, null), /FOREIGN KEY constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM team_sessions').get().count, 0);
});
