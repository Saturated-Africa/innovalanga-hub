-- Let a user be created through the ORM at all.
--
-- The previous migration fixed WITH CHECK and the insert still failed. The cause
-- was the other half of the policy, and it took a bisection to find: an identical
-- INSERT is allowed without RETURNING and refused with it.
--
--   INSERT ... ;              -- allowed
--   INSERT ... RETURNING id;  -- "new row violates row-level security policy"
--
-- For INSERT ... RETURNING, PostgreSQL applies the SELECT policy to the new row
-- as well - the statement reads back what it wrote. The USING expression was
-- app_user_in_scope("id"), which answers the question by selecting from "User"
-- looking for that id. The row is not visible to that STABLE function inside the
-- statement that is creating it, so the read-back failed and the whole insert was
-- refused with the WITH CHECK wording, which sent the search in the wrong
-- direction.
--
-- Prisma always writes RETURNING. So no user could be created on the tenant
-- connection by any route - not beneficiary acceptance, and not the admin
-- "add an innovator" screen, which does the same thing and was equally broken.
-- Nothing noticed because the only other path that creates users, registration,
-- runs on the owning connection, which bypasses policies entirely.
--
-- The fix is to ask the row, not the table. This expresses exactly what
-- app_user_in_scope meant - your programme's users, plus platform administrators,
-- who have no programme and are visible to everyone because their account is what
-- signs work off - while being evaluable against a row that is still being
-- written. It is also cheaper: no correlated subquery per row.
--
-- app_user_in_scope is left in place. Other policies use it about users on tables
-- that are not "User", where a fresh-row read-back cannot arise.
DROP POLICY IF EXISTS tenant_isolation ON "User";

CREATE POLICY tenant_isolation ON "User" FOR ALL
  USING ("programmeId" = app_current_programme() OR "programmeId" IS NULL)
  WITH CHECK ("programmeId" = app_current_programme());
