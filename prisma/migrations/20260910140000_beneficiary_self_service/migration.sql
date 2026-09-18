-- The account that fills a form in, when the beneficiary completes it
-- themselves. Null for forms captured by staff on someone's behalf.
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "userId" TEXT;

-- Return for correction. Sending a form back voids the signature, so the
-- reason and the time are kept as part of the trail.
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "returnedAt" TIMESTAMP(3);
ALTER TABLE "BeneficiaryRecord" ADD COLUMN "returnedReason" TEXT;

-- One form per person per programme. Postgres permits repeated NULLs in a
-- unique index, so staff-captured rows without an owner are unaffected.
CREATE UNIQUE INDEX "BeneficiaryRecord_programmeId_userId_key" ON "BeneficiaryRecord"("programmeId", "userId");

-- AddForeignKey
ALTER TABLE "BeneficiaryRecord" ADD CONSTRAINT "BeneficiaryRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
