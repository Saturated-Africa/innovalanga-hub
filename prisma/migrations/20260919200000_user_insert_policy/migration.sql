-- Let a tenant create a user in its own programme, and stop it writing anybody
-- else's row.
--
-- The old policy used the same predicate for both directions:
--
--   USING      (app_user_in_scope("id"))
--   WITH CHECK (app_user_in_scope("id"))
--
-- That function answers "is there a row with this id in my programme, or with no
-- programme at all" by selecting from "User". Two consequences, both found by
-- accepting a beneficiary form.
--
-- An INSERT could never succeed. WITH CHECK runs against the new row, but the
-- function goes back to the table to look for it, and a STABLE function does not
-- see the row being inserted. So it returned false for every insert, and the
-- database refused it with 42501 - "new row violates row-level security policy".
-- Nothing noticed because the only other code that creates users runs on the
-- owning connection, which bypasses policies.
--
-- And a tenant could write rows it should only be able to read. USING admits
-- platform administrators on purpose - a user with no programme is visible to
-- every tenant, because their account is what signs work off - but reusing that
-- predicate for WITH CHECK extended the same latitude to writes, so one
-- programme could have updated a platform administrator's account.
--
-- The new WITH CHECK states the intent directly against the row being written: a
-- tenant may write users in its own programme and nowhere else. That makes the
-- insert possible, keeps administrators readable, and stops a tenant creating a
-- null-programme account - which would have been an account visible to, and
-- writable by, every other tenant on the platform.
DROP POLICY IF EXISTS tenant_isolation ON "User";

CREATE POLICY tenant_isolation ON "User" FOR ALL
  USING (app_user_in_scope("id"))
  WITH CHECK ("programmeId" = app_current_programme());
