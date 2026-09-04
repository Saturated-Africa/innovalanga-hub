import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import {
  assertInnovatorInScope,
  assessmentWhere,
  bookingWhere,
  innovatorWhere,
  programmeWhere,
  type ScopedContext,
} from '@/lib/scope'
import {
  formatDate,
  getTRLLabel,
  getBRLLabel,
  getIRLLabel,
  getMRLLabel,
} from '@/lib/utils'

/**
 * The assistant's tool surface.
 *
 * Every tool is a READ. Nothing here writes, and nothing here decrypts:
 * `InnovatorProfile.idNumberEncrypted` is the only encrypted column in the
 * schema and `lib/encryption.ts` `decrypt()` is deliberately never imported
 * into this file. Secrets (`User.password`, `Account.*_token`,
 * `MentorProfile.icsToken`, `MentorProfile.bookingSlug`) are never selected.
 *
 * Scoping is applied here rather than described in the prompt, so the model
 * cannot talk its way past it.
 */

type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ScopedContext
) => Promise<unknown>

interface AssistantTool {
  definition: Anthropic.Tool
  handler: ToolHandler
  /** Roles permitted to call this tool. */
  roles: Array<ScopedContext['role']>
  /** Optional module gate, so disabled modules expose no tools. */
  module?: 'stipends' | 'ip' | 'mande'
}

/** Standard refusal payload, so the model explains rather than invents. */
const DENIED = {
  error: 'not_permitted',
  message:
    'The signed-in user is not permitted to see this data. Tell them plainly that you cannot access it for their role, and do not speculate about its contents.',
}

const NO_SCOPE = { error: 'no_records', message: 'No records are in scope for this user.' }

function readinessLabels(a: {
  trlScore: number
  brlScore: number
  irlScore: number
  mrlScore: number | null
}) {
  return {
    trl: { score: a.trlScore, level: getTRLLabel(a.trlScore) },
    brl: { score: a.brlScore, level: getBRLLabel(a.brlScore) },
    irl: { score: a.irlScore, level: getIRLLabel(a.irlScore) },
    ...(a.mrlScore !== null
      ? { mrl: { score: a.mrlScore, level: getMRLLabel(a.mrlScore) } }
      : {}),
  }
}

