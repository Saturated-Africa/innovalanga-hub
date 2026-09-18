-- Money and hours move from floating point to fixed point.
--
-- Floating point addition does not associate: the same set of stipend records
-- totals differently depending on the order it is summed, and a figure meant to
-- reconcile against a bank statement lands a fraction of a cent away. These
-- amounts are now reported to a funder alongside project expenditure that is
-- already decimal, so the two would disagree at the cent.
--
-- USING makes the conversion explicit. Existing values are exact to two places
-- already, so nothing is lost; rounding here is defensive rather than expected.
ALTER TABLE "StipendRecord"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2),
  ALTER COLUMN "amount" SET DEFAULT 1000,
  ALTER COLUMN "hoursCompleted" TYPE DECIMAL(8,2) USING ROUND("hoursCompleted"::numeric, 2),
  ALTER COLUMN "hoursCompleted" SET DEFAULT 0;

ALTER TABLE "Programme"
  ALTER COLUMN "defaultStipendAmount" TYPE DECIMAL(14,2) USING ROUND("defaultStipendAmount"::numeric, 2),
  ALTER COLUMN "defaultStipendAmount" SET DEFAULT 1000;
