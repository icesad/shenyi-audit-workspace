-- M1 isolated authorization experiment. Not a production database migration.
-- Never run this against the existing Sites profile or customer databases.
PRAGMA foreign_keys = ON;

CREATE TABLE team_users (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled'))
);
CREATE TABLE teams (
  team_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled'))
);
CREATE TABLE team_memberships (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  role TEXT NOT NULL CHECK (role IN ('intern', 'assistant', 'manager', 'partner')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE team_sessions (
  token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES team_users(user_id),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  revoked_at INTEGER
);
CREATE TABLE team_projects (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  financial_summary TEXT NOT NULL DEFAULT '',
  structure_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('active', 'frozen', 'archived')),
  PRIMARY KEY (team_id, project_id)
);
CREATE TABLE team_collection_tasks (
  team_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'submitted', 'returned', 'closed')),
  PRIMARY KEY (team_id, task_id),
  FOREIGN KEY (team_id, project_id) REFERENCES team_projects(team_id, project_id)
);
CREATE TABLE team_task_assignments (
  team_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (team_id, task_id, user_id),
  FOREIGN KEY (team_id, task_id) REFERENCES team_collection_tasks(team_id, task_id),
  FOREIGN KEY (team_id, user_id) REFERENCES team_memberships(team_id, user_id)
);
CREATE TABLE team_project_grants (
  team_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission = 'collection.read'),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (team_id, project_id, user_id, permission),
  FOREIGN KEY (team_id, project_id) REFERENCES team_projects(team_id, project_id),
  FOREIGN KEY (team_id, user_id) REFERENCES team_memberships(team_id, user_id)
);
CREATE TABLE team_collection_attachments (
  team_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (team_id, attachment_id),
  FOREIGN KEY (team_id, task_id) REFERENCES team_collection_tasks(team_id, task_id)
);
CREATE TABLE team_attachment_grants (
  team_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  PRIMARY KEY (team_id, attachment_id, user_id),
  FOREIGN KEY (team_id, attachment_id) REFERENCES team_collection_attachments(team_id, attachment_id),
  FOREIGN KEY (team_id, user_id) REFERENCES team_memberships(team_id, user_id)
);

CREATE INDEX team_assignment_user ON team_task_assignments(team_id, user_id, status);
CREATE INDEX team_project_grant_user ON team_project_grants(team_id, user_id, status);
CREATE INDEX team_tasks_project ON team_collection_tasks(team_id, project_id, task_id);
