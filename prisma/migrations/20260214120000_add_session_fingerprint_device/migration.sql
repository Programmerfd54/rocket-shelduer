-- Add session security fields (safe for re-apply if already present)
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceIdHash" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
