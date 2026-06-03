INSERT INTO roles (id, name, default_holder, price_adjust_pct_limit)
VALUES
  ('admin', 'Admin', 'Kelvin', NULL),
  ('supply_chain', 'Supply-chain management', 'Daniel', 10),
  ('sales', 'Sales', '', 5),
  ('sales_management', 'Sales management', 'MJ', 10),
  ('operation_management', 'Operation management', 'Billy', 10),
  ('price_auditor', 'Price Auditor(Supervisor)', 'Hao', 12),
  ('read_only', 'Read-only/visitor', '', 0)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  default_holder = excluded.default_holder,
  price_adjust_pct_limit = excluded.price_adjust_pct_limit,
  updated_at = CURRENT_TIMESTAMP;
