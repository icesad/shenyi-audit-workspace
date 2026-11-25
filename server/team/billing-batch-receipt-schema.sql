-- Explicitly initialized synthetic batch receipts only; no orders or rights are created.
CREATE TABLE IF NOT EXISTS team_billing_reconciliation_batches (
  team_id TEXT NOT NULL REFERENCES teams(team_id),
  actor_id TEXT NOT NULL REFERENCES team_users(user_id),
  request_id TEXT NOT NULL CHECK(
    length(request_id)=36 AND instr(request_id,char(0))=0
    AND length(replace(request_id,'-',''))=32 AND replace(request_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(request_id,9,1)='-' AND substr(request_id,14,1)='-'
    AND substr(request_id,19,1)='-' AND substr(request_id,24,1)='-'
    AND substr(request_id,15,1)='4' AND substr(request_id,20,1) IN ('8','9','a','b')
  ),
  order_kind TEXT NOT NULL CHECK(order_kind IN ('annual','seat')),
  after_order_id TEXT,
  merchant_id TEXT NOT NULL CHECK(length(merchant_id) BETWEEN 1 AND 128 AND instr(merchant_id,char(0))=0
    AND merchant_id NOT GLOB '*[^A-Za-z0-9_-]*' AND substr(merchant_id,1,1) GLOB '[A-Za-z0-9]'),
  item_count INTEGER NOT NULL CHECK(item_count BETWEEN 0 AND 8),
  next_cursor TEXT,
  created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY(team_id,actor_id,request_id),
  CHECK(next_cursor IS NULL OR item_count>0)
) STRICT;

CREATE TABLE IF NOT EXISTS team_billing_reconciliation_items (
  team_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  order_id TEXT NOT NULL CHECK(
    length(order_id)=36 AND instr(order_id,char(0))=0
    AND length(replace(order_id,'-',''))=32 AND replace(order_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(order_id,9,1)='-' AND substr(order_id,14,1)='-'
    AND substr(order_id,19,1)='-' AND substr(order_id,24,1)='-'
    AND substr(order_id,15,1)='4' AND substr(order_id,20,1) IN ('8','9','a','b')
  ),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  progress TEXT NOT NULL CHECK(progress IN ('pending','verified','complete')),
  payment_id TEXT,
  receipt_sha256 TEXT,
  confirmed_at INTEGER,
  result_json TEXT CHECK(result_json IS NULL OR (
    length(CAST(result_json AS BLOB)) BETWEEN 1 AND 1024 AND instr(result_json,char(0))=0
  )),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY(team_id,actor_id,request_id,order_id),
  UNIQUE(team_id,actor_id,request_id,ordinal),
  FOREIGN KEY(team_id,actor_id,request_id)
    REFERENCES team_billing_reconciliation_batches(team_id,actor_id,request_id),
  CHECK((payment_id IS NULL AND receipt_sha256 IS NULL AND confirmed_at IS NULL) OR (
    payment_id IS NOT NULL AND receipt_sha256 IS NOT NULL AND confirmed_at IS NOT NULL
    AND length(payment_id)=36 AND instr(payment_id,char(0))=0
    AND length(replace(payment_id,'-',''))=32 AND replace(payment_id,'-','') NOT GLOB '*[^0-9a-f]*'
    AND substr(payment_id,9,1)='-' AND substr(payment_id,14,1)='-'
    AND substr(payment_id,19,1)='-' AND substr(payment_id,24,1)='-'
    AND substr(payment_id,15,1)='4' AND substr(payment_id,20,1) IN ('8','9','a','b')
    AND length(receipt_sha256)=64 AND instr(receipt_sha256,char(0))=0
    AND receipt_sha256 NOT GLOB '*[^0-9a-f]*'
    AND confirmed_at BETWEEN 0 AND 8640000000000000
  )),
  CHECK((progress='pending' AND payment_id IS NULL AND result_json IS NULL)
    OR (progress='verified' AND payment_id IS NOT NULL AND result_json IS NULL)
    OR (progress='complete' AND result_json IS NOT NULL))
) STRICT;
