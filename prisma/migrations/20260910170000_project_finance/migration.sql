-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('Personnel', 'Operational', 'CapitalEquipment', 'Consumables');

-- CreateEnum
CREATE TYPE "ProofKind" AS ENUM ('Invoice', 'ProofOfPayment', 'BankStatement', 'Other');

-- CreateEnum
CREATE TYPE "ReportingPeriodStatus" AS ENUM ('Open', 'Submitted', 'Accepted');

-- CreateTable
CREATE TABLE "FinanceProject" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "agreementNumber" TEXT,
    "totalFunding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "milestone" TEXT,
    "workPackage" TEXT,
    "objective" TEXT,
    "code" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "deliverable" TEXT,
    "deliverableFormat" TEXT,
    "startMonth" INTEGER,
    "endMonth" INTEGER,
    "duration" TEXT,
    "costCategory" "CostCategory" NOT NULL DEFAULT 'Operational',
    "budgetQ1" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetQ2" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetQ3" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "budgetQ4" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportingPeriod" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "ReportingPeriodStatus" NOT NULL DEFAULT 'Open',
    "amountTransferred" DECIMAL(14,2),
    "bankBalance" DECIMAL(14,2),
    "balanceBroughtForward" DECIMAL(14,2),
    "invoiceNumber" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceTransaction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "periodId" TEXT,
    "spentOn" DATE NOT NULL,
    "supplier" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "costCategory" "CostCategory" NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceProof" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transactionId" TEXT,
    "kind" "ProofKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodIncome" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PeriodIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodVarianceNote" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "activityId" TEXT,
    "reason" TEXT NOT NULL,
    "comment" TEXT,

    CONSTRAINT "PeriodVarianceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinanceProject_programmeId_idx" ON "FinanceProject"("programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectActivity_projectId_code_key" ON "ProjectActivity"("projectId", "code");

-- CreateIndex
CREATE INDEX "ProjectActivity_projectId_costCategory_idx" ON "ProjectActivity"("projectId", "costCategory");

-- CreateIndex
CREATE UNIQUE INDEX "ReportingPeriod_projectId_label_key" ON "ReportingPeriod"("projectId", "label");

-- CreateIndex
CREATE INDEX "FinanceTransaction_projectId_spentOn_idx" ON "FinanceTransaction"("projectId", "spentOn");

-- CreateIndex
CREATE INDEX "FinanceTransaction_periodId_idx" ON "FinanceTransaction"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceProof_shareToken_key" ON "FinanceProof"("shareToken");

-- CreateIndex
CREATE INDEX "FinanceProof_projectId_kind_idx" ON "FinanceProof"("projectId", "kind");

-- CreateIndex
CREATE INDEX "PeriodIncome_periodId_idx" ON "PeriodIncome"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodVarianceNote_periodId_activityId_key" ON "PeriodVarianceNote"("periodId", "activityId");

-- AddForeignKey
ALTER TABLE "FinanceProject" ADD CONSTRAINT "FinanceProject_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "Programme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportingPeriod" ADD CONSTRAINT "ReportingPeriod_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ProjectActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FinanceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinanceTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodIncome" ADD CONSTRAINT "PeriodIncome_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodVarianceNote" ADD CONSTRAINT "PeriodVarianceNote_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodVarianceNote" ADD CONSTRAINT "PeriodVarianceNote_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ProjectActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
