-- Demonstration data for the fund management module.
--
--   docker compose exec -T postgres psql -U innovalanga -d innovalanga < scripts/seed-funds.sql
--
-- Written as SQL rather than TypeScript because the deployed container holds a
-- built application, not the scripts directory, and a seed that cannot be run
-- where the data lives is not a seed.
--
-- Idempotent throughout: fixed ids and ON CONFLICT DO NOTHING, so running it
-- twice changes nothing. Run as the owning role, which bypasses row-level
-- security - there is no session here to resolve a programme from.
--
-- The two grants are deliberately at different stages so the payment gate is
-- visible without having to arrange it by hand: the first has a paid tranche
-- and a payable one behind it, the second has nothing paid so its later
-- tranches are blocked.

BEGIN;

INSERT INTO "Funder" (id, name, "shortName", "contactName", "contactEmail", "createdAt", "updatedAt")
VALUES ('seed-funder-tia', 'Technology Innovation Agency', 'TIA',
        'Programme Officer', 'programmes@tia.org.za', now(), now())
ON CONFLICT (name) DO NOTHING;

INSERT INTO "Fund" (id, "funderId", name, reference, "committedAmount", currency,
                    "startDate", "endDate", status, "managementFeeRate",
                    "managementFeeBasis", notes, "createdAt", "updatedAt")
SELECT 'seed-fund-tia-2026', f.id, 'TIA Seed Fund 2026', 'TIA/2026/SEED/014',
       5000000, 'ZAR', DATE '2026-01-01', DATE '2026-12-31', 'Active',
       -- Seven and a half percent, held as a rate.
       0.0750, 'Commitment',
       'Seed funding for early stage ventures in the Innovalanga programme.',
       now(), now()
FROM "Funder" f WHERE f.name = 'Technology Innovation Agency'
ON CONFLICT (id) DO NOTHING;

INSERT INTO "FundReceipt" (id, "fundId", amount, "receivedOn", reference, "recordedBy", "createdAt")
VALUES
  ('seed-receipt-1', 'seed-fund-tia-2026', 1500000, DATE '2026-02-03', 'TIA TRF 88201', 'Seed', now()),
  ('seed-receipt-2', 'seed-fund-tia-2026',  500000, DATE '2026-06-02', 'TIA TRF 91744', 'Seed', now())
ON CONFLICT (id) DO NOTHING;

-- Allocated to the first programme on the platform.
INSERT INTO "FundAllocation" (id, "fundId", "programmeId", amount, note, "createdAt", "updatedAt")
SELECT 'seed-alloc-1', 'seed-fund-tia-2026', p.id, 2000000, 'First-year allocation.', now(), now()
FROM "Programme" p ORDER BY p."createdAt" LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Two participants, taken in a stable order so re-running picks the same two.
CREATE TEMP TABLE seed_participants ON COMMIT DROP AS
SELECT i.id, row_number() OVER (ORDER BY i."lastName", i.id) AS n
FROM "InnovatorProfile" i
JOIN "Cohort" c ON c.id = i."cohortId"
JOIN "Programme" p ON p.id = c."programmeId"
WHERE p.id = (SELECT id FROM "Programme" ORDER BY "createdAt" LIMIT 1)
LIMIT 2;

INSERT INTO "Grant" (id, "programmeId", "fundId", "innovatorId", "entityName", "entityType",
                     "entityRegistrationNumber", reference, purpose, "awardedAmount", status,
                     "approvedBy", "approvedAt", "agreementSignedAt", "startDate", "endDate",
                     "createdAt", "updatedAt")
SELECT 'seed-grant-1',
       (SELECT id FROM "Programme" ORDER BY "createdAt" LIMIT 1),
       'seed-fund-tia-2026', sp.id,
       'Sisanda Digital Solutions (Pty) Ltd', 'PtyLtd', '2023/447821/07', 'GR-2026-001',
       'Product development and first market deployment of the schools application, including device procurement and teacher training.',
       450000, 'Active', 'Fund Committee', TIMESTAMP '2026-02-20 10:00',
       TIMESTAMP '2026-02-27 10:00', DATE '2026-03-01', DATE '2026-12-31', now(), now()
FROM seed_participants sp WHERE sp.n = 1
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Grant" (id, "programmeId", "fundId", "innovatorId", "entityName", "entityType",
                     "entityRegistrationNumber", reference, purpose, "awardedAmount", status,
                     "approvedBy", "approvedAt", "agreementSignedAt", "startDate", "endDate",
                     "createdAt", "updatedAt")
