-- CreateEnum
CREATE TYPE "DeduplicationMode" AS ENUM ('ENABLED', 'DISABLED');

-- AlterTable
ALTER TABLE "MediaAsset"
  ADD COLUMN "deduplicationMode" "DeduplicationMode" NOT NULL DEFAULT 'ENABLED';

ALTER TABLE "MediaAsset"
  ADD COLUMN "deduplicationKey" TEXT;

-- Backfill existing data
UPDATE "MediaAsset"
SET "deduplicationKey" = CONCAT('enabled:', "familyId", ':', "sha256")
WHERE "deduplicationKey" IS NULL;

-- Make deduplicationKey required
ALTER TABLE "MediaAsset"
  ALTER COLUMN "deduplicationKey" SET NOT NULL;

-- Drop old unique constraint if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MediaAsset_familyId_sha256_key'
  ) THEN
    ALTER TABLE "MediaAsset"
      DROP CONSTRAINT "MediaAsset_familyId_sha256_key";
  END IF;
END $$;

-- Create unique index for deduplicationKey
CREATE UNIQUE INDEX "MediaAsset_deduplicationKey_key" ON "MediaAsset"("deduplicationKey");

-- Create supporting indexes
CREATE INDEX "MediaAsset_familyId_sha256_idx" ON "MediaAsset"("familyId", "sha256");
CREATE INDEX "MediaAsset_familyId_deduplicationMode_idx" ON "MediaAsset"("familyId", "deduplicationMode");
CREATE INDEX "MediaAsset_sha256_idx" ON "MediaAsset"("sha256");
