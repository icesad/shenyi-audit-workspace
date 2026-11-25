-- Full simulated reversals and confirmed chargebacks are evidence only.
CREATE TABLE IF NOT EXISTS team_billing_payment_exceptions (
  event_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(event_id)=36 AND instr(event_id,char(0))=0 AND length(replace(event_id,'-',''))=32
    AND replace(event_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(event_id,9,1)='-' AND substr(event_id,14,1)='-'
    AND substr(event_id,19,1)='-' AND substr(event_id,24,1)='-'
    AND substr(event_id,15,1)='4' AND substr(event_id,20,1) IN ('8','9','a','b')
  ),
  original_transaction_id TEXT UNIQUE NOT NULL CHECK(
    length(original_transaction_id)=36 AND instr(original_transaction_id,char(0))=0
    AND length(replace(original_transaction_id,'-',''))=32 AND replace(original_transaction_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(original_transaction_id,9,1)='-' AND substr(original_transaction_id,14,1)='-'
    AND substr(original_transaction_id,19,1)='-' AND substr(original_transaction_id,24,1)='-'
    AND substr(original_transaction_id,15,1)='4' AND substr(original_transaction_id,20,1) IN ('8','9','a','b')
  ),
  order_id TEXT UNIQUE NOT NULL,
  product TEXT NOT NULL CHECK(product IN ('team-annual-renewal','team-seat-addition')),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  merchant_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  currency TEXT NOT NULL CHECK(currency='CNY'),
  kind TEXT NOT NULL CHECK(kind IN ('refund','chargeback')),
  occurred_at INTEGER NOT NULL CHECK(occurred_at BETWEEN 0 AND 8640000000000000),
  recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN occurred_at AND 8640000000000000),
  receipt_json TEXT NOT NULL CHECK(length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 16384 AND instr(receipt_json,char(0))=0),
  receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256)=64 AND instr(receipt_sha256,char(0))=0 AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK(rowid>0)
) STRICT;

CREATE TRIGGER IF NOT EXISTS billing_payment_exceptions_locked_order
BEFORE INSERT ON team_billing_payment_exceptions
WHEN NOT (
  NEW.product='team-annual-renewal' AND EXISTS (
    SELECT 1 FROM team_annual_orders
    WHERE order_id=NEW.order_id AND team_id=NEW.team_id AND merchant_id=NEW.merchant_id
      AND amount_minor=NEW.amount_minor AND currency=NEW.currency AND created_at<=NEW.occurred_at
      AND environment='simulation-v1'
  ) OR NEW.product='team-seat-addition' AND EXISTS (
    SELECT 1 FROM team_seat_orders
    WHERE order_id=NEW.order_id AND team_id=NEW.team_id AND merchant_id=NEW.merchant_id
      AND amount_minor=NEW.amount_minor AND currency=NEW.currency AND created_at<=NEW.occurred_at
      AND environment='simulation-v1'
  )
)
BEGIN SELECT RAISE(ABORT,'BILLING_PAYMENT_EXCEPTION_ORDER_MISMATCH'); END;

-- Include all uniqueness paths because REPLACE may bypass DELETE triggers.
CREATE TRIGGER IF NOT EXISTS billing_payment_exceptions_no_replace
BEFORE INSERT ON team_billing_payment_exceptions
WHEN EXISTS (
  SELECT 1 FROM team_billing_payment_exceptions WHERE rowid=NEW.rowid OR event_id=NEW.event_id
    OR order_id=NEW.order_id OR original_transaction_id=NEW.original_transaction_id
)
BEGIN SELECT RAISE(ABORT,'BILLING_PAYMENT_EXCEPTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_payment_exceptions_no_update
BEFORE UPDATE ON team_billing_payment_exceptions
BEGIN SELECT RAISE(ABORT,'BILLING_PAYMENT_EXCEPTION_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS billing_payment_exceptions_no_delete
BEFORE DELETE ON team_billing_payment_exceptions
BEGIN SELECT RAISE(ABORT,'BILLING_PAYMENT_EXCEPTION_IMMUTABLE'); END;
