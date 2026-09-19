import type { RubricDimension } from '@/lib/readiness-rubric'

/**
 * Which claims in an assessment are not backed by anything.
 *
 * The platform already insists that a score dropping more than two points carries a
 * written justification. The reverse was unguarded: a score could rise with nothing
 * behind it, and a rise is the direction a funder is being asked to pay for.
 *
 * So the rule is symmetric. A drop needs a reason; a rise should show evidence. This
 * function names the rises that show none.
 *
 * It warns rather than blocks, and that is deliberate. Some evidence genuinely lives
 * outside the platform on the day of assessment - a host site letter in somebody's
 * email, a bank statement being posted. Refusing to record the assessment would
 * either stall the programme or, worse, teach facilitators to attach any document to
 * clear the obstacle. A visible gap that a funder can count is more honest than a
 * mandatory field that gets fed.
 */

export const DIMENSIONS: RubricDimension[] = ['trl', 'brl', 'mrl', 'irl']

export interface Scores {
  trl: number
  brl: number
  mrl: number | null
  irl: number
}

export interface EvidenceGap {
  dimension: RubricDimension
  from: number
  to: number
}

function scoreOf(scores: Scores, dimension: RubricDimension): number | null {
  return scores[dimension]
}

/**
 * Rises with no evidence attached.
 *
 * With no previous assessment every score is a first claim rather than a rise, and
 * a baseline is exactly where evidence is thinnest - the point of a baseline is to
 * record where somebody started. So a baseline reports no gaps.
 */
export function unevidencedRises(
  previous: Scores | null,
  current: Scores,
  evidenceCountByDimension: Partial<Record<RubricDimension, number>>
): EvidenceGap[] {
  if (!previous) return []

  const gaps: EvidenceGap[] = []
  for (const dimension of DIMENSIONS) {
    const before = scoreOf(previous, dimension)
    const after = scoreOf(current, dimension)
    if (before === null || after === null) continue
    if (after <= before) continue
    if ((evidenceCountByDimension[dimension] ?? 0) > 0) continue
    gaps.push({ dimension, from: before, to: after })
  }
  return gaps
}

/**
 * How much of an assessment stands on documents.
 *
 * Reported rather than enforced, so a funder can see which scores in a cohort are
 * backed and which rest on an assessor's word. A number nobody computes is a
 * standard nobody keeps.
 */
export function evidenceCoverage(
  current: Scores,
  evidenceCountByDimension: Partial<Record<RubricDimension, number>>
): { scored: number; backed: number; ratio: number } {
  const scored = DIMENSIONS.filter((d) => scoreOf(current, d) !== null).length
  const backed = DIMENSIONS.filter(
    (d) => scoreOf(current, d) !== null && (evidenceCountByDimension[d] ?? 0) > 0
  ).length
  return { scored, backed, ratio: scored === 0 ? 0 : backed / scored }
}

/** Human phrasing for one gap, used on the form and in the audit trail. */
export function describeGap(gap: EvidenceGap, code: string): string {
  return `${code} rose from ${gap.from} to ${gap.to} with no document attached.`
}
