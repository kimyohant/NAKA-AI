-- Paid packages shown on the home page pricing section (public/index.html).
-- price_thb is the monthly price; yearly billing charges 10 months.
INSERT OR IGNORE INTO plans (id, name, monthly_credits, max_parallel_jobs, price_thb) VALUES
  ('starter', 'เริ่มต้น', 30, 1, 399),
  ('pro', 'โปร', 80, 2, 790),
  ('business', 'ธุรกิจ', 160, 4, 1290),
  ('max', 'สูงสุด', 300, 8, 1990);
