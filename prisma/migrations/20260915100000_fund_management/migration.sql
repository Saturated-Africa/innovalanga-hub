-- Fund management.
--
-- Three layers: a funder's capital, how much of it each programme may draw on,
-- and the awards made to participants from it.
--
-- The tenancy of these tables is not uniform, and the difference is deliberate.
-- A fund sits ABOVE programmes - one fund backs several, and a programme can be
-- co-funded - so funds, funders and receipts are administered at platform level
-- by the fund manager, the way user accounts are. Allocations and grants belong
-- to a programme and are scoped like every other participant record.

CREATE TYPE "FundStatus" AS ENUM ('Draft', 'Active', 'Closed');
CREATE TYPE "ManagementFeeBasis" AS ENUM ('Commitment', 'Disbursement');
CREATE TYPE "GrantStatus" AS ENUM ('Draft', 'Approved', 'Active', 'Suspended', 'Completed', 'Cancelled');
CREATE TYPE "TrancheStatus" AS ENUM ('Pending', 'Approved', 'Paid', 'Withheld', 'Cancelled');
CREATE TYPE "ExpenditureStatus" AS ENUM ('Submitted', 'Accepted', 'Queried', 'Rejected');
CREATE TYPE "EntityType" AS ENUM ('PtyLtd', 'NPC', 'CloseCorporation', 'SoleProprietor', 'Trust', 'Cooperative', 'Other');

CREATE TABLE "Funder" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortName" TEXT,
  "registrationNumber" TEXT,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Funder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Funder_name_key" ON "Funder"("name");

