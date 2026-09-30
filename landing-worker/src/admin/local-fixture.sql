-- Fictional local-only customer for checking the three forms; never apply to a remote database.
INSERT OR IGNORE INTO users (id, display_name, created_at, status)
VALUES ('admin-demo-customer', 'ร้านทดสอบหลังร้าน', unixepoch(), 'active');
INSERT OR IGNORE INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at)
VALUES ('admin-demo-phone', 'admin-demo-customer', 'phone', '+66800000001', NULL, unixepoch()),
       ('admin-demo-google', 'admin-demo-customer', 'google', 'admin-demo-google-sub', 'admin-demo@example.test', unixepoch());
INSERT OR IGNORE INTO sessions (id, user_id, created_at, expires_at)
VALUES ('admin-demo-session', 'admin-demo-customer', unixepoch(), unixepoch() + 86400);
