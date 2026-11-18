-- Capacity facts are explicit trusted grants. Initializing a team grants no seats.
CREATE TABLE IF NOT EXISTS team_seat_capacity_grants (
  grant_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(grant_id) = 36
    AND substr(grant_id, 9, 1) = '-' AND substr(grant_id, 14, 1) = '-'
    AND substr(grant_id, 19, 1) = '-' AND substr(grant_id, 24, 1) = '-'
    AND length(replace(grant_id, '-', '')) = 32
    AND replace(grant_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(grant_id, 15, 1) = '4' AND substr(grant_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  seats INTEGER NOT NULL CHECK(seats BETWEEN 1 AND 9007199254740991),
  starts_at INTEGER NOT NULL CHECK(starts_at BETWEEN 0 AND 9007199254740991),
  ends_at INTEGER NOT NULL CHECK(ends_at BETWEEN 0 AND 9007199254740991 AND ends_at > starts_at),
  recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN 0 AND 9007199254740991),
  source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 128 AND instr(source_ref, char(0)) = 0),
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK(rowid > 0)
) STRICT;

CREATE INDEX IF NOT EXISTS seat_capacity_grants_team_interval
ON team_seat_capacity_grants(team_id, starts_at, ends_at);

-- Guard REPLACE as well: SQLite may skip DELETE triggers for REPLACE.
CREATE TRIGGER IF NOT EXISTS seat_capacity_grants_no_replace
BEFORE INSERT ON team_seat_capacity_grants
WHEN EXISTS (
  SELECT 1 FROM team_seat_capacity_grants
  WHERE grant_id = NEW.grant_id OR rowid = NEW.rowid
)
BEGIN
  SELECT RAISE(ABORT, 'SEAT_CAPACITY_GRANTS_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_capacity_grants_no_update
BEFORE UPDATE ON team_seat_capacity_grants
BEGIN
  SELECT RAISE(ABORT, 'SEAT_CAPACITY_GRANTS_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_capacity_grants_no_delete
BEFORE DELETE ON team_seat_capacity_grants
BEGIN
  SELECT RAISE(ABORT, 'SEAT_CAPACITY_GRANTS_IMMUTABLE');
END;
