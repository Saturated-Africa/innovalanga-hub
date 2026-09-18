-- Let a proof belong to a grant tranche or a reported expense.
--
-- The fund migration added "grantTrancheId" and "grantExpenditureId" to
-- FinanceProof, gave them foreign keys, indexed them, and extended the
-- row-level security policy to cover them. It did not touch this constraint,
-- which still permitted only a project or a stipend record.
--
-- So a proof attached to a reported expense had both of those null and was
-- rejected outright. The columns existed, the policy allowed them, and the
-- insert could never succeed - which is the quietest kind of half-finished
-- change, because everything reads as present until something tries to use it.
--
-- Rewritten as a count rather than a chain of ORs. The previous form needed a
-- new pair of clauses for every owner added and had already been missed once;
-- this one is correct for any number of them and says "exactly one" in the
-- shape of the expression rather than in a comment.
--
-- "transactionId" is deliberately not counted. A project proof may also name
-- the transaction it evidences, so it is a refinement of an owner rather than
-- an owner of its own, and counting it would reject every transaction proof
-- ever filed.
ALTER TABLE "FinanceProof" DROP CONSTRAINT IF EXISTS "FinanceProof_has_one_owner";

ALTER TABLE "FinanceProof" ADD CONSTRAINT "FinanceProof_has_one_owner"
  CHECK (
    (("projectId" IS NOT NULL)::int
      + ("stipendRecordId" IS NOT NULL)::int
      + ("grantTrancheId" IS NOT NULL)::int
      + ("grantExpenditureId" IS NOT NULL)::int) = 1
  );