const TOOLS: Record<string, AssistantTool> = {
  /* ---------------------------------------------------------------- *
   * Programme configuration — safe for every role.
   * ---------------------------------------------------------------- */
  get_programme_overview: {
    roles: ['super_admin', 'facilitator', 'mentor', 'innovator', 'funder_viewer'],
    definition: {
      name: 'get_programme_overview',
      description:
        'Get the programme configuration: name, the readiness dimensions in use and their score ranges, the assessment periods, regions, and which modules are enabled. Call this first when a question depends on how the programme is set up.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: async (_input, ctx) => {
      if (!ctx.programmeId) return NO_SCOPE
      const [programme, dimensions, periods, regions] = await Promise.all([
        prisma.programme.findUnique({
          where: { id: ctx.programmeId },
          select: { name: true, description: true, participantLabel: true, timezone: true },
        }),
        prisma.readinessDimension.findMany({
          where: { programmeId: ctx.programmeId, enabled: true },
          orderBy: { order: 'asc' },
          select: { key: true, label: true, description: true, minScore: true, maxScore: true },
        }),
        prisma.assessmentPeriodDef.findMany({
          where: { programmeId: ctx.programmeId },
          orderBy: { order: 'asc' },
          select: { key: true, label: true, order: true },
        }),
        prisma.region.findMany({
          where: { programmeId: ctx.programmeId },
          select: { name: true, code: true },
        }),
      ])
      return { programme, dimensions, periods, regions, modules: ctx.modules }
    },
  },

  /* ---------------------------------------------------------------- *
   * Readiness framework explainer — no data access at all.
   * ---------------------------------------------------------------- */
  explain_readiness_level: {
    roles: ['super_admin', 'facilitator', 'mentor', 'innovator', 'funder_viewer'],
    definition: {
      name: 'explain_readiness_level',
      description:
        'Get the official level name for a readiness score on a given dimension (TRL, BRL, IRL or MRL). Use this whenever you refer to a score so you can say "TRL 4 — Validated in Lab" rather than a bare number.',
      input_schema: {
        type: 'object',
        properties: {
          dimension: { type: 'string', enum: ['TRL', 'BRL', 'IRL', 'MRL'] },
          score: { type: 'integer', minimum: 1, maximum: 9 },
        },
        required: ['dimension', 'score'],
        additionalProperties: false,
      },
    },
    handler: async (input) => {
      const dimension = String(input.dimension).toUpperCase()
      const score = Number(input.score)
      const fn: Record<string, (n: number) => string> = {
        TRL: getTRLLabel,
        BRL: getBRLLabel,
        IRL: getIRLLabel,
        MRL: getMRLLabel,
      }
      if (!fn[dimension]) return { error: 'unknown_dimension' }
      return { dimension, score, level: fn[dimension](score) }
    },
  },

  /* ---------------------------------------------------------------- *
   * People. Excluded entirely for funder_viewer.
   * ---------------------------------------------------------------- */
  list_innovators: {
    roles: ['super_admin', 'facilitator', 'mentor'],
    definition: {
      name: 'list_innovators',
      description:
        'List the participants the signed-in user can see, with their cohort, region, business and latest readiness scores. Supports an optional name/business search.',
      input_schema: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional name or business substring.' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    handler: async (input, ctx) => {
      const scope = innovatorWhere(ctx)
      if (!scope) return DENIED

      const search = typeof input.search === 'string' ? input.search.trim() : ''
      const limit = Math.min(Number(input.limit) || 40, 100)

      const rows = await prisma.innovatorProfile.findMany({
        where: {
          AND: [
            scope,
            search
              ? {
                  OR: [
                    { firstName: { contains: search, mode: 'insensitive' as const } },
                    { lastName: { contains: search, mode: 'insensitive' as const } },
                    { businessName: { contains: search, mode: 'insensitive' as const } },
                  ],
                }
              : {},
          ],
        },
        take: limit,
        orderBy: [{ lastName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          businessSector: true,
          cohort: { select: { name: true } },
          region: { select: { name: true } },
          assessments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { period: true, trlScore: true, brlScore: true, irlScore: true, mrlScore: true },
          },
        },
      })

      return rows.map((r) => ({
        id: r.id,
        name: `${r.firstName} ${r.lastName}`,
        business: r.businessName,
        sector: r.businessSector,
        cohort: r.cohort?.name ?? null,
        region: r.region?.name ?? null,
        latestAssessment: r.assessments[0]
          ? { period: r.assessments[0].period, ...readinessLabels(r.assessments[0]) }
          : null,
      }))
    },
  },

  get_innovator_detail: {
    roles: ['super_admin', 'facilitator', 'mentor', 'innovator'],
    definition: {
      name: 'get_innovator_detail',
      description:
        "Get one participant's full assessment history, session history and IP status. An innovator calling this always gets their own record; omit innovator_id for that case.",
      input_schema: {
        type: 'object',
        properties: {
          innovator_id: {
            type: 'string',
            description: 'Participant id from list_innovators. Omit to get your own record.',
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (input, ctx) => {
      // An innovator is always pinned to their own record, whatever id the
      // model supplies.
      let targetId: string | null =
        ctx.role === 'innovator' ? ctx.innovatorId : (input.innovator_id as string) ?? null

      if (!targetId) return { error: 'missing_id', message: 'An innovator_id is required.' }
      if (ctx.role !== 'innovator' && !(await assertInnovatorInScope(ctx, targetId))) {
        return DENIED
      }

      const row = await prisma.innovatorProfile.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          businessName: true,
          businessSector: true,
          bio: true,
          cohort: { select: { name: true, startDate: true, endDate: true } },
          region: { select: { name: true } },
          assessments: {
            orderBy: { createdAt: 'asc' },
            select: {
              period: true,
              trlScore: true,
              brlScore: true,
              irlScore: true,
              mrlScore: true,
              trlJustification: true,
              brlJustification: true,
              irlJustification: true,
              createdAt: true,
            },
          },
          bookings: {
            orderBy: { scheduledStart: 'desc' },
            take: 10,
            select: {
              scheduledStart: true,
              status: true,
              actualDurationMinutes: true,
              mentor: { select: { firstName: true, lastName: true } },
            },
          },
          ipAssessment: {
            select: { primaryRec: true, status: true, reasoning: true, completedAt: true },
          },
        },
      })
      if (!row) return NO_SCOPE

      return {
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        business: row.businessName,
        sector: row.businessSector,
        bio: row.bio,
        cohort: row.cohort?.name ?? null,
        region: row.region?.name ?? null,
        assessments: row.assessments.map((a) => ({
          period: a.period,
          date: formatDate(a.createdAt),
          ...readinessLabels(a),
          justifications: {
            trl: a.trlJustification,
            brl: a.brlJustification,
            irl: a.irlJustification,
          },
        })),
        recentSessions: row.bookings.map((b) => ({
          date: formatDate(b.scheduledStart),
          status: b.status,
          durationMinutes: b.actualDurationMinutes,
          mentor: `${b.mentor.firstName} ${b.mentor.lastName}`,
        })),
        ip: ctx.modules.ip ? row.ipAssessment : null,
      }
    },
  },

  /* ---------------------------------------------------------------- *
   * Sessions.
   * ---------------------------------------------------------------- */
  list_sessions: {
    roles: ['super_admin', 'facilitator', 'mentor', 'innovator'],
    definition: {
      name: 'list_sessions',
      description:
        'List mentorship sessions in scope, optionally filtered by status or limited to upcoming ones. Use for "what is coming up", "who did I meet", and session-history questions.',
      input_schema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [
              'Confirmed',
              'InProgress',
              'Completed',
              'Cancelled',
              'Rescheduled',
              'NoShowPendingReview',
            ],
          },
          upcoming_only: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
    },
    handler: async (input, ctx) => {
      const scope = bookingWhere(ctx)
      if (!scope) return DENIED

      const rows = await prisma.booking.findMany({
        where: {
          AND: [
            scope,
            input.status ? { status: input.status as never } : {},
            input.upcoming_only ? { scheduledStart: { gte: new Date() } } : {},
          ],
        },
        take: Math.min(Number(input.limit) || 20, 50),
        orderBy: { scheduledStart: input.upcoming_only ? 'asc' : 'desc' },
        select: {
          scheduledStart: true,
          scheduledEnd: true,
          status: true,
          actualDurationMinutes: true,
          notes: true,
          innovator: { select: { firstName: true, lastName: true, businessName: true } },
          mentor: { select: { firstName: true, lastName: true, expertise: true } },
          mentorshipLog: { select: { notes: true, outcomes: true, nextSteps: true } },
        },
      })

      return rows.map((b) => ({
        date: formatDate(b.scheduledStart),
        status: b.status,
        durationMinutes: b.actualDurationMinutes,
        participant: `${b.innovator.firstName} ${b.innovator.lastName}`,
        business: b.innovator.businessName,
        mentor: `${b.mentor.firstName} ${b.mentor.lastName}`,
        mentorExpertise: b.mentor.expertise,
        sessionNotes: b.notes,
        log: b.mentorshipLog,
      }))
    },
  },

  /* ---------------------------------------------------------------- *
   * Aggregates. This is the only family funder_viewer can reach.
   * ---------------------------------------------------------------- */
  get_programme_kpis: {
    roles: ['super_admin', 'facilitator', 'funder_viewer'],
    definition: {
      name: 'get_programme_kpis',
      description:
        'Get aggregate programme statistics: participant count, assessments completed, sessions completed, average readiness scores per cohort, and the session status breakdown. Contains no personal data.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: async (_input, ctx) => {
      if (!ctx.programmeId) return NO_SCOPE
      const innovatorScope = { cohort: { programmeId: ctx.programmeId } }

      const [totalInnovators, totalAssessments, completedSessions, cohorts, sessionsByStatus] =
        await Promise.all([
          prisma.innovatorProfile.count({ where: innovatorScope }),
          prisma.assessment.count({ where: { innovator: innovatorScope } }),
          prisma.booking.count({
            where: { status: 'Completed', innovator: innovatorScope },
          }),
          prisma.cohort.findMany({
            where: { programmeId: ctx.programmeId },
            select: {
              name: true,
              _count: { select: { innovators: true } },
              innovators: {
                select: {
                  assessments: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: { trlScore: true, brlScore: true, irlScore: true },
                  },
                },
              },
            },
          }),
          prisma.booking.groupBy({
            by: ['status'],
            where: { innovator: innovatorScope },
            _count: { _all: true },
          }),
        ])

      const cohortAverages = cohorts.map((c) => {
        const latest = c.innovators.map((i) => i.assessments[0]).filter(Boolean)
        const avg = (pick: (a: NonNullable<(typeof latest)[number]>) => number) =>
          latest.length
            ? Math.round((latest.reduce((s, a) => s + pick(a!), 0) / latest.length) * 10) / 10
            : null
        return {
          cohort: c.name,
          participants: c._count.innovators,
          avgTRL: avg((a) => a.trlScore),
          avgBRL: avg((a) => a.brlScore),
          avgIRL: avg((a) => a.irlScore),
        }
      })

      return {
        totalParticipants: totalInnovators,
        totalAssessments,
        completedSessions,
        cohortAverages,
        sessionsByStatus: sessionsByStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
        })),
      }
    },
  },

  /* ---------------------------------------------------------------- *
   * M&E — programme-level, no personal data.
   * ---------------------------------------------------------------- */
  get_mande_summary: {
    roles: ['super_admin', 'facilitator', 'funder_viewer'],
    module: 'mande',
    definition: {
      name: 'get_mande_summary',
      description:
        'Get the monitoring and evaluation picture: theory of change, indicators with their latest values against target, beneficiary reach for the most recent period, and milestone status. This is the grounding for funder reporting narratives.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    handler: async (_input, ctx) => {
      const where = programmeWhere(ctx)
      if (!where) return NO_SCOPE

      const [toc, indicators, beneficiaries, milestones, logframe] = await Promise.all([
        prisma.theoryOfChange.findFirst({ where }),
        prisma.indicator.findMany({
          where: { ...where, active: true },
          select: {
            name: true,
            description: true,
            type: true,
            unit: true,
            baseline: true,
            target: true,
            frequency: true,
            records: {
              orderBy: { periodStart: 'desc' },
              take: 1,
              select: { periodLabel: true, value: true, notes: true },
            },
          },
        }),
        prisma.beneficiaryCount.findFirst({
          where,
          orderBy: { periodStart: 'desc' },
        }),
        prisma.milestoneTracker.findMany({
          where,
          orderBy: { targetDate: 'asc' },
          select: { title: true, status: true, targetDate: true, completedDate: true },
        }),
        prisma.logFrameItem.findMany({
          where,
          orderBy: [{ level: 'asc' }, { order: 'asc' }],
          select: { level: true, description: true, indicators: true },
        }),
      ])

      return {
        theoryOfChange: toc,
        logframe,
        indicators: indicators.map((i) => {
          const latest = i.records[0]
          return {
            name: i.name,
            description: i.description,
            type: i.type,
            unit: i.unit,
            baseline: i.baseline,
            target: i.target,
            frequency: i.frequency,
            latestPeriod: latest?.periodLabel ?? null,
            latestValue: latest?.value ?? null,
            // Same formula the M&E dashboard uses.
            percentOfTarget:
              latest && i.target
                ? Math.min(100, Math.round((latest.value / i.target) * 100))
                : null,
          }
        }),
        beneficiaries,
        milestones: milestones.map((m) => ({
          title: m.title,
          status: m.status,
          targetDate: formatDate(m.targetDate),
          completedDate: m.completedDate ? formatDate(m.completedDate) : null,
        })),
      }
    },
  },

  /* ---------------------------------------------------------------- *
   * Stipends — financial, so never funder_viewer or mentor.
   * ---------------------------------------------------------------- */
  get_stipend_summary: {
    roles: ['super_admin', 'facilitator', 'innovator'],
    module: 'stipends',
    definition: {
      name: 'get_stipend_summary',
      description:
        'Get stipend records in scope, with hours completed, amount and eligibility status. An innovator sees only their own. Use this to explain how a stipend figure was arrived at.',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
        additionalProperties: false,
      },
    },
    handler: async (input, ctx) => {
      const scope = innovatorWhere(ctx)
      if (!scope) return DENIED

      const rows = await prisma.stipendRecord.findMany({
        where:
          ctx.role === 'innovator'
            ? { innovatorId: ctx.innovatorId ?? '__none__' }
            : { innovator: scope },
        take: Math.min(Number(input.limit) || 30, 100),
        orderBy: { periodStart: 'desc' },
        select: {
          periodStart: true,
          periodEnd: true,
          hoursCompleted: true,
          amount: true,
          status: true,
          overrideReason: true,
          paidAt: true,
          innovator: { select: { firstName: true, lastName: true } },
        },
      })

      return {
        currency: ctx.currencySymbol,
        rule: 'Hours are the sum of actual duration across Completed bookings inside the period, divided by 60.',
        records: rows.map((s) => ({
          participant: `${s.innovator.firstName} ${s.innovator.lastName}`,
          period: `${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)}`,
          hoursCompleted: s.hoursCompleted,
          amount: s.amount,
          status: s.status,
          overrideReason: s.overrideReason,
          paid: s.paidAt ? formatDate(s.paidAt) : null,
        })),
      }
    },
  },
}

/* -------------------------------------------------------------------- *
 * Assembly
 * -------------------------------------------------------------------- */

/** Tool definitions this user may actually use. */
export function toolsForContext(ctx: ScopedContext): Anthropic.Tool[] {
  return Object.values(TOOLS)
    .filter((t) => t.roles.includes(ctx.role))
    .filter((t) => !t.module || ctx.modules[t.module])
    .map((t) => t.definition)
}

/**
 * Execute a tool call.
 *
 * Re-checks the role and module gate rather than trusting that the model only
 * called what it was offered.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ScopedContext
): Promise<unknown> {
  const tool = TOOLS[name]
  if (!tool) return { error: 'unknown_tool', message: `No tool named ${name}.` }
  if (!tool.roles.includes(ctx.role)) return DENIED
  if (tool.module && !ctx.modules[tool.module]) {
    return { error: 'module_disabled', message: 'That module is not enabled for this programme.' }
  }

  try {
    return await tool.handler(input, ctx)
  } catch (err) {
    console.error(`[assistant] tool ${name} failed:`, err)
    return { error: 'tool_failed', message: 'That lookup failed. Say so rather than guessing.' }
  }
}
