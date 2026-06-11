-- Remove the document "category"/"kind" field entirely.
--
-- The category (medical/training/general/other) classification was dropped from
-- the product: there is no need to ask the admin for a document kind. Document
-- expiration is driven solely by document_types.renewal_months, so removing the
-- category has no effect on the two-year renewal behaviour.
--
-- 0004 added "document_types.category" + its CHECK constraint; this migration
-- removes both. Idempotent: DROP ... IF EXISTS.

ALTER TABLE "document_types"
  DROP CONSTRAINT IF EXISTS "document_types_category_check";
ALTER TABLE "document_types"
  DROP COLUMN IF EXISTS "category";
