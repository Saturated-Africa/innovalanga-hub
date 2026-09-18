import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { resolveProgrammeId } from '@/lib/scope'
import { importWorkbook } from '@/lib/finance/import-workbook'
import { persistImport } from '@/lib/finance/persist-import'

/**
 * POST /api/finance/import
 *
 * Upload a funder workbook. Two modes, chosen by the `commit` field:
 *
 *   dry run  - parse and report what would be created, writing nothing
 *   commit   - the same parse, then persisted in one transaction
 *
 * The dry run exists because these files are filled in by hand over a year and
 * an operator should see the problems before deciding, not afterwards.
 */

/** Project accounting is a finance function, not a programme-delivery one. */
const ROLES = ['super_admin']

export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const programmeId = await resolveProgrammeId(session)
  if (!programmeId) return NextResponse.json({ error: 'No programme found' }, { status: 404 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No workbook supplied.' }, { status: 400 })
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: 'Workbook is larger than 25 MB.' }, { status: 413 })
  }

  let parsed
  try {
    parsed = await importWorkbook(await file.arrayBuffer())
  } catch {
    return NextResponse.json(
      { error: 'That file could not be read as an Excel workbook.' },
      { status: 400 }
    )
  }

  const commit = form.get('commit') === 'true'
  if (!commit) {
    // Dry run. The activities and transactions themselves are not returned:
    // the operator needs the shape and the problems, not 170 rows of JSON.
    return NextResponse.json({
      committed: false,
      project: parsed.project,
      // Offered as a starting point for the field the operator fills in, not
      // as the value that will be stored. The workbook's header cell is typed
      // by hand and belongs to whoever last edited the file.
      suggestedInstitutionName: parsed.project.institutionName,
      totals: parsed.totals,
      activityCount: parsed.activities.length,
      problems: parsed.problems,
    })
  }

  const blocking = parsed.problems.filter((p) => p.severity === 'error')
  if (parsed.activities.length === 0 && parsed.transactions.length === 0) {
    return NextResponse.json(
      { error: 'Nothing to import. Check this is the funder template.', problems: blocking },
      { status: 422 }
    )
  }

  const institutionName = String(form.get('institutionName') ?? '').trim()
  if (!institutionName) {
    return NextResponse.json(
      { error: 'Enter the institution name for this report before importing.' },
      { status: 400 }
    )
  }

  const periodLabel = String(form.get('periodLabel') ?? 'Q1')
  const now = new Date()
  const outcome = await persistImport(parsed, {
    programmeId,
    projectId: (form.get('projectId') as string) || null,
    institutionName,
    startDate: new Date(form.get('startDate') as string) || now,
    endDate: new Date(form.get('endDate') as string) || now,
    periodLabel,
    periodStart: new Date(form.get('periodStart') as string) || now,
    periodEnd: new Date(form.get('periodEnd') as string) || now,
  })

  return NextResponse.json({ committed: true, ...outcome, problems: parsed.problems })
}
