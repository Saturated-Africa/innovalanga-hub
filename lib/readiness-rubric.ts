/**
 * What each readiness level requires, and what proves it.
 *
 * Before this, an assessor saw a level name and nine buttons. "BRL 6 - Early
 * Revenue" is a judgement with no stated threshold, so two facilitators could
 * score the same venture differently and both be defensible - and nothing could
 * say which was right. Those scores drive the trajectory charts, the cohort
 * comparisons and the funder reports, so the variance propagated into everything
 * built on them.
 *
 * The level names here are exactly the ones lib/utils.ts already returns, and a
 * test asserts that. Assessments already recorded are numbers against those
 * names: renaming a level would quietly reinterpret every historical score and
 * every chart drawn from it.
 *
 * Written for South African conditions rather than from the generic definitions.
 * Interrupted grid power is an operating condition at TRL 5, not an edge case.
 * Tax compliance, a B-BBEE affidavit and CSD registration sit at BRL 6, where they
 * first block money from moving - the point at which an institution or a corporate
 * would pay this business. Informal retail counts as a route to market at MRL 6 on
 * the same terms as a formal retail supplier code.
 */

export type RubricDimension = 'trl' | 'brl' | 'mrl' | 'irl'

export interface RubricLevel {
  level: number
  /** Must match the label in lib/utils.ts. Enforced by a test. */
  name: string
  /** What has to be true to score this level. */
  criteria: string
  /** What is filed to show it. */
  evidence: string
}

export interface RubricSection {
  key: RubricDimension
  code: string
  title: string
  /** The question this dimension answers, for the assessor's benefit. */
  question: string
  levels: RubricLevel[]
}

