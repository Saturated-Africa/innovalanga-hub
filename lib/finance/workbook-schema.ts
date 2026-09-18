/**
 * Where everything lives in the funder's workbook.
 *
 * The template is the contract between this platform and the funder, so its
 * geometry is written down once, here, rather than scattered as magic numbers
 * through an importer and an exporter that then drift apart.
 *
 * If the funder reissues the template, this is the file to change.
 */

export const SHEETS = {
  /** Trailing space is in the funder's file. Do not "fix" it. */
  projectPlan: 'Project Plan ',
  breakdown: 'Breakdown expediture',
  quarterly: 'Quarterly financial',
  projection: 'Next Quarter Projection',
  reconciliation: 'Bank and cash reconciliation',
  accumulated: 'Accumulated financial info',
} as const

/** Project Plan sheet. Header occupies rows 2 to 3; data starts at row 4. */
export const PROJECT_PLAN = {
  firstDataRow: 4,
  col: {
    milestone: 2,
    workPackage: 3,
    objective: 4,
    activityNo: 5,
    details: 6,
    deliverable: 7,
    deliverableFormat: 8,
    startMonth: 9,
    endMonth: 10,
    duration: 11,
    budgetQ1: 12,
    budgetQ2: 13,
    budgetQ3: 14,
    budgetQ4: 15,
    total: 16,
  },
} as const

/** Breakdown of expenditure. Header rows 2 to 3; data starts at row 4. */
export const BREAKDOWN = {
  firstDataRow: 4,
  col: {
    nr: 1,
    date: 2,
    supplier: 3,
    description: 4,
    amount: 5,
    invoiceLink: 6,
    popLink: 7,
    personnel: 8,
    overheads: 9,
    officeAndRent: 10,
    capital1: 11,
    capital2: 12,
  },
} as const

/** Bank and cash reconciliation. A short sheet of labelled values. */
export const RECONCILIATION = {
  institutionRow: 2,
  periodRow: 3,
  agreementPeriodRow: 4,
  agreementNoRow: 5,
  invoiceNoRow: 6,
  transferredRow: 8,
  expensesRow: 9,
  surplusRow: 10,
  bankBalanceRow: 13,
  valueCol: 3,
  labelCol: 1,
} as const

/**
 * Rows that head a cost category on the quarterly sheet.
 *
 * Activities are listed beneath their category, so the importer reads these to
 * decide which category an activity belongs to.
 */
export const COST_CATEGORY_HEADINGS: { match: RegExp; category: string }[] = [
  { match: /^PERSONNEL COSTS/i, category: 'Personnel' },
  { match: /^OPERATIONAL COST/i, category: 'Operational' },
  { match: /^CAPITAL EQUIPMENT/i, category: 'CapitalEquipment' },
  { match: /^CONSUMABLES/i, category: 'Consumables' },
]

/**
 * Which breakdown column each cost category is totalled into.
 *
 * The sheet spreads categories across columns rather than holding one category
 * field, so an export has to put each amount under the right heading.
 */
export const BREAKDOWN_COLUMN_FOR: Record<string, number> = {
  Personnel: BREAKDOWN.col.personnel,
  Operational: BREAKDOWN.col.overheads,
  Consumables: BREAKDOWN.col.officeAndRent,
  CapitalEquipment: BREAKDOWN.col.capital1,
}

/**
 * Every column on the breakdown sheet that can carry a category allocation.
 *
 * Wider than the map above on purpose. `BREAKDOWN_COLUMN_FOR` says where this
 * platform *writes* an allocation; this says where the template might already
 * have one. The funder's sheet uses a second capital equipment column that
 * nothing maps to, and leaving its formulas in place while writing ours put 35
 * transactions under two categories at once.
 *
 * Anything that clears previous data has to use this list, not that map.
 */
export const BREAKDOWN_CATEGORY_COLUMNS: number[] = [
  BREAKDOWN.col.personnel,
  BREAKDOWN.col.overheads,
  BREAKDOWN.col.officeAndRent,
  BREAKDOWN.col.capital1,
  BREAKDOWN.col.capital2,
]

/**
 * Quarterly financial sheet - the funder's actual report.
 *
 * The other sheets are supporting detail; this one is what gets read. It lays
 * out income, then expenditure by cost category, with budget, actual, variance,
 * percentage variance, a written reason and a comment across the columns.
 *
 * Its geometry is unusually rigid, and the rigidity is not ours. Each category
 * subtotal is a fixed range written by the funder - `=SUM(B19:B41)` for
 * personnel, `=SUM(B43:B43)` for operational - and the grand total adds those
 * four cells and nothing else. Because formulas are never rewritten, an
 * activity written outside its category's band is money the sheet will not
 * count. So the bands below are capacities, not suggestions, and an export that
 * cannot fit a category says so rather than writing outside the range.
 */
export const QUARTERLY = {
  col: {
    label: 1,
    budget: 2,
    actual: 3,
    variance: 4,
    percentVariance: 5,
    reason: 6,
    comment: 7,
  },
  income: {
    balanceBroughtForwardRow: 10,
    fundingRow: 11,
    /** "Other Income:", "Interest", "VAT refund", "etc." */
    otherFirstRow: 12,
    otherLastRow: 15,
  },
  declaration: {
    preparedByRow: 208,
    preparedDateRow: 210,
    approvedByRow: 212,
    approvedDateRow: 214,
  },
} as const

/**
 * The band of rows each cost category owns on the quarterly sheet.
 *
 * These are the reissued template's coordinates, not the funder's original.
 * The file TIA supplied was a completed report: its sections were as long as
 * that project happened to need, one row for operational cost among them, and
 * the consumables subtotal was a typed zero that counted nothing beneath it.
 * `scripts/widen-finance-template.ts` lengthens the sections and gives
 * consumables a working sum, without changing what any formula means. The file
 * as issued is kept beside the template it produced.
 *
 * `subtotalIsFormula` stays in the shape because a reissued template is still a
 * file somebody can replace, and a section whose total does not sum its rows
 * has to stop an export rather than quietly under-report.
 *
 * These numbers are checked against the template itself by
 * `workbook-schema.test.ts`, so the two cannot drift apart unnoticed.
 */
export const QUARTERLY_CATEGORY_BANDS: {
  category: string
  headingRow: number
  firstRow: number
  lastRow: number
  subtotalIsFormula: boolean
}[] = [
  { category: 'Personnel', headingRow: 18, firstRow: 19, lastRow: 78, subtotalIsFormula: true },
  { category: 'Operational', headingRow: 79, firstRow: 80, lastRow: 119, subtotalIsFormula: true },
  { category: 'CapitalEquipment', headingRow: 120, firstRow: 121, lastRow: 160, subtotalIsFormula: true },
  { category: 'Consumables', headingRow: 162, firstRow: 163, lastRow: 202, subtotalIsFormula: true },
]
