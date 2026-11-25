-- Immutable synthetic annual order seat plans. Initialization creates no plans.
CREATE TABLE IF NOT EXISTS team_annual_order_seat_plans (
  order_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(order_id) = 36 AND instr(order_id, char(0)) = 0
    AND length(replace(order_id, '-', '')) = 32
    AND replace(order_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(order_id, 9, 1) = '-' AND substr(order_id, 14, 1) = '-'
    AND substr(order_id, 19, 1) = '-' AND substr(order_id, 24, 1) = '-'
    AND substr(order_id, 15, 1) = '4' AND substr(order_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  team_id TEXT NOT NULL CHECK(instr(team_id, char(0)) = 0),
  default_seats INTEGER NOT NULL CHECK(default_seats BETWEEN 0 AND 9007199254740991),
  selected_seats INTEGER NOT NULL CHECK(selected_seats BETWEEN 0 AND 9007199254740991),
  base_amount_minor INTEGER NOT NULL CHECK(base_amount_minor BETWEEN 1 AND 9007199254740991),
  unit_amount_minor INTEGER NOT NULL CHECK(unit_amount_minor BETWEEN 1 AND 9007199254740991),
  basis_revision INTEGER NOT NULL CHECK(basis_revision BETWEEN 0 AND 9007199254740991),
  basis_ends_at INTEGER,
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64 AND instr(request_sha256, char(0)) = 0
    AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY(order_id, team_id) REFERENCES team_annual_orders(order_id, team_id),
  CHECK((basis_revision = 0 AND basis_ends_at IS NULL)
    OR (basis_revision > 0 AND basis_ends_at IS NOT NULL AND basis_ends_at BETWEEN 1 AND 9007199254740991)),
  CHECK(rowid > 0)
) STRICT;

-- Check both unique keys because REPLACE can bypass DELETE triggers.
CREATE TRIGGER IF NOT EXISTS annual_seat_plans_no_replace
BEFORE INSERT ON team_annual_order_seat_plans
WHEN EXISTS (
  SELECT 1 FROM team_annual_order_seat_plans
  WHERE order_id = NEW.order_id OR rowid = NEW.rowid
)
BEGIN
  SELECT RAISE(ABORT, 'ANNUAL_SEAT_PLAN_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS annual_seat_plans_no_update
BEFORE UPDATE ON team_annual_order_seat_plans
BEGIN
  SELECT RAISE(ABORT, 'ANNUAL_SEAT_PLAN_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS annual_seat_plans_no_delete
BEFORE DELETE ON team_annual_order_seat_plans
BEGIN
  SELECT RAISE(ABORT, 'ANNUAL_SEAT_PLAN_IMMUTABLE');
END;
