-- Admins sign in with Google (src/admin/auth.ts): record who made each customer change.
-- The admin's Google email, or "โทเคนฉุกเฉิน" for the ADMIN_TOKEN break-glass; '' for rows written before this.
ALTER TABLE admin_audit ADD COLUMN actor TEXT NOT NULL DEFAULT '';
