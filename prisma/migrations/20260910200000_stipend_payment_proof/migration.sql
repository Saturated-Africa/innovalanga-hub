-- Evidence can now belong to a stipend payment as well as a project
-- transaction, so the project link becomes optional.
ALTER TABLE "FinanceProof" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "FinanceProof" ADD COLUMN "stipendRecordId" TEXT;

-- Recording who marked a stipend paid, and against what bank reference. This
-- is deliberately separate from paidAt, which is when the money moved rather
-- than when somebody typed it in.
ALTER TABLE "StipendRecord" ADD COLUMN "paidRecordedBy" TEXT;
ALTER TABLE "StipendRecord" ADD COLUMN "paidRecordedAt" TIMESTAMP(3);
ALTER TABLE "StipendRecord" ADD COLUMN "paymentReference" TEXT;

-- CreateIndex
CREATE INDEX "FinanceProof_stipendRecordId_idx" ON "FinanceProof"("stipendRecordId");

-- AddForeignKey
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_stipendRecordId_fkey" FOREIGN KEY ("stipendRecordId") REFERENCES "StipendRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner, never neither.
--
-- Prisma cannot express this, so it is enforced here. Without it a proof could
-- be created belonging to nothing at all: still holding a live share token, no
-- longer reachable from any screen, and impossible to revoke through the
-- interface. Orphaned evidence with a working public link is the worst state
-- this table can be in.
ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_has_one_owner"
  CHECK (
    ("projectId" IS NOT NULL AND "stipendRecordId" IS NULL)
    OR ("projectId" IS NULL AND "stipendRecordId" IS NOT NULL)
  );
