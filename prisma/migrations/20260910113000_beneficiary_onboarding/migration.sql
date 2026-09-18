-- CreateEnum
CREATE TYPE "BeneficiaryTitle" AS ENUM ('Mr', 'Ms', 'Mrs', 'Other');

-- CreateEnum
CREATE TYPE "BeneficiaryGender" AS ENUM ('Male', 'Female');

-- CreateEnum
CREATE TYPE "BeneficiaryRace" AS ENUM ('Black', 'White', 'Other');

-- CreateEnum
CREATE TYPE "BeneficiaryFormStatus" AS ENUM ('Draft', 'AwaitingAcceptance', 'Accepted', 'Withdrawn');

-- CreateTable
CREATE TABLE "BeneficiaryRecord" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "cohortId" TEXT,
    "innovatorId" TEXT,
    "fullName" TEXT NOT NULL,
    "idNumberEncrypted" TEXT,
    "gender" "BeneficiaryGender",
    "hasDisability" BOOLEAN,
    "race" "BeneficiaryRace",
    "raceOther" TEXT,
    "title" "BeneficiaryTitle",
    "titleOther" TEXT,
    "physicalAddress" TEXT,
    "cellphone" TEXT,
    "localMunicipality" TEXT,
    "alternativeNumber" TEXT,
    "districtMunicipality" TEXT,
    "email" TEXT NOT NULL,
    "province" TEXT,
    "hasInnovativeIdea" BOOLEAN,
    "conceptDescription" TEXT,
    "projectTitle" TEXT,
    "developmentStage" TEXT,
    "sector" TEXT,
    "supportRequired" TEXT,
    "otherInformation" TEXT,
    "beneficiarySignedName" TEXT,
    "beneficiarySignedAt" TIMESTAMP(3),
    "beneficiarySignedIp" TEXT,
    "beneficiarySignedUa" TEXT,
    "beneficiarySignatureImage" TEXT,
    "beneficiarySignedHash" TEXT,
    "acceptedByName" TEXT,
    "acceptedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedIp" TEXT,
    "acceptedUa" TEXT,
    "acceptanceSignatureImage" TEXT,
    "status" "BeneficiaryFormStatus" NOT NULL DEFAULT 'Draft',
    "withdrawnReason" TEXT,
    "capturedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeneficiaryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BeneficiaryRecord_innovatorId_key" ON "BeneficiaryRecord"("innovatorId");

-- CreateIndex
CREATE INDEX "BeneficiaryRecord_programmeId_status_idx" ON "BeneficiaryRecord"("programmeId", "status");

-- AddForeignKey
ALTER TABLE "BeneficiaryRecord" ADD CONSTRAINT "BeneficiaryRecord_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryRecord" ADD CONSTRAINT "BeneficiaryRecord_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeneficiaryRecord" ADD CONSTRAINT "BeneficiaryRecord_innovatorId_fkey" FOREIGN KEY ("innovatorId") REFERENCES "InnovatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