export const RUBRIC: Record<RubricDimension, RubricSection> = {
  trl: {
    key: 'trl',
    code: 'TRL',
    title: 'Technology Readiness',
    question: 'Does the thing work, and where has it been shown to work?',
    levels: [
      {
        level: 1,
        name: 'Basic Principles',
        criteria:
          'The idea rests on a principle known to work. The problem is stated with a source rather than an anecdote.',
        evidence:
          'One-page concept note naming the source of the problem: StatsSA, a municipal IDP, a sector report, or documented field observation.',
      },
      {
        level: 2,
        name: 'Technology Concept',
        criteria:
          'A specific technical approach has been chosen and can be described. At least one alternative was considered and rejected for a stated reason.',
        evidence: 'Sketch or specification, outline bill of materials, and the reasoning for this approach.',
      },
      {
        level: 3,
        name: 'Experimental Proof',
        criteria:
          'The critical function has been made to work at least once, however crudely. The thing everything else depends on is no longer theoretical.',
        evidence: 'Dated test notes, photographs or video, and who witnessed it.',
      },
      {
        level: 4,
        name: 'Lab Validation',
        criteria:
          'Components or a subsystem tested under controlled conditions and measured against a stated target.',
        evidence:
          'Test protocol and results, and where it was done: a university lab, a TTO, the CSIR, the ARC, or a SANAS-accredited lab where the sector requires one.',
      },
      {
        level: 5,
        name: 'Relevant Environment',
        criteria:
          'It works under the South African conditions it will face: dust, heat, water quality, local inputs, and interrupted or absent grid power, which is an operating condition here rather than an edge case.',
        evidence:
          'Test log from that environment, including behaviour through a power interruption and recovery afterwards.',
      },
      {
        level: 6,
        name: 'Relevant Demo',
        criteria:
          'An integrated prototype demonstrated at a host site - farm, clinic, school, factory, municipal facility - and operated by somebody who is not the founder.',
        evidence:
          'Host site letter confirming dates and what was observed, plus the operator’s feedback in their own words.',
      },
      {
        level: 7,
        name: 'Prototype Demo',
        criteria:
          'A full prototype has run in operational use over a sustained period. Failure modes and maintenance needs are known rather than guessed, and the regulatory pathway is identified.',
        evidence:
          'Operating log of at least one month, fault register, service plan, and the named approval route: NRCS letter of authority, SABS mark, SAHPRA, ICASA type approval, or Act 36 of 1947 registration as the product requires.',
      },
      {
        level: 8,
        name: 'System Complete',
        criteria:
          'A production-intent version is complete and qualified. Required approvals are held or formally in process with a reference number, and production can be repeated by somebody following the documentation.',
        evidence:
          'Certificate, letter of authority or application reference; documented production method and quality checks.',
      },
      {
        level: 9,
        name: 'Operational',
        criteria:
          'In routine use by paying users, with supply, spares, warranty and support arranged so use continues without the founder present.',
        evidence:
          'Three months or more of operating records, warranty and support terms, and the supplier list the operation depends on.',
      },
    ],
  },

  brl: {
    key: 'brl',
    code: 'BRL',
    title: 'Business Readiness',
    question: 'Is there a business - formalised, compliant, and able to survive scrutiny?',
    levels: [
      {
        level: 1,
        name: 'Idea Stage',
        criteria: 'The founder can state the idea. No entity, and costs are not yet known.',
        evidence: 'Nothing beyond the enrolment record.',
      },
      {
        level: 2,
        name: 'Problem Defined',
        criteria:
          'The problem and intended customer are written down, and the founder’s time commitment is explicit: full time, part time, or alongside employment.',
        evidence: 'Written problem and customer statement, and the stated time commitment.',
      },
      {
        level: 3,
        name: 'Market Research',
        criteria:
          'Unit costs are estimated and a price assumption exists. The alternatives a customer has today are named, including imports and doing nothing.',
        evidence:
          'Costing sheet, price assumption, list of alternatives with prices. CIPC name reservation or registration under way.',
      },
      {
        level: 4,
        name: 'Business Model',
        criteria: 'The entity exists and can transact in its own name.',
        evidence:
          'CIPC registration certificate, SARS income tax number, a business bank account in the entity’s name, and a documented business model and pricing.',
      },
      {
        level: 5,
        name: 'MVP Tested',
        criteria:
          'The entity has invoiced real customers and keeps a record of money in and out. A spreadsheet is acceptable; no records are not.',
        evidence: 'Invoices issued from the entity, income and expense records, SARS returns up to date.',
      },
      {
        level: 6,
        name: 'Early Revenue',
        criteria:
          'Revenue is recurring rather than incidental, and the entity is compliant enough to be paid by an institution.',
        evidence:
          'Revenue in at least 3 of the last 6 months; SARS tax compliance status with a PIN; B-BBEE affidavit or certificate; CSD registration where selling to government; COIDA and UIF where anybody is employed.',
      },
      {
        level: 7,
        name: 'Scaling',
        criteria:
          'The business is managed on numbers rather than memory, and revenue does not depend on a single transaction.',
        evidence:
          'Monthly management accounts; at least one signed contract, offtake agreement or repeat purchase order; two or more people paid regularly; VAT registration once turnover passes R1 million.',
      },
      {
        level: 8,
        name: 'Established',
        criteria:
          'Governance and compliance are current without prompting, and the operation is insured against the risks it carries.',
        evidence:
          'Annual financial statements, reviewed or audited as the Companies Act requires for the entity; an advisory board or non-executive presence; insurance schedule; CIPC annual returns, SARS and COIDA current.',
      },
      {
        level: 9,
        name: 'Investment Ready',
        criteria:
          'A third party could conduct due diligence and find no material gap. The numbers rest on assumptions somebody outside the business can test.',
        evidence:
          'Data room: statements for three years or since inception, cap table, IP position, material contracts, compliance certificates, and a financial model with stated assumptions. Able to withstand diligence from TIA, IDC, NEF, SEFA or a private investor.',
      },
    ],
  },

  mrl: {
    key: 'mrl',
    code: 'MRL',
    title: 'Market Readiness',
    question: 'Does somebody want it, at a price that works, through a route that exists?',
    levels: [
      {
        level: 1,
        name: 'Problem Identified',
        criteria: 'A market problem is named. No customer has been spoken to yet.',
        evidence: 'Written statement of the problem and who is assumed to have it.',
      },
      {
        level: 2,
        name: 'Customer Research',
        criteria: 'Real people in the target segment have been asked, and what they pay today is known.',
        evidence:
          'Notes from at least ten structured conversations: who they were, what they use now, what they pay now.',
      },
      {
        level: 3,
        name: 'Value Proposition',
        criteria:
          'The proposition is written and contrasted with the local alternative, including imports. The price fits the customer’s cash cycle - weekly, monthly or per season.',
        evidence:
          'One-page proposition with the comparison, and a price tied to how the customer actually receives money.',
      },
      {
        level: 4,
        name: 'Early Adopters',
        criteria: 'Named prospects have agreed to try it, documented rather than remembered.',
        evidence: 'Letters of intent, pilot agreements or signed order forms with names and dates.',
      },
      {
        level: 5,
        name: 'Validated Demand',
        criteria:
          'Customers who are not friends or family have bought more than once, or renewed. Gross margin per unit at the real selling price is known.',
        evidence: 'Repeat sales records and a margin calculation at the actual price, not the intended one.',
      },
      {
        level: 6,
        name: 'Market Entry',
        criteria:
          'A route to market is chosen and operating, and its terms are understood: payment days, listing or shelf fees, returns, and who carries the stock.',
        evidence:
          'Evidence of the operating route - informal or spaza supply records, a formal retail supplier code, direct sales, e-commerce, an agent network, or an awarded government order - with its terms in writing.',
      },
      {
        level: 7,
        name: 'Growing Revenue',
        criteria:
          'Revenue has grown over six months without a proportional increase in founder effort. Reorder behaviour is tracked and at least one channel partner is performing.',
        evidence: 'Six months of revenue by channel, reorder rate, and partner performance.',
      },
      {
        level: 8,
        name: 'Market Expansion',
        criteria: 'Selling beyond the first province, or exporting.',
        evidence:
          'Sales records by province; for export a SARS customs code, an ITAC permit where required, and the incoterms agreed.',
      },
      {
        level: 9,
        name: 'Scaled Presence',
        criteria:
          'A sustained national footprint or established export trade. Demand is no longer founder-dependent.',
        evidence:
          'Twelve months of records showing sustained presence, and demand arriving without founder-led selling.',
      },
    ],
  },

  irl: {
    key: 'irl',
    code: 'IRL',
    title: 'Innovation Readiness',
    question:
      'How far into the innovation system has this venture reached, and does the system change because of it?',
    levels: [
      {
        level: 1,
        name: 'Awareness',
        criteria:
          'The founder knows the support system exists - SEDFA, SEFA, NYDA, TIA, provincial agencies - but has not approached it.',
        evidence: 'Noted at enrolment.',
      },
      {
        level: 2,
        name: 'Interest',
        criteria: 'Attends information sessions or events and follows opportunities as they arise.',
        evidence: 'Attendance records, or a list of opportunities tracked.',
      },
      {
        level: 3,
        name: 'Engaged',
        criteria: 'Enrolled in a programme and participating in it, and using at least one support service.',
        evidence: 'Programme attendance and mentorship records, and the service used.',
      },
      {
        level: 4,
        name: 'Applied',
        criteria:
          'Has made a substantive application: for funding, for incubation, or for intellectual property protection.',
        evidence: 'Application reference, or a CIPC provisional patent, design or trademark filing number.',
      },
      {
        level: 5,
        name: 'Collaborating',
        criteria: 'A formal arrangement exists with an institution beyond this programme.',
        evidence:
          'Signed agreement or MOU with a university TTO, the CSIR, the ARC, a corporate supplier development programme, or a municipality.',
      },
      {
        level: 6,
        name: 'Contributing',
        criteria:
          'Gives something back to the system: mentors others, speaks, shares data or method, hosts visitors, or takes part in a localisation or supplier development initiative.',
        evidence: 'Named instances with dates and who benefited.',
      },
      {
        level: 7,
        name: 'Leading',
        criteria:
          'Leads something beyond their own venture - a cluster, an association, a co-operative arrangement - and convenes other ventures.',
        evidence: 'Evidence of the role held and what it convenes.',
      },
      {
        level: 8,
        name: 'Systemic',
        criteria:
          'Something outside the venture works differently because of it: a procurement practice, a standard, a curriculum, or employment at district scale.',
        evidence: 'The changed practice, documented, with the counterparty who changed it.',
      },
      {
        level: 9,
        name: 'Ecosystem Influence',
        criteria:
          'Recognised nationally in the sector and consulted on policy or funding design. The approach has been adopted by others.',
        evidence: 'Records of consultation, and instances of the approach adopted elsewhere.',
      },
    ],
  },
}

/**
 * The rules that stop a rubric becoming decoration.
 *
 * Shown to the assessor rather than kept in a document nobody opens. The first two
 * are the ones that hold the scale together: without them "mostly at level 6"
 * becomes a 6, and then a 6 means nothing across a cohort.
 */
export const SCORING_RULES: string[] = [
  'Score the highest level where every criterion is met, not most of them.',
  'No skipping: a venture cannot be a 6 if level 5’s evidence is absent.',
  'If the evidence is not on file it did not happen, for scoring purposes.',
  'The four dimensions move independently. A working prototype nobody wants is TRL 7 and MRL 2, and that is the most useful thing this assessment can say.',
  'Assess the venture, not the founder’s potential.',
  'Where a level is blocked by cost rather than capability, score honestly and record the constraint.',
]

export function levelFor(dimension: RubricDimension, score: number): RubricLevel | null {
  return RUBRIC[dimension].levels.find((l) => l.level === score) ?? null
}
