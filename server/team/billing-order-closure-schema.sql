-- An annual order's optional deadline is pinned at creation. Old orders are not backfilled.
CREATE TABLE IF NOT EXISTS team_billing_annual_close_windows (
  order_id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL,
  order_created_at INTEGER NOT NULL CHECK(order_created_at BETWEEN 0 AND 8640000000000000),
  order_request_sha256 TEXT NOT NULL CHECK(length(order_request_sha256)=64 AND instr(order_request_sha256,char(0))=0 AND order_request_sha256 NOT GLOB '*[^0-9a-f]*'),
  duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 1 AND 8640000000000000),
  deadline_at INTEGER NOT NULL CHECK(deadline_at BETWEEN 1 AND 8640000000000000 AND deadline_at=order_created_at+duration_ms),
  FOREIGN KEY(order_id,team_id) REFERENCES team_annual_orders(order_id,team_id),
  CHECK(rowid>0)
) STRICT;

CREATE TRIGGER IF NOT EXISTS billing_annual_close_windows_locked_order
BEFORE INSERT ON team_billing_annual_close_windows
WHEN NOT EXISTS (
  SELECT 1 FROM team_annual_orders
  WHERE order_id=NEW.order_id AND team_id=NEW.team_id AND environment='simulation-v1'
    AND created_at=NEW.order_created_at AND request_sha256=NEW.order_request_sha256
) OR EXISTS (SELECT 1 FROM team_annual_verified_payments WHERE order_id=NEW.order_id)
  OR EXISTS (SELECT 1 FROM team_billing_payment_exceptions WHERE order_id=NEW.order_id)
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_ORDER_MISMATCH'); END;

CREATE TRIGGER IF NOT EXISTS billing_annual_close_windows_no_replace
BEFORE INSERT ON team_billing_annual_close_windows
WHEN EXISTS (SELECT 1 FROM team_billing_annual_close_windows WHERE rowid=NEW.rowid OR order_id=NEW.order_id)
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_annual_close_windows_no_update
BEFORE UPDATE ON team_billing_annual_close_windows
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_annual_close_windows_no_delete
BEFORE DELETE ON team_billing_annual_close_windows
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;

-- This records an unpaid close result from the synthetic channel, never a refund or grant.
CREATE TABLE IF NOT EXISTS team_billing_order_closures (
  event_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(event_id)=36 AND instr(event_id,char(0))=0 AND length(replace(event_id,'-',''))=32
    AND replace(event_id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(event_id,9,1)='-' AND substr(event_id,14,1)='-'
    AND substr(event_id,19,1)='-' AND substr(event_id,24,1)='-' AND substr(event_id,15,1)='4' AND substr(event_id,20,1) IN ('8','9','a','b')
  ),
  order_id TEXT UNIQUE NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('team-annual-renewal','team-seat-addition')),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  merchant_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK(currency='CNY'),
  order_request_sha256 TEXT NOT NULL CHECK(length(order_request_sha256)=64 AND instr(order_request_sha256,char(0))=0 AND order_request_sha256 NOT GLOB '*[^0-9a-f]*'),
  deadline_at INTEGER NOT NULL CHECK(deadline_at BETWEEN 1 AND 8640000000000000),
  closed_at INTEGER NOT NULL CHECK(closed_at BETWEEN deadline_at AND 8640000000000000),
  recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN closed_at AND 8640000000000000),
  receipt_json TEXT NOT NULL CHECK(length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 16384 AND instr(receipt_json,char(0))=0),
  receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64 AND instr(receipt_sha256,char(0))=0 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK(rowid>0)
) STRICT;

CREATE TRIGGER IF NOT EXISTS billing_order_closures_locked_order
BEFORE INSERT ON team_billing_order_closures
WHEN NOT (
  NEW.product='team-annual-renewal' AND EXISTS (
    SELECT 1 FROM team_annual_orders orders JOIN team_billing_annual_close_windows pinned USING(order_id,team_id)
    WHERE orders.order_id=NEW.order_id AND orders.team_id=NEW.team_id
      AND orders.merchant_id=NEW.merchant_id AND orders.currency=NEW.currency AND orders.amount_minor=NEW.amount_minor
      AND orders.environment='simulation-v1' AND orders.request_sha256=NEW.order_request_sha256
      AND orders.request_sha256=pinned.order_request_sha256 AND orders.created_at=pinned.order_created_at
      AND pinned.deadline_at=NEW.deadline_at
  ) OR NEW.product='team-seat-addition' AND EXISTS (
    SELECT 1 FROM team_seat_orders
    WHERE order_id=NEW.order_id AND team_id=NEW.team_id AND merchant_id=NEW.merchant_id
      AND currency=NEW.currency AND amount_minor=NEW.amount_minor AND environment='simulation-v1'
      AND request_sha256=NEW.order_request_sha256 AND quote_expires_at=NEW.deadline_at
  )
)
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_ORDER_MISMATCH'); END;

CREATE TRIGGER IF NOT EXISTS billing_order_closures_no_prior_payment
BEFORE INSERT ON team_billing_order_closures
WHEN EXISTS (SELECT 1 FROM team_annual_verified_payments WHERE order_id=NEW.order_id OR event_id=NEW.event_id)
  OR EXISTS (SELECT 1 FROM team_seat_verified_payments WHERE order_id=NEW.order_id OR event_id=NEW.event_id)
  OR EXISTS (SELECT 1 FROM team_billing_payment_exceptions WHERE order_id=NEW.order_id OR event_id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_CONFLICTING_FACT'); END;

CREATE TRIGGER IF NOT EXISTS billing_order_closures_no_replace
BEFORE INSERT ON team_billing_order_closures
WHEN EXISTS (SELECT 1 FROM team_billing_order_closures WHERE rowid=NEW.rowid OR event_id=NEW.event_id OR order_id=NEW.order_id)
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_order_closures_no_update
BEFORE UPDATE ON team_billing_order_closures
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_order_closures_no_delete
BEFORE DELETE ON team_billing_order_closures
BEGIN SELECT RAISE(ABORT,'BILLING_ORDER_CLOSURE_IMMUTABLE'); END;
