-- The back office's "ระบบ Studio" page (src/admin/studio-system.ts) records the naka-studio tasks an admin
-- cancels in system_audit: area 'studio', action 'cancel'. Existing rows keep their values.
ALTER TABLE system_audit DROP CONSTRAINT system_audit_area_check;
ALTER TABLE system_audit ADD CONSTRAINT system_audit_area_check CHECK (area IN ('setting', 'plan', 'studio'));
ALTER TABLE system_audit DROP CONSTRAINT system_audit_action_check;
ALTER TABLE system_audit ADD CONSTRAINT system_audit_action_check
  CHECK (action IN ('set', 'clear', 'import', 'create', 'update', 'cancel'));
