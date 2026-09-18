-- Row-level security: the database refuses cross-tenant rows on its own.
--
-- Why this exists
-- ---------------
-- Every API route now scopes its queries, and a test fails the build when a new
-- one does not. That is the first line and it holds today. It holds because
-- people keep writing the scope, which is exactly the thing that stopped
-- happening nine times before.
--
-- This is the second line. If a route is added tomorrow with the where clause
-- missing, Postgres returns nothing rather than another funder's participants.
--
-- The trap this is built around
-- -----------------------------
-- A table owner is not subject to its own policies. The application connected
-- as the same role that ran the migrations, so it owned every table: policies
-- would have been created, would have appeared active in every catalog view,
-- and would have filtered nothing at all. So the first thing here is a second
-- role that owns nothing.
--
--   innovalanga      owns the tables, runs migrations, and serves the handful
--                    of operations that are genuinely platform-wide: signing
--                    in, the scheduled job, and user administration. Its
--                    bypass is the point, not an oversight.
--
--   innovalanga_app  owns nothing and has no BYPASSRLS. Everything that serves
--                    programme data connects as this role.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT used. It would subject the owner
-- to these policies too, and the owner is the connection that has to find a
-- user by email before any programme is known. Sign-in would fail for
-- everybody. The protection FORCE would give - catching an application wired to
-- the owner by mistake - is instead a check at boot that the application's own
-- connection is genuinely filtered, which fails loudly rather than silently.
--
-- How a request is scoped
-- -----------------------
-- The application sets `app.programme_id` inside the transaction that carries
-- each query. Unset, it is NULL, every comparison below is NULL, and no row
-- matches. Fail-closed: a connection that forgets to say who it is sees an
-- empty database rather than all of it.

/* ------------------------------------------------------------------ *
 * The application role.
 *
 * Created without a password here, and without LOGIN. The deploy script
 * generates a password on the instance and grants LOGIN, so no credential ever
 * lives in a migration file, in version control, or in a terminal.
 * ------------------------------------------------------------------ */
DO $ROLE$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'innovalanga_app') THEN
    CREATE ROLE innovalanga_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$ROLE$;

-- Never granted: BYPASSRLS, CREATEDB, CREATEROLE, SUPERUSER, or ownership of
-- anything. The role can read and write rows its policies allow, and nothing
-- else. It cannot alter a table to turn its own policies off.
GRANT USAGE ON SCHEMA public TO innovalanga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO innovalanga_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO innovalanga_app;

-- Tables added by later migrations are covered without anyone remembering to
-- come back here.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO innovalanga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO innovalanga_app;

/* ------------------------------------------------------------------ *
 * Scope helpers.
 *
 * Most tables carry no programme of their own and reach one through a cohort,
 * a participant, a mentor's account or a finance project. Writing those joins
 * into thirty-odd policies would mean thirty chances to write one wrongly, so
 * each path is defined once here.
 *
 * SECURITY DEFINER, with a fixed search_path. These run as the owner, so the
 * policy on a table does not trigger the policy on the table it looks through -
 * which would otherwise be a second, invisible layer of filtering that has to
 * agree with the first. Each returns nothing but a boolean about scope, so
 * running them as the owner discloses nothing the caller could not already ask.
 * ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION app_current_programme() RETURNS text
  LANGUAGE sql STABLE
  AS $FN$ SELECT NULLIF(current_setting('app.programme_id', true), '') $FN$;

CREATE OR REPLACE FUNCTION app_user_in_scope(uid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    -- A user with no programme is a platform-wide administrator. Visible to
    -- every tenant, because their account is what signs the work off.
    SELECT EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = uid
        AND (u."programmeId" = app_current_programme() OR u."programmeId" IS NULL)
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_innovator_in_scope(iid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "InnovatorProfile" i
      JOIN "Cohort" c ON c.id = i."cohortId"
      WHERE i.id = iid AND c."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_mentor_in_scope(mid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "MentorProfile" m
      JOIN "User" u ON u.id = m."userId"
      WHERE m.id = mid AND u."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_booking_in_scope(bid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "Booking" b
      JOIN "InnovatorProfile" i ON i.id = b."innovatorId"
      JOIN "Cohort" c ON c.id = i."cohortId"
      WHERE b.id = bid AND c."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_project_in_scope(pid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "FinanceProject" p
      WHERE p.id = pid AND p."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_period_in_scope(rid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "ReportingPeriod" r
      JOIN "FinanceProject" p ON p.id = r."projectId"
      WHERE r.id = rid AND p."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_transaction_in_scope(tid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "FinanceTransaction" t
      JOIN "FinanceProject" p ON p.id = t."projectId"
      WHERE t.id = tid AND p."programmeId" = app_current_programme()
    )
  $FN$;

CREATE OR REPLACE FUNCTION app_stipend_in_scope(sid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "StipendRecord" s
      WHERE s.id = sid AND app_innovator_in_scope(s."innovatorId")
    )
  $FN$;


/* ------------------------------------------------------------------ *
 * Policies.
 *
 * One policy per table, covering every verb. USING filters what can be read,
 * updated or deleted; WITH CHECK filters what can be written, so a row cannot
 * be inserted into, or moved into, a programme the caller is not on.
 * ------------------------------------------------------------------ */

