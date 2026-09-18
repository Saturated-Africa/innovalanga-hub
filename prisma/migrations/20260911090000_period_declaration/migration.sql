-- Figures the quarterly sheet asks for that had nowhere to live in the platform.
--
-- Without these the exporter leaves the template's own values in place, which
-- means the previous submitter's name and date go out on this institution's
-- declaration. Nullable because a period is created before any of them is known.
ALTER TABLE "ReportingPeriod"
  ADD COLUMN "fundingBudgeted" DECIMAL(14,2),
  ADD COLUMN "preparedByName" TEXT,
  ADD COLUMN "preparedOn" DATE,
  ADD COLUMN "approvedByName" TEXT,
  ADD COLUMN "approvedOn" DATE;
