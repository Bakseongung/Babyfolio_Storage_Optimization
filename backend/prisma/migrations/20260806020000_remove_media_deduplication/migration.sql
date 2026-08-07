-- Existing shared assets cannot be converted to one-to-one ownership safely without
-- choosing which Media keeps each object set. Abort before changing the schema so
-- operators can resolve those rows explicitly.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Media"
    WHERE "mediaAssetId" IS NOT NULL
    GROUP BY "mediaAssetId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'MediaAsset one-to-one migration blocked: shared Media.mediaAssetId values must be resolved first';
  END IF;
END $$;

DROP INDEX IF EXISTS "Media_mediaAssetId_idx";
CREATE UNIQUE INDEX "Media_mediaAssetId_key" ON "Media"("mediaAssetId");

DROP INDEX IF EXISTS "MediaAsset_deduplicationKey_key";
DROP INDEX IF EXISTS "MediaAsset_familyId_sha256_idx";
DROP INDEX IF EXISTS "MediaAsset_familyId_deduplicationMode_idx";
DROP INDEX IF EXISTS "MediaAsset_sha256_idx";

ALTER TABLE "MediaAsset"
  DROP COLUMN "deduplicationKey",
  DROP COLUMN "deduplicationMode",
  DROP COLUMN "sha256";

DROP TYPE "DeduplicationMode";

COMMIT;
