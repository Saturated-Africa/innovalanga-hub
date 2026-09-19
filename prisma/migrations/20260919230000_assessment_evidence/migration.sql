-- Link a score to the documents that justify it.
--
-- The rubric says that if evidence is not on file it did not happen. The vault and
-- the assessment were unconnected, so that sentence was an honour system: a
-- facilitator could score BRL 6 and nothing pointed at the tax clearance behind
-- it, and a funder could not check a cohort's numbers without asking somebody to
-- go and look.
--
-- Evidence attaches per dimension, not per assessment. What proves BRL 6 - a SARS
-- compliance PIN, a B-BBEE affidavit - is not what proves TRL 5. One document can
-- support several dimensions and often does: a host site letter speaks to both the
-- technology and the market.
CREATE TABLE "AssessmentEvidence" (
  "id"             TEXT NOT NULL,
  "assessmentId"   TEXT NOT NULL,
  "documentId"     TEXT NOT NULL,
  "dimension"      TEXT NOT NULL,
  "note"           TEXT,
  "linkedByUserId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssessmentEvidence_pkey" PRIMARY KEY ("id")
);

-- The same document cannot be attached to the same dimension twice. Without this a
-- "documents supporting this score" count is inflatable by clicking twice.
CREATE UNIQUE INDEX "AssessmentEvidence_assessment_dimension_document_key"
  ON "AssessmentEvidence"("assessmentId", "dimension", "documentId");
CREATE INDEX "AssessmentEvidence_assessmentId_idx" ON "AssessmentEvidence"("assessmentId");
CREATE INDEX "AssessmentEvidence_documentId_idx" ON "AssessmentEvidence"("documentId");

-- A string rather than an enum, matching ReadinessDimension.key, which is how this
-- platform already names dimensions: they are per-programme configuration rather
-- than a fixed set. The constraint still refuses a typo, so "TRL" or "brl " cannot
-- create a fifth dimension that no screen reads.
ALTER TABLE "AssessmentEvidence" ADD CONSTRAINT "AssessmentEvidence_dimension_known"
  CHECK ("dimension" IN ('trl', 'brl', 'mrl', 'irl'));

ALTER TABLE "AssessmentEvidence" ADD CONSTRAINT "AssessmentEvidence_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssessmentEvidence" ADD CONSTRAINT "AssessmentEvidence_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, applied with the table rather than afterwards.
--
-- A table added without a policy is readable by every tenant, and that failure is
-- silent: nothing breaks, the rows are simply visible to the wrong funder. The
-- programme is reached through the assessment, which reaches it through the
-- participant's cohort - the same path Assessment's own policy takes.
ALTER TABLE "AssessmentEvidence" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AssessmentEvidence";

CREATE POLICY tenant_isolation ON "AssessmentEvidence" FOR ALL
  USING (EXISTS (
    SELECT 1 FROM "Assessment" a
    JOIN "InnovatorProfile" i ON i.id = a."innovatorId"
    JOIN "Cohort" c ON c.id = i."cohortId"
    WHERE a.id = "assessmentId" AND c."programmeId" = app_current_programme()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Assessment" a
    JOIN "InnovatorProfile" i ON i.id = a."innovatorId"
    JOIN "Cohort" c ON c.id = i."cohortId"
    WHERE a.id = "assessmentId" AND c."programmeId" = app_current_programme()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "AssessmentEvidence" TO innovalanga_app;