-- The tenant boundary itself.
ALTER TABLE "Programme" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Programme";
CREATE POLICY tenant_isolation ON "Programme" FOR ALL
  USING ("id" = app_current_programme())
  WITH CHECK ("id" = app_current_programme());

ALTER TABLE "Region" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Region";
CREATE POLICY tenant_isolation ON "Region" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "Cohort" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Cohort";
CREATE POLICY tenant_isolation ON "Cohort" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "AssessmentPeriodDef" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AssessmentPeriodDef";
CREATE POLICY tenant_isolation ON "AssessmentPeriodDef" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "ReadinessDimension" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReadinessDimension";
CREATE POLICY tenant_isolation ON "ReadinessDimension" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "Indicator" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Indicator";
CREATE POLICY tenant_isolation ON "Indicator" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "LogFrameItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LogFrameItem";
CREATE POLICY tenant_isolation ON "LogFrameItem" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "TheoryOfChange" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TheoryOfChange";
CREATE POLICY tenant_isolation ON "TheoryOfChange" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "MilestoneTracker" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MilestoneTracker";
CREATE POLICY tenant_isolation ON "MilestoneTracker" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "BeneficiaryCount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BeneficiaryCount";
CREATE POLICY tenant_isolation ON "BeneficiaryCount" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "BeneficiaryRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BeneficiaryRecord";
CREATE POLICY tenant_isolation ON "BeneficiaryRecord" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

ALTER TABLE "FinanceProject" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinanceProject";
CREATE POLICY tenant_isolation ON "FinanceProject" FOR ALL
  USING ("programmeId" = app_current_programme())
  WITH CHECK ("programmeId" = app_current_programme());

-- A user with no programme is a platform-wide administrator, visible to every tenant.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User" FOR ALL
  USING (app_user_in_scope("id"))
  WITH CHECK (app_user_in_scope("id"));

-- Belongs to a programme through its cohort.
ALTER TABLE "InnovatorProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InnovatorProfile";
CREATE POLICY tenant_isolation ON "InnovatorProfile" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Cohort" c WHERE c.id = "cohortId" AND c."programmeId" = app_current_programme()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Cohort" c WHERE c.id = "cohortId" AND c."programmeId" = app_current_programme()));

ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Assessment";
CREATE POLICY tenant_isolation ON "Assessment" FOR ALL
  USING (app_innovator_in_scope("innovatorId"))
  WITH CHECK (app_innovator_in_scope("innovatorId"));

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Document";
CREATE POLICY tenant_isolation ON "Document" FOR ALL
  USING (app_innovator_in_scope("innovatorId"))
  WITH CHECK (app_innovator_in_scope("innovatorId"));

ALTER TABLE "IPAssessment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IPAssessment";
CREATE POLICY tenant_isolation ON "IPAssessment" FOR ALL
  USING (app_innovator_in_scope("innovatorId"))
  WITH CHECK (app_innovator_in_scope("innovatorId"));

ALTER TABLE "StipendRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StipendRecord";
CREATE POLICY tenant_isolation ON "StipendRecord" FOR ALL
  USING (app_innovator_in_scope("innovatorId"))
  WITH CHECK (app_innovator_in_scope("innovatorId"));

ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Booking";
CREATE POLICY tenant_isolation ON "Booking" FOR ALL
  USING (app_innovator_in_scope("innovatorId"))
  WITH CHECK (app_innovator_in_scope("innovatorId"));

-- An entry with no participant records a platform-level action and belongs to no single tenant.
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog" FOR ALL
  USING ("innovatorId" IS NULL OR app_innovator_in_scope("innovatorId"))
  WITH CHECK ("innovatorId" IS NULL OR app_innovator_in_scope("innovatorId"));

ALTER TABLE "MentorshipLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MentorshipLog";
CREATE POLICY tenant_isolation ON "MentorshipLog" FOR ALL
  USING (app_booking_in_scope("bookingId"))
  WITH CHECK (app_booking_in_scope("bookingId"));

-- Mentors carry no programme; the assignment is on their account.
ALTER TABLE "MentorProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MentorProfile";
CREATE POLICY tenant_isolation ON "MentorProfile" FOR ALL
  USING (app_user_in_scope("userId"))
  WITH CHECK (app_user_in_scope("userId"));