SELECT 'seed-grant-2',
       (SELECT id FROM "Programme" ORDER BY "createdAt" LIMIT 1),
       'seed-fund-tia-2026', sp.id,
       'Khanya Agritech NPC', 'NPC', '2024/119043/08', 'GR-2026-002',
       'Pilot of the soil sensor network across four cooperative farms.',
       300000, 'Active', 'Fund Committee', TIMESTAMP '2026-02-20 10:00',
       TIMESTAMP '2026-02-27 10:00', DATE '2026-03-01', DATE '2026-12-31', now(), now()
FROM seed_participants sp WHERE sp.n = 2
ON CONFLICT (id) DO NOTHING;

-- First grant: one paid, one approved and therefore payable, one pending.
INSERT INTO "GrantTranche" (id, "grantId", sequence, amount, "plannedDate", conditions, status,
                            "approvedBy", "approvedAt", "paidOn", "paymentReference",
                            "createdAt", "updatedAt")
VALUES
  ('seed-t1-1', 'seed-grant-1', 1, 150000, DATE '2026-03-15', NULL, 'Paid',
   'Fund Committee', TIMESTAMP '2026-03-01 09:00', DATE '2026-03-18', 'EFT 4471', now(), now()),
  ('seed-t1-2', 'seed-grant-1', 2, 180000, DATE '2026-07-15', NULL, 'Approved',
   'Fund Committee', TIMESTAMP '2026-07-01 09:00', NULL, NULL, now(), now()),
  ('seed-t1-3', 'seed-grant-1', 3, 120000, DATE '2026-10-15',
   'Quarterly report accepted and at least three schools onboarded.', 'Pending',
   NULL, NULL, NULL, NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Second grant: nothing paid, so tranches two and three are visibly gated.
INSERT INTO "GrantTranche" (id, "grantId", sequence, amount, "plannedDate", conditions, status,
                            "approvedBy", "approvedAt", "paidOn", "paymentReference",
                            "createdAt", "updatedAt")
VALUES
  ('seed-t2-1', 'seed-grant-2', 1, 120000, DATE '2026-04-01', NULL, 'Approved',
   'Fund Committee', TIMESTAMP '2026-03-20 09:00', NULL, NULL, now(), now()),
  ('seed-t2-2', 'seed-grant-2', 2, 100000, DATE '2026-08-01',
   'Sensors installed and first season of data captured.', 'Pending',
   NULL, NULL, NULL, NULL, now(), now()),
  ('seed-t2-3', 'seed-grant-2', 3,  80000, DATE '2026-11-01', NULL, 'Pending',
   NULL, NULL, NULL, NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

-- Reported spend in three review states, so the accounted-for figure is
-- neither zero nor complete.
INSERT INTO "GrantExpenditure" (id, "grantId", "spentOn", supplier, description, amount,
                                category, status, "reviewedBy", "reviewedAt",
                                "createdAt", "updatedAt")
VALUES
  ('seed-e1', 'seed-grant-1', DATE '2026-03-28', 'Incredible Connection',
   'Twelve tablets for the pilot schools', 71400, 'CapitalEquipment', 'Accepted',
   'Programme Finance', TIMESTAMP '2026-04-04 11:00', now(), now()),
  ('seed-e2', 'seed-grant-1', DATE '2026-04-11', 'Telkom',
   'Connectivity for the pilot sites, six months', 18600, 'Operational', 'Accepted',
   'Programme Finance', TIMESTAMP '2026-04-18 11:00', now(), now()),
  ('seed-e3', 'seed-grant-1', DATE '2026-05-02', 'Freelance Developer',
   'Offline sync feature', 45000, 'Personnel', 'Submitted', NULL, NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT 'fund'        AS item, count(*)::text AS n FROM "Fund"
UNION ALL SELECT 'receipts',    count(*)::text FROM "FundReceipt"
UNION ALL SELECT 'allocations', count(*)::text FROM "FundAllocation"
UNION ALL SELECT 'grants',      count(*)::text FROM "Grant"
UNION ALL SELECT 'tranches',    count(*)::text FROM "GrantTranche"
UNION ALL SELECT 'expenditure', count(*)::text FROM "GrantExpenditure";
