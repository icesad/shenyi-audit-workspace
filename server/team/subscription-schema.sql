-- M5A explicit trusted subscription terms only; no payment or seat capacity policy.
CREATE TABLE IF NOT EXISTS team_subscription_events (
 operation_id TEXT PRIMARY KEY NOT NULL CHECK(typeof(operation_id)='text' AND length(operation_id)=36
  AND substr(operation_id,9,1)='-' AND substr(operation_id,14,1)='-' AND substr(operation_id,19,1)='-' AND substr(operation_id,24,1)='-'
  AND length(replace(operation_id,'-',''))=32 AND replace(operation_id,'-','') NOT GLOB '*[^0-9a-f]*'
  AND substr(operation_id,15,1)='4' AND substr(operation_id,20,1) IN ('8','9','a','b')),
 team_id TEXT NOT NULL REFERENCES teams(team_id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer' AND starts_at BETWEEN 0 AND 9007199254740991),
 ends_at INTEGER NOT NULL CHECK(typeof(ends_at)='integer' AND ends_at BETWEEN 0 AND 9007199254740991 AND ends_at>starts_at),
 recorded_at INTEGER NOT NULL CHECK(typeof(recorded_at)='integer' AND recorded_at BETWEEN 0 AND 9007199254740991),
 source_ref TEXT NOT NULL CHECK(typeof(source_ref)='text' AND length(source_ref) BETWEEN 1 AND 128 AND instr(source_ref,char(0))=0),
 request_sha256 TEXT NOT NULL CHECK(typeof(request_sha256)='text' AND length(request_sha256)=64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
 UNIQUE(team_id,revision)
);
CREATE TABLE IF NOT EXISTS team_subscription_heads (
 team_id TEXT PRIMARY KEY NOT NULL REFERENCES teams(team_id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 FOREIGN KEY(team_id,revision) REFERENCES team_subscription_events(team_id,revision)
);
CREATE TRIGGER IF NOT EXISTS subscription_events_no_update BEFORE UPDATE ON team_subscription_events BEGIN
 SELECT RAISE(ABORT,'SUBSCRIPTION_EVENTS_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS subscription_events_no_delete BEFORE DELETE ON team_subscription_events BEGIN
 SELECT RAISE(ABORT,'SUBSCRIPTION_EVENTS_IMMUTABLE');
END;