CREATE TABLE "Fund" (
  "id" TEXT NOT NULL,
  "funderId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reference" TEXT,
  "committedAmount" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'ZAR',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "FundStatus" NOT NULL DEFAULT 'Draft',
  "managementFeeRate" DECIMAL(6,4),
  "managementFeeBasis" "ManagementFeeBasis",
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Fund_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Fund_funderId_idx" ON "Fund"("funderId");

-- A fee rate is a rate, not a percentage. Nothing sensible is above 100%, and
-- a negative fee is somebody paying the funder to hold their money.
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_fee_rate_sane"
  CHECK ("managementFeeRate" IS NULL OR ("managementFeeRate" >= 0 AND "managementFeeRate" <= 1));
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_dates_ordered" CHECK ("endDate" >= "startDate");
ALTER TABLE "Fund" ADD CONSTRAINT "Fund_commitment_not_negative" CHECK ("committedAmount" >= 0);

CREATE TABLE "FundReceipt" (
  "id" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "receivedOn" DATE NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FundReceipt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FundReceipt_fundId_receivedOn_idx" ON "FundReceipt"("fundId", "receivedOn");
-- A receipt may be negative: funders do claw money back, and recording that as
-- a negative receipt keeps one running total rather than two that must agree.
ALTER TABLE "FundReceipt" ADD CONSTRAINT "FundReceipt_amount_not_zero" CHECK ("amount" <> 0);

CREATE TABLE "FundAllocation" (
  "id" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FundAllocation_fundId_programmeId_key" ON "FundAllocation"("fundId", "programmeId");
CREATE INDEX "FundAllocation_programmeId_idx" ON "FundAllocation"("programmeId");
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_amount_not_negative" CHECK ("amount" >= 0);

CREATE TABLE "Grant" (
  "id" TEXT NOT NULL,
  "programmeId" TEXT NOT NULL,
  "fundId" TEXT NOT NULL,
  "innovatorId" TEXT NOT NULL,
  "entityName" TEXT NOT NULL,
  "entityType" "EntityType" NOT NULL DEFAULT 'PtyLtd',
  "entityRegistrationNumber" TEXT,
  "reference" TEXT,
  "purpose" TEXT NOT NULL,
  "awardedAmount" DECIMAL(14,2) NOT NULL,
  "status" "GrantStatus" NOT NULL DEFAULT 'Draft',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "agreementSignedAt" TIMESTAMP(3),
  "startDate" DATE,
  "endDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Grant_programmeId_status_idx" ON "Grant"("programmeId", "status");
CREATE INDEX "Grant_fundId_idx" ON "Grant"("fundId");
CREATE INDEX "Grant_innovatorId_idx" ON "Grant"("innovatorId");
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_award_positive" CHECK ("awardedAmount" > 0);

CREATE TABLE "GrantTranche" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "plannedDate" DATE,
  "conditions" TEXT,
  "status" "TrancheStatus" NOT NULL DEFAULT 'Pending',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "withheldReason" TEXT,
  "paidOn" DATE,
  "paymentReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrantTranche_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GrantTranche_grantId_sequence_key" ON "GrantTranche"("grantId", "sequence");
CREATE INDEX "GrantTranche_grantId_status_idx" ON "GrantTranche"("grantId", "status");
ALTER TABLE "GrantTranche" ADD CONSTRAINT "GrantTranche_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "GrantTranche" ADD CONSTRAINT "GrantTranche_sequence_positive" CHECK ("sequence" > 0);
-- A paid tranche has a date. Without this, "paid" can be asserted with no
-- record of when the money moved, which is the first thing an auditor asks.
ALTER TABLE "GrantTranche" ADD CONSTRAINT "GrantTranche_paid_has_date"
  CHECK ("status" <> 'Paid' OR "paidOn" IS NOT NULL);
-- Withholding a payment requires a reason. It is a decision taken about
-- somebody's money and it has to be explicable later.
ALTER TABLE "GrantTranche" ADD CONSTRAINT "GrantTranche_withheld_has_reason"
  CHECK ("status" <> 'Withheld' OR ("withheldReason" IS NOT NULL AND length(btrim("withheldReason")) > 0));

CREATE TABLE "GrantExpenditure" (
  "id" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "trancheId" TEXT,
  "spentOn" DATE NOT NULL,
  "supplier" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "category" "CostCategory" NOT NULL DEFAULT 'Operational',
  "status" "ExpenditureStatus" NOT NULL DEFAULT 'Submitted',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "submittedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrantExpenditure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GrantExpenditure_grantId_status_idx" ON "GrantExpenditure"("grantId", "status");
ALTER TABLE "GrantExpenditure" ADD CONSTRAINT "GrantExpenditure_amount_positive" CHECK ("amount" > 0);
-- A rejection or a query is a message to the participant about their own
-- money. It needs to say something.
ALTER TABLE "GrantExpenditure" ADD CONSTRAINT "GrantExpenditure_adverse_has_note"
  CHECK ("status" NOT IN ('Queried', 'Rejected') OR ("reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0));

-- Evidence for grant payments and grant spend joins the existing proof table
-- rather than starting a second upload pipeline that would miss half the
-- checks the first one has.
ALTER TABLE "FinanceProof" ADD COLUMN "grantTrancheId" TEXT;
ALTER TABLE "FinanceProof" ADD COLUMN "grantExpenditureId" TEXT;
CREATE INDEX "FinanceProof_grantTrancheId_idx" ON "FinanceProof"("grantTrancheId");
CREATE INDEX "FinanceProof_grantExpenditureId_idx" ON "FinanceProof"("grantExpenditureId");

ALTER TABLE "Fund" ADD CONSTRAINT "Fund_funderId_fkey"
  FOREIGN KEY ("funderId") REFERENCES "Funder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FundReceipt" ADD CONSTRAINT "FundReceipt_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FundAllocation" ADD CONSTRAINT "FundAllocation_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_programmeId_fkey"
  FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_fundId_fkey"
  FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_innovatorId_fkey"
  FOREIGN KEY ("innovatorId") REFERENCES "InnovatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrantTranche" ADD CONSTRAINT "GrantTranche_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrantExpenditure" ADD CONSTRAINT "GrantExpenditure_grantId_fkey"
  FOREIGN KEY ("grantId") REFERENCES "Grant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_grantTrancheId_fkey"
  FOREIGN KEY ("grantTrancheId") REFERENCES "GrantTranche"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_grantExpenditureId_fkey"
  FOREIGN KEY ("grantExpenditureId") REFERENCES "GrantExpenditure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, applied as these tables are created rather than later.
--
-- A table added without a policy is readable by every tenant, and that is a
-- silent failure: nothing breaks, the data is simply visible to the wrong
-- funder. lib/tenant-db.test.ts and infra/rls-verify.sh both exist because of
-- how easily that goes unnoticed.
--
-- Funder, Fund and FundReceipt carry no programme. They are platform-level, so
-- the application role is denied them outright and the fund manager reaches
-- them on the owning connection, exactly as it does user administration.
ALTER TABLE "Funder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Fund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FundReceipt" ENABLE ROW LEVEL SECURITY;

-- An allocation names a programme, so a programme may see what it has been
-- allocated - and nothing about the fund's other commitments.
ALTER TABLE "FundAllocation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FundAllocation";
CREATE POLICY tenant_isolation ON "FundAllocation" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "Grant" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Grant";
CREATE POLICY tenant_isolation ON "Grant" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

CREATE OR REPLACE FUNCTION app_grant_in_scope(gid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "Grant" g
      WHERE g.id = gid AND g."programmeId" = app_current_programme()
    )
  $FN$;

ALTER TABLE "GrantTranche" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GrantTranche";
CREATE POLICY tenant_isolation ON "GrantTranche" FOR ALL
  USING (app_grant_in_scope("grantId"))
  WITH CHECK (app_grant_in_scope("grantId"));

ALTER TABLE "GrantExpenditure" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GrantExpenditure";
CREATE POLICY tenant_isolation ON "GrantExpenditure" FOR ALL
  USING (app_grant_in_scope("grantId"))
  WITH CHECK (app_grant_in_scope("grantId"));

-- The evidence policy has to learn about the two new owners, or a proof
-- attached to a grant payment would belong to none of the cases it lists and
-- be invisible to everyone.
CREATE OR REPLACE FUNCTION app_tranche_in_scope(tid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "GrantTranche" t WHERE t.id = tid AND app_grant_in_scope(t."grantId")
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_expenditure_in_scope(eid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "GrantExpenditure" e WHERE e.id = eid AND app_grant_in_scope(e."grantId")
    )
  $FN$;

DROP POLICY IF EXISTS tenant_isolation ON "FinanceProof";
CREATE POLICY tenant_isolation ON "FinanceProof" FOR ALL
  USING (
    ("projectId" IS NOT NULL AND app_project_in_scope("projectId"))
    OR ("transactionId" IS NOT NULL AND app_transaction_in_scope("transactionId"))
    OR ("stipendRecordId" IS NOT NULL AND app_stipend_in_scope("stipendRecordId"))
    OR ("grantTrancheId" IS NOT NULL AND app_tranche_in_scope("grantTrancheId"))
    OR ("grantExpenditureId" IS NOT NULL AND app_expenditure_in_scope("grantExpenditureId"))
  )
  WITH CHECK (
    ("projectId" IS NOT NULL AND app_project_in_scope("projectId"))
    OR ("transactionId" IS NOT NULL AND app_transaction_in_scope("transactionId"))
    OR ("stipendRecordId" IS NOT NULL AND app_stipend_in_scope("stipendRecordId"))
    OR ("grantTrancheId" IS NOT NULL AND app_tranche_in_scope("grantTrancheId"))
    OR ("grantExpenditureId" IS NOT NULL AND app_expenditure_in_scope("grantExpenditureId"))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "Funder", "Fund", "FundReceipt",
  "FundAllocation", "Grant", "GrantTranche", "GrantExpenditure" TO innovalanga_app;
