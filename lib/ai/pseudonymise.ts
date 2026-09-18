/**
 * Pseudonymisation for remote inference.
 *
 * Why this exists: Bedrock in af-south-1 serves Claude 4.5 only through GLOBAL
 * cross-region inference profiles, so requests are routed to whichever
 * commercial AWS region has capacity. Choosing Cape Town does NOT keep prompt
 * content in South Africa. Without this layer, participant names, business
 * names and mentorship notes would cross the border on every question, for a
 * platform holding personal information under POPIA.
 *
 * The approach: replace real names with stable per-request tokens before
 * anything is sent, and hand the map to the signed-in user's own browser to
 * reverse for display. That user is already authorised to see those names, so
 * the map reaching their client leaks nothing; the model never sees them.
 *
 * WHAT THIS GUARANTEES
 *   - Names of people in the caller's scope are replaced everywhere they
 *     appear, including inside free-text fields.
 *   - SA ID numbers never leave: they are the only encrypted column, and
 *     `lib/encryption.ts` decrypt() is not imported anywhere in the AI path.
 *   - Phone numbers and email addresses are never selected into a tool result.
 *
 * WHAT IT DOES NOT GUARANTEE
 *   Free-text fields are author-written prose. A mentorship note naming someone
 *   outside the roster will not be caught by a roster-driven replacement. This
 *   substantially reduces cross-border personal information; it does not
 *   eliminate it. Switching AI_PROVIDER to ollama removes the question.
 */
import { prisma } from '@/lib/prisma'
import { innovatorWhere, type ScopedContext } from '@/lib/scope'
import { addMapping, EMPTY_MAP, type PseudonymMap } from '@/lib/ai/redact'

export {
  redactText,
  redactValue,
  rehydrateText,
  isFullyRedacted,
  EMPTY_MAP,
  type PseudonymMap,
} from '@/lib/ai/redact'

/**
 * Build the map for this request from the caller's in-scope people.
 *
 * Uses the same `innovatorWhere` predicate the tools use, so it cannot widen
 * scope: if the caller cannot see a person, that person is not in the map — and
 * by construction their name cannot appear in a tool result either.
 */
export async function buildPseudonymMap(ctx: ScopedContext): Promise<PseudonymMap> {
  const scope = innovatorWhere(ctx)

  const [participants, mentors] = await Promise.all([
    scope
      ? prisma.innovatorProfile.findMany({
          where: scope,
          select: { firstName: true, lastName: true, businessName: true },
          orderBy: { id: 'asc' },
        })
      : Promise.resolve([]),
    // Funders never see person-level data, so they get no roster at all.
    ctx.role === 'funder_viewer'
      ? Promise.resolve([])
      : prisma.mentorProfile.findMany({
          select: { firstName: true, lastName: true },
          orderBy: { id: 'asc' },
        }),
  ])

  const map: PseudonymMap = { toReal: {}, toToken: {} }

  participants.forEach((p, i) => {
    const token = `Participant ${i + 1}`
    // Full name first so the longest-match ordering prefers it, then the parts,
    // which is what catches a first name used alone inside a session note.
    addMapping(map, `${p.firstName} ${p.lastName}`, token)
    addMapping(map, p.firstName, token)
    addMapping(map, p.lastName, token)
    addMapping(map, p.businessName, `Business ${i + 1}`)
  })

  mentors.forEach((m, i) => {
    const token = `Mentor ${i + 1}`
    addMapping(map, `${m.firstName} ${m.lastName}`, token)
    addMapping(map, m.firstName, token)
    addMapping(map, m.lastName, token)
  })

  return map
}

export { EMPTY_MAP as EMPTY_PSEUDONYM_MAP }