ALTER TABLE "MentorAvailability" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MentorAvailability";
CREATE POLICY tenant_isolation ON "MentorAvailability" FOR ALL
  USING (app_mentor_in_scope("mentorId"))
  WITH CHECK (app_mentor_in_scope("mentorId"));

ALTER TABLE "MentorDateOverride" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MentorDateOverride";
CREATE POLICY tenant_isolation ON "MentorDateOverride" FOR ALL
  USING (app_mentor_in_scope("mentorId"))
  WITH CHECK (app_mentor_in_scope("mentorId"));

ALTER TABLE "BlackoutPeriod" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BlackoutPeriod";
CREATE POLICY tenant_isolation ON "BlackoutPeriod" FOR ALL
  USING (app_mentor_in_scope("mentorId"))
  WITH CHECK (app_mentor_in_scope("mentorId"));

ALTER TABLE "EventType" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "EventType";
CREATE POLICY tenant_isolation ON "EventType" FOR ALL
  USING (app_mentor_in_scope("mentorId"))
  WITH CHECK (app_mentor_in_scope("mentorId"));

ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Notification";
CREATE POLICY tenant_isolation ON "Notification" FOR ALL
  USING (app_user_in_scope("userId"))
  WITH CHECK (app_user_in_scope("userId"));

-- Auth plumbing. Read by the owner connection at sign-in, before a programme is known.
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Account";
CREATE POLICY tenant_isolation ON "Account" FOR ALL
  USING (app_user_in_scope("userId"))
  WITH CHECK (app_user_in_scope("userId"));

-- Auth plumbing, as above.
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Session";
CREATE POLICY tenant_isolation ON "Session" FOR ALL
  USING (app_user_in_scope("userId"))
  WITH CHECK (app_user_in_scope("userId"));

ALTER TABLE "ProjectActivity" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProjectActivity";
CREATE POLICY tenant_isolation ON "ProjectActivity" FOR ALL
  USING (app_project_in_scope("projectId"))
  WITH CHECK (app_project_in_scope("projectId"));

ALTER TABLE "FinanceTransaction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinanceTransaction";
CREATE POLICY tenant_isolation ON "FinanceTransaction" FOR ALL
  USING (app_project_in_scope("projectId"))
  WITH CHECK (app_project_in_scope("projectId"));

ALTER TABLE "ReportingPeriod" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReportingPeriod";
CREATE POLICY tenant_isolation ON "ReportingPeriod" FOR ALL
  USING (app_project_in_scope("projectId"))
  WITH CHECK (app_project_in_scope("projectId"));

ALTER TABLE "PeriodIncome" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PeriodIncome";
CREATE POLICY tenant_isolation ON "PeriodIncome" FOR ALL
  USING (app_period_in_scope("periodId"))
  WITH CHECK (app_period_in_scope("periodId"));

ALTER TABLE "PeriodVarianceNote" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PeriodVarianceNote";
CREATE POLICY tenant_isolation ON "PeriodVarianceNote" FOR ALL
  USING (app_period_in_scope("periodId"))
  WITH CHECK (app_period_in_scope("periodId"));

-- Evidence hangs off a project, a transaction or a stipend, one of which is always set.
ALTER TABLE "FinanceProof" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinanceProof";
CREATE POLICY tenant_isolation ON "FinanceProof" FOR ALL
  USING (("projectId" IS NOT NULL AND app_project_in_scope("projectId"))
      OR ("transactionId" IS NOT NULL AND app_transaction_in_scope("transactionId"))
      OR ("stipendRecordId" IS NOT NULL AND app_stipend_in_scope("stipendRecordId")))
  WITH CHECK (("projectId" IS NOT NULL AND app_project_in_scope("projectId"))
      OR ("transactionId" IS NOT NULL AND app_transaction_in_scope("transactionId"))
      OR ("stipendRecordId" IS NOT NULL AND app_stipend_in_scope("stipendRecordId")));

ALTER TABLE "IndicatorRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "IndicatorRecord";
CREATE POLICY tenant_isolation ON "IndicatorRecord" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Indicator" i WHERE i.id = "indicatorId" AND i."programmeId" = app_current_programme()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Indicator" i WHERE i.id = "indicatorId" AND i."programmeId" = app_current_programme()));


/* ------------------------------------------------------------------ *
 * Verification tokens.
 *
 * Part of sign-in, tied to an email address rather than to any programme. RLS
 * is enabled with no policy at all, which denies every row to the application
 * role; the owner connection that handles authentication is unaffected. Enabled
 * rather than left open so a future reader can see the decision was made.
 * ------------------------------------------------------------------ */
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
