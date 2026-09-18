/**
 * Progression tracking for a single readiness dimension.
 *
 * Built for Business Readiness Level, but written against a dimension key
 * rather than against BRL specifically, so the same page serves TRL, IRL and
 * MRL without three near-identical copies. Programmes already configure which
 * dimensions they use, so hard-coding one here would have contradicted that.
 *
 * Dependency-free, like the scope and access rules, so the arithmetic that
 * decides who is "stalled" can be tested without a database.
 *
 * The question this exists to answer is not "what is everyone's score", which
 * the assessment list already shows. It is "who is moving, who is stuck, and
 * who is nearly ready", which is what a facilitator acts on.
 */

export type DimensionKey = 'trl' | 'brl' | 'irl' | 'mrl'

/** One assessment, reduced to what progression needs. */
export interface ScoredPeriod {
  /** Period key, e.g. "baseline", "month_3". */
  period: string
  score: number | null
  assessedAt: Date
}

export interface Participant {
  id: string
  name: string
  cohortId: string | null
  cohortName: string | null
  /** Every assessment for this person, any order. */
  history: ScoredPeriod[]
}

export interface Movement {
  id: string
  name: string
  cohortName: string | null
  current: number | null
  previous: number | null
  /** Positive is progress. Null when there is nothing to compare against. */
  delta: number | null
  currentPeriod: string | null
  periodsAssessed: number
  /** Assessed more than once with no net movement. */
  stalled: boolean
  /** Went backwards since the previous period. */
  regressed: boolean
}

/**
 * Order a participant's history by the programme's own period order.
 *
 * Ordering by date is wrong here: assessments are frequently captured late, so
 * a Month 6 entered before a backfilled Month 3 would otherwise read as the
 * later of the two and invert the delta.
 */
function inPeriodOrder(history: ScoredPeriod[], periodOrder: string[]): ScoredPeriod[] {
  const rank = new Map(periodOrder.map((key, i) => [key, i]))
  return [...history]
    .filter((h) => h.score !== null && rank.has(h.period))
    .sort((a, b) => (rank.get(a.period) ?? 0) - (rank.get(b.period) ?? 0))
}

/** Reduce one participant to their movement on this dimension. */
export function movementFor(
  participant: Participant,
  periodOrder: string[]
): Movement {
  const ordered = inPeriodOrder(participant.history, periodOrder)
  const last = ordered[ordered.length - 1]
  const prev = ordered[ordered.length - 2]

  const current = last?.score ?? null
  const previous = prev?.score ?? null
  const delta = current !== null && previous !== null ? current - previous : null

  return {
    id: participant.id,
    name: participant.name,
    cohortName: participant.cohortName,
    current,
    previous,
    delta,
    currentPeriod: last?.period ?? null,
    periodsAssessed: ordered.length,
    // Stalled needs at least two assessments. A single baseline is not a
    // participant who has stopped moving; it is one nobody has re-assessed.
    stalled: ordered.length > 1 && delta === 0,
    regressed: delta !== null && delta < 0,
  }
}

/** Count of participants at each level from min to max. */
export function distribution(
  movements: Movement[],
  min = 1,
  max = 9
): { level: number; count: number }[] {
  const counts = new Map<number, number>()
  for (let level = min; level <= max; level++) counts.set(level, 0)
  for (const m of movements) {
    if (m.current !== null && counts.has(m.current)) {
      counts.set(m.current, (counts.get(m.current) ?? 0) + 1)
    }
  }
  return Array.from(counts, ([level, count]) => ({ level, count }))
}

export interface TrackerSummary {
  assessed: number
  notAssessed: number
  average: number | null
  advancing: number
  stalled: number
  regressed: number
  /** At the top two levels: the ones to put in front of a funder. */
  nearReady: number
}

export function summarise(movements: Movement[], max = 9): TrackerSummary {
  const scored = movements.filter((m) => m.current !== null)
  const total = scored.reduce((sum, m) => sum + (m.current ?? 0), 0)

  return {
    assessed: scored.length,
    notAssessed: movements.length - scored.length,
    // Rounded to one decimal at the point of display, not here, so the raw
    // value stays available for charts.
    average: scored.length > 0 ? total / scored.length : null,
    advancing: movements.filter((m) => (m.delta ?? 0) > 0).length,
    stalled: movements.filter((m) => m.stalled).length,
    regressed: movements.filter((m) => m.regressed).length,
    nearReady: scored.filter((m) => (m.current ?? 0) >= max - 1).length,
  }
}

/** Average score per cohort, for comparing groups rather than individuals. */
export function byCohort(
  movements: Movement[]
): { cohortName: string; count: number; average: number }[] {
  const groups = new Map<string, number[]>()
  for (const m of movements) {
    if (m.current === null) continue
    const key = m.cohortName ?? 'Unassigned'
    groups.set(key, [...(groups.get(key) ?? []), m.current])
  }
  return Array.from(groups, ([cohortName, scores]) => ({
    cohortName,
    count: scores.length,
    average: scores.reduce((a, b) => a + b, 0) / scores.length,
  })).sort((a, b) => b.average - a.average)
}

/**
 * Who needs attention, most urgent first.
 *
 * Regression outranks stalling: going backwards is a signal something has
 * happened, where standing still may simply be a hard level to leave. Within
 * each group the lower score comes first, since a participant stuck at level
 * two is in more trouble than one stuck at level seven.
 */
export function needsAttention(movements: Movement[]): Movement[] {
  return movements
    .filter((m) => m.regressed || m.stalled)
    .sort((a, b) => {
      if (a.regressed !== b.regressed) return a.regressed ? -1 : 1
      return (a.current ?? 0) - (b.current ?? 0)
    })
}
