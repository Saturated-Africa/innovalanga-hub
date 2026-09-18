-- A programme may see the funds that back it.
--
-- The previous migration denied Fund and Funder to the application role
-- outright, on the reasoning that a fund spans programmes and so belongs to
-- none of them. That was one step too strict. A grant has to name the fund it
-- draws on, and a programme has to know what it has been allocated and by whom,
-- so every grant page failed the moment it joined to the fund for its name.
--
-- The right line is narrower than "all or nothing": a programme sees a fund
-- when it holds an allocation from it, and sees nothing of that fund's other
-- commitments. The allocation rows are already scoped by programme, so what
-- leaks through this policy is the fund's own description - its name, its
-- funder, its dates and terms - and not who else is drawing on it.
--
-- Receipts stay denied. What the funder has actually transferred, and when, is
-- the fund manager's business and answers no question a programme needs to ask.

CREATE OR REPLACE FUNCTION app_fund_backs_current_programme(fid text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $FN$
    SELECT EXISTS (
      SELECT 1 FROM "FundAllocation" a
      WHERE a."fundId" = fid AND a."programmeId" = app_current_programme()
    )
  $FN$;

DROP POLICY IF EXISTS tenant_isolation ON "Fund";
CREATE POLICY tenant_isolation ON "Fund" FOR ALL
  USING (app_fund_backs_current_programme("id"))
  -- A programme cannot create or alter a fund. Only the fund manager does that,
  -- on the owning connection, which is not subject to this policy.
  WITH CHECK (false);

DROP POLICY IF EXISTS tenant_isolation ON "Funder";
CREATE POLICY tenant_isolation ON "Funder" FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Fund" f
      WHERE f."funderId" = "Funder".id AND app_fund_backs_current_programme(f.id)
    )
  )
  WITH CHECK (false);
