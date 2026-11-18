-- Synthetic seat orders and verified payment facts. Initialization creates no entitlements.
CREATE TABLE IF NOT EXISTS team_seat_orders (
  order_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(order_id) = 36 AND instr(order_id, char(0)) = 0 AND length(replace(order_id, '-', '')) = 32
    AND replace(order_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(order_id, 9, 1) = '-' AND substr(order_id, 14, 1) = '-'
    AND substr(order_id, 19, 1) = '-' AND substr(order_id, 24, 1) = '-'
    AND substr(order_id, 15, 1) = '4' AND substr(order_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  request_id TEXT NOT NULL CHECK(
    length(request_id) = 36 AND instr(request_id, char(0)) = 0 AND length(replace(request_id, '-', '')) = 32
    AND replace(request_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(request_id, 9, 1) = '-' AND substr(request_id, 14, 1) = '-'
    AND substr(request_id, 19, 1) = '-' AND substr(request_id, 24, 1) = '-'
    AND substr(request_id, 15, 1) = '4' AND substr(request_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  merchant_id TEXT NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128 AND instr(merchant_id, char(0)) = 0
    AND merchant_id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(merchant_id, 1, 1) GLOB '[A-Za-z0-9]'),
  offer_id TEXT NOT NULL CHECK(length(offer_id) BETWEEN 1 AND 128 AND instr(offer_id, char(0)) = 0
    AND offer_id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(offer_id, 1, 1) GLOB '[A-Za-z0-9]'),
  offer_revision INTEGER NOT NULL CHECK(offer_revision BETWEEN 1 AND 9007199254740991),
  annual_unit_amount_minor INTEGER NOT NULL CHECK(annual_unit_amount_minor BETWEEN 1 AND 9007199254740991),
  amount_minor INTEGER NOT NULL CHECK(amount_minor BETWEEN 1 AND 9007199254740991),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  currency TEXT NOT NULL CHECK(currency = 'CNY'),
  environment TEXT NOT NULL CHECK(environment = 'simulation-v1'),
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  quote_expires_at INTEGER NOT NULL CHECK(quote_expires_at BETWEEN 0 AND 8640000000000000),
  term_revision INTEGER NOT NULL CHECK(term_revision BETWEEN 1 AND 9007199254740991),
  term_starts_at INTEGER NOT NULL CHECK(term_starts_at BETWEEN 0 AND 8640000000000000),
  term_ends_at INTEGER NOT NULL CHECK(term_ends_at BETWEEN 0 AND 8640000000000000),
  request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64 AND instr(request_sha256, char(0)) = 0
    AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
  UNIQUE(team_id, request_id),
  UNIQUE(order_id, team_id),
  FOREIGN KEY(team_id, term_revision) REFERENCES team_subscription_events(team_id, revision),
  CHECK(term_starts_at <= created_at AND created_at < quote_expires_at AND quote_expires_at <= term_ends_at),
  CHECK(rowid > 0)
) STRICT;

CREATE TABLE IF NOT EXISTS team_seat_verified_payments (
  payment_id TEXT PRIMARY KEY NOT NULL CHECK(
    length(payment_id) = 36 AND instr(payment_id, char(0)) = 0 AND length(replace(payment_id, '-', '')) = 32
    AND replace(payment_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(payment_id, 9, 1) = '-' AND substr(payment_id, 14, 1) = '-'
    AND substr(payment_id, 19, 1) = '-' AND substr(payment_id, 24, 1) = '-'
    AND substr(payment_id, 15, 1) = '4' AND substr(payment_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  order_id TEXT UNIQUE NOT NULL,
  team_id TEXT NOT NULL,
  event_id TEXT UNIQUE NOT NULL CHECK(
    length(event_id) = 36 AND instr(event_id, char(0)) = 0 AND length(replace(event_id, '-', '')) = 32
    AND replace(event_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(event_id, 9, 1) = '-' AND substr(event_id, 14, 1) = '-'
    AND substr(event_id, 19, 1) = '-' AND substr(event_id, 24, 1) = '-'
    AND substr(event_id, 15, 1) = '4' AND substr(event_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  transaction_id TEXT UNIQUE NOT NULL CHECK(
    length(transaction_id) = 36 AND instr(transaction_id, char(0)) = 0 AND length(replace(transaction_id, '-', '')) = 32
    AND replace(transaction_id, '-', '') NOT GLOB '*[^0-9a-f]*'
    AND substr(transaction_id, 9, 1) = '-' AND substr(transaction_id, 14, 1) = '-'
    AND substr(transaction_id, 19, 1) = '-' AND substr(transaction_id, 24, 1) = '-'
    AND substr(transaction_id, 15, 1) = '4' AND substr(transaction_id, 20, 1) IN ('8', '9', 'a', 'b')
  ),
  receipt_json TEXT NOT NULL CHECK(length(CAST(receipt_json AS BLOB)) BETWEEN 1 AND 16384
    AND instr(receipt_json, char(0)) = 0),
  receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256) = 64 AND instr(receipt_sha256, char(0)) = 0
    AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'),
  confirmed_at INTEGER NOT NULL CHECK(confirmed_at BETWEEN 0 AND 8640000000000000),
  UNIQUE(payment_id, order_id, team_id),
  FOREIGN KEY(order_id, team_id) REFERENCES team_seat_orders(order_id, team_id),
  CHECK(rowid > 0)
) STRICT;

-- Check all unique keys because REPLACE can bypass DELETE triggers.
CREATE TRIGGER IF NOT EXISTS seat_orders_no_replace
BEFORE INSERT ON team_seat_orders
WHEN EXISTS (
  SELECT 1 FROM team_seat_orders
  WHERE order_id = NEW.order_id OR rowid = NEW.rowid
    OR (team_id = NEW.team_id AND request_id = NEW.request_id)
)
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_orders_no_update
BEFORE UPDATE ON team_seat_orders
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_orders_no_delete
BEFORE DELETE ON team_seat_orders
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_verified_payments_no_replace
BEFORE INSERT ON team_seat_verified_payments
WHEN EXISTS (
  SELECT 1 FROM team_seat_verified_payments
  WHERE payment_id = NEW.payment_id OR rowid = NEW.rowid OR order_id = NEW.order_id
    OR event_id = NEW.event_id OR transaction_id = NEW.transaction_id
)
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_verified_payments_no_update
BEFORE UPDATE ON team_seat_verified_payments
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS seat_verified_payments_no_delete
BEFORE DELETE ON team_seat_verified_payments
BEGIN
  SELECT RAISE(ABORT, 'SEAT_ORDER_IMMUTABLE');
END;
