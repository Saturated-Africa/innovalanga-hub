-- Entity details and a CIPC certificate at onboarding.
--
-- Two gaps this closes.
--
-- The platform had nowhere to put a registration certificate. It could hold an ID
-- document, but only against a participant - and until acceptance started creating
-- participants, a beneficiary form produced none, so there was no point in the
-- process where a certificate could be filed. An entity's registration was a
-- number typed onto a grant months later with nothing behind it.
--
-- And registration details lived only on Grant, so a facilitator awarding one
-- retyped a number off a certificate they had already seen at onboarding. One
-- transcription too many for a figure that ends up on a grant agreement and a
-- funder's report.

-- The entity, where there is one. Nullable throughout: a sole proprietor has no
-- registration number, and refusing to onboard somebody for not having one would
-- exclude most of the people this programme exists for.
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "entityType" "EntityType";
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "entityRegistrationNumber" TEXT;
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "entityName" TEXT;

-- Documents can now be collected before somebody is a participant.
--
-- innovatorId becomes nullable, and a document may instead - or also - name the
-- beneficiary form it was collected against. Acceptance fills innovatorId in, so
-- the document appears in the participant's vault without being uploaded twice,
-- while the beneficiary link stays as provenance.
ALTER TABLE "Document" ALTER COLUMN "innovatorId" DROP NOT NULL;
ALTER TABLE "Document" ADD COLUMN "beneficiaryRecordId" TEXT;
ALTER TABLE "Document" ADD COLUMN "uploadedByUserId" TEXT;

ALTER TABLE "Document" ADD CONSTRAINT "Document_beneficiaryRecordId_fkey"
  FOREIGN KEY ("beneficiaryRecordId") REFERENCES "BeneficiaryRecord"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Document_innovatorId_type_idx" ON "Document"("innovatorId", "type");
CREATE INDEX "Document_beneficiaryRecordId_idx" ON "Document"("beneficiaryRecordId");

-- A document has to belong to something. Without this it could belong to neither,
-- which is a file in storage that no screen can reach and nobody can delete
-- through the interface - the same state the finance proofs constraint exists to
-- prevent.
ALTER TABLE "Document" ADD CONSTRAINT "Document_has_an_owner"
  CHECK ("innovatorId" IS NOT NULL OR "beneficiaryRecordId" IS NOT NULL);

-- The new document type.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'cipc_registration';

-- Row-level security for the new ownership.
--
-- The old policy reached the programme through the participant. A document
-- attached to a beneficiary form has no participant yet, so it reaches the
-- programme through the form instead. Both are spelled out: a document with
-- neither is impossible by the constraint above, and a policy that fell through
-- to permitting such a row would be a document readable by every tenant.
DROP POLICY IF EXISTS tenant_isolation ON "Document";

CREATE POLICY tenant_isolation ON "Document" FOR ALL
  USING (
    ("innovatorId" IS NOT NULL AND app_innovator_in_scope("innovatorId"))
    OR ("beneficiaryRecordId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "BeneficiaryRecord" b
      WHERE b.id = "beneficiaryRecordId" AND b."programmeId" = app_current_programme()
    ))
  )
  WITH CHECK (
    ("innovatorId" IS NOT NULL AND app_innovator_in_scope("innovatorId"))
    OR ("beneficiaryRecordId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "BeneficiaryRecord" b
      WHERE b.id = "beneficiaryRecordId" AND b."programmeId" = app_current_programme()
    ))
  );
