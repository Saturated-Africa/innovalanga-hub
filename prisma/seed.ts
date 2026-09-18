import {
  PrismaClient,
  UserRole,
  BookingStatus,
  StipendStatus,
  DocumentType,
} from '@prisma/client'
import bcrypt from 'bcryptjs'
import { addDays, addMonths, startOfMonth, endOfMonth, addHours } from 'date-fns'
import { EVENT_COLORS } from '../lib/event-colors'

const prisma = new PrismaClient()

/**
 * Refuse to run against a production database.
 *
 * The first thing this script does is delete every row in every table. It also
 * creates a super_admin whose password is written in this file, so running it
 * anywhere real would both destroy the data and leave a publicly known
 * administrator credential behind.
 *
 * SEED_ALLOW_PRODUCTION exists only for restoring a demo environment that
 * legitimately runs with NODE_ENV=production.
 */
function assertSafeToSeed() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'yes') {
    throw new Error(
      'Refusing to seed: NODE_ENV is production. This deletes every row in the ' +
        'database. Set SEED_ALLOW_PRODUCTION=yes only if that is genuinely intended.'
    )
  }
}

async function main() {
  assertSafeToSeed()
  console.log('Seeding database...')

  // Clear all data (order matters for FK constraints)
  await prisma.auditLog.deleteMany()
  await prisma.document.deleteMany()
  await prisma.stipendRecord.deleteMany()
  await prisma.mentorshipLog.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.assessment.deleteMany()
  await prisma.mentorAvailability.deleteMany()
  await prisma.mentorDateOverride.deleteMany()
  await prisma.blackoutPeriod.deleteMany()
  await prisma.eventType.deleteMany()
  await prisma.mentorProfile.deleteMany()
  await prisma.innovatorProfile.deleteMany()
  await prisma.cohort.deleteMany()
  await prisma.assessmentPeriodDef.deleteMany()
  await prisma.readinessDimension.deleteMany()
  await prisma.region.deleteMany()
  await prisma.milestoneTracker.deleteMany()
  await prisma.beneficiaryCount.deleteMany()
  await prisma.indicatorRecord.deleteMany()
  await prisma.indicator.deleteMany()
  await prisma.logFrameItem.deleteMany()
  await prisma.theoryOfChange.deleteMany()
  await prisma.iPAssessment.deleteMany()
  await prisma.notification.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()
  await prisma.programme.deleteMany()

  // Cost 12, matching the application. The seed used cost 10, so the demo
  // accounts were cheaper to attack than real ones.
  const hash = (pw: string) => bcrypt.hashSync(pw, 12)

  // ── Programme ─────────────────────────────────────────────────────────────
  const tia = await prisma.programme.create({
    data: {
      name: 'TIA Innovation Programme',
      slug: 'tia',
      description:
        'Government-backed entrepreneurship programme under TIA and DSTI. Tracks youth innovators across the programme regions.',
      organizationName: 'TIA · DSTI',
      participantLabel: 'innovator',
      timezone: 'Africa/Johannesburg',
      currency: 'ZAR',
      currencySymbol: 'R',
      dateFormat: 'DD/MM/YYYY',
      idFormat: 'SA_ID',
      defaultStipendAmount: 1000,
      moduleStipendsEnabled: true,
      moduleIPEnabled: true,
      moduleMandEEnabled: true,
    },
  })

  // ── Regions ───────────────────────────────────────────────────────────────
  const regionNorth = await prisma.region.create({
    data: { programmeId: tia.id, name: 'Northern Region', code: 'NR' },
  })
  const regionSouth = await prisma.region.create({
    data: { programmeId: tia.id, name: 'Southern Region', code: 'SR' },
  })

  // ── Readiness Dimensions ──────────────────────────────────────────────────
  await prisma.readinessDimension.createMany({
    data: [
      {
        programmeId: tia.id,
        key: 'trl',
        label: 'Technology Readiness Level',
        shortLabel: 'TRL',
        description: 'Measures the maturity of a technology from concept (1) to operational deployment (9).',
        order: 0,
        enabled: true,
      },
      {
        programmeId: tia.id,
        key: 'brl',
        label: 'Business Readiness Level',
        shortLabel: 'BRL',
        description: 'Measures business model maturity from initial idea (1) to investment-ready (9).',
        order: 1,
        enabled: true,
      },
      {
        programmeId: tia.id,
        key: 'irl',
        label: 'Innovation Readiness Level',
        shortLabel: 'IRL',
        description: 'Measures innovation ecosystem engagement from awareness (1) to ecosystem influence (9).',
        order: 2,
        enabled: true,
      },
      {
        programmeId: tia.id,
        key: 'mrl',
        label: 'Market Readiness Level',
        shortLabel: 'MRL',
        description: 'Measures market penetration readiness from problem identification (1) to scaled market presence (9).',
        order: 3,
        enabled: true,
      },
    ],
  })

  // ── Assessment Periods ────────────────────────────────────────────────────
  await prisma.assessmentPeriodDef.createMany({
    data: [
      { programmeId: tia.id, key: 'baseline', label: 'Baseline', order: 0, monthOffset: 0 },
      { programmeId: tia.id, key: 'month_3', label: 'Month 3', order: 1, monthOffset: 3 },
      { programmeId: tia.id, key: 'month_6', label: 'Month 6', order: 2, monthOffset: 6 },
      { programmeId: tia.id, key: 'month_9', label: 'Month 9', order: 3, monthOffset: 9 },
      { programmeId: tia.id, key: 'final', label: 'Final', order: 4, monthOffset: 12 },
    ],
  })

  // ── Cohorts ───────────────────────────────────────────────────────────────
  const cohort1 = await prisma.cohort.create({
    data: {
      programmeId: tia.id,
      regionId: regionNorth.id,
      name: 'Northern Cohort 2024',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2024-12-15'),
      description: 'First cohort, focusing on agri-tech and fintech solutions.',
    },
  })
  const cohort2 = await prisma.cohort.create({
    data: {
      programmeId: tia.id,
      regionId: regionSouth.id,
      name: 'Southern Cohort 2024',
      startDate: new Date('2024-02-01'),
      endDate: new Date('2024-12-31'),
      description: 'Inaugural cohort, spanning health-tech and clean energy.',
    },
  })

  // ── Super Admin ───────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      email: 'admin@innovalanga.co.za',
      name: 'System Administrator',
      password: hash('Admin@1234'),
      role: UserRole.super_admin,
      programmeId: null,
    },
  })

  // ── Facilitator ───────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      email: 'facilitator@innovalanga.co.za',
      name: 'Nomsa Dlamini',
      password: hash('Facilitator@1234'),
      role: UserRole.facilitator,
      programmeId: tia.id,
    },
  })

  // ── Funder Viewer ─────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      email: 'funder@tia.gov.za',
      name: 'TIA Funder',
      password: hash('Funder@1234'),
      role: UserRole.funder_viewer,
      programmeId: tia.id,
    },
  })

  // ── Mentors ───────────────────────────────────────────────────────────────
  const mentorUsers = await Promise.all([
    prisma.user.create({
      data: {
        email: 'mentor1@innovalanga.co.za',
        name: 'Dr. Sipho Nkosi',
        password: hash('Mentor@1234'),
        role: UserRole.mentor,
        programmeId: tia.id,
        mentorProfile: {
          create: {
            firstName: 'Sipho',
            lastName: 'Nkosi',
            phone: '+27821234567',
            expertise: ['Technology', 'Product Development', 'Agri-Tech'],
            bio: 'PhD in Computer Science with 15 years in tech entrepreneurship across Sub-Saharan Africa.',
            bookingSlug: 'sipho-nkosi',
            icsToken: 'ics-sipho-nkosi-token-001',
          },
        },
      },
      include: { mentorProfile: true },
    }),
    prisma.user.create({
      data: {
        email: 'mentor2@innovalanga.co.za',
        name: 'Thandi Mokoena',
        password: hash('Mentor@1234'),
        role: UserRole.mentor,
        programmeId: tia.id,
        mentorProfile: {
          create: {
            firstName: 'Thandi',
            lastName: 'Mokoena',
            phone: '+27831234567',
            expertise: ['Business Development', 'Finance', 'FinTech'],
            bio: 'MBA graduate and serial entrepreneur with expertise in financial services and startup funding.',
            bookingSlug: 'thandi-mokoena',
            icsToken: 'ics-thandi-mokoena-token-002',
          },
        },
      },
      include: { mentorProfile: true },
    }),
    prisma.user.create({
      data: {
        email: 'mentor3@innovalanga.co.za',
        name: 'Kabelo Sithole',
        password: hash('Mentor@1234'),
        role: UserRole.mentor,
        programmeId: tia.id,
        mentorProfile: {
          create: {
            firstName: 'Kabelo',
            lastName: 'Sithole',
            phone: '+27841234567',
            expertise: ['Health Tech', 'Clean Energy', 'Innovation Strategy'],
            bio: 'Clean energy advocate and health-tech innovator with 10 years mentoring early-stage startups.',
            bookingSlug: 'kabelo-sithole',
            icsToken: 'ics-kabelo-sithole-token-003',
          },
        },
      },
      include: { mentorProfile: true },
    }),
  ])

  const [mentor1User, mentor2User, mentor3User] = mentorUsers
  const mentor1 = mentor1User.mentorProfile!
  const mentor2 = mentor2User.mentorProfile!
  const mentor3 = mentor3User.mentorProfile!

  // Mentor availability Mon–Fri 09:00–17:00 SAST (07:00–15:00 UTC)
  for (const mentor of [mentor1, mentor2, mentor3]) {
    for (const day of [1, 2, 3, 4, 5]) {
      await prisma.mentorAvailability.create({
        data: {
          mentorId: mentor.id,
          dayOfWeek: day,
          startTime: '07:00',
          endTime: '15:00',
          bufferMins: 15,
        },
      })
    }
  }

  // Event types for each mentor
  for (const mentor of [mentor1, mentor2, mentor3]) {
    await prisma.eventType.createMany({
      data: [
        {
          mentorId: mentor.id,
          name: '1-on-1 Mentorship Session',
          slug: 'mentorship-60',
          description: 'A focused 60-minute session to work through challenges, review progress, and set next steps.',
          durationMins: 60,
          bufferBefore: 0,
          bufferAfter: 15,
          color: EVENT_COLORS[0],
          active: true,
        },
        {
          mentorId: mentor.id,
          name: 'Quick Check-in',
          slug: 'checkin-30',
          description: 'A 30-minute light-touch check-in to stay aligned on milestones.',
          durationMins: 30,
          bufferBefore: 0,
          bufferAfter: 10,
          color: EVENT_COLORS[1],
          active: true,
        },
      ],
    })
  }

  // ── Innovators ────────────────────────────────────────────────────────────
  const innovatorData = [
    {
      email: 'zanele@innovalanga.co.za',
      name: 'Zanele Khumalo',
      firstName: 'Zanele',
      lastName: 'Khumalo',
      phone: '+27761234567',
      regionId: regionNorth.id,
      cohortId: cohort1.id,
      businessName: 'AgroSense SA',
      businessSector: 'Agri-Tech',
      bio: 'Developing IoT sensors for small-scale farmers.',
    },
    {
      email: 'lethiwe@innovalanga.co.za',
      name: 'Lethiwe Mahlangu',
      firstName: 'Lethiwe',
      lastName: 'Mahlangu',
      phone: '+27771234567',
      regionId: regionNorth.id,
      cohortId: cohort1.id,
      businessName: 'PayLocal',
      businessSector: 'FinTech',
      bio: 'Building a micro-payment platform for informal traders.',
    },
    {
      email: 'bongani@innovalanga.co.za',
      name: 'Bongani Zwane',
      firstName: 'Bongani',
      lastName: 'Zwane',
      phone: '+27781234567',
      regionId: regionNorth.id,
      cohortId: cohort1.id,
      businessName: 'EduBridge',
      businessSector: 'EdTech',
      bio: 'Offline-first learning app for rural high school students.',
    },
    {
      email: 'palesa@innovalanga.co.za',
      name: 'Palesa Mokoena',
      firstName: 'Palesa',
      lastName: 'Mokoena',
      phone: '+27791234567',
      regionId: regionSouth.id,
      cohortId: cohort2.id,
      businessName: 'HealthLink',
      businessSector: 'Health Tech',
      bio: 'Telemedicine platform connecting rural patients with specialist doctors.',
    },
    {
      email: 'siphamandla@innovalanga.co.za',
      name: 'Siphamandla Dube',
      firstName: 'Siphamandla',
      lastName: 'Dube',
      phone: '+27701234567',
      regionId: regionSouth.id,
      cohortId: cohort2.id,
      businessName: 'SolarGrid',
      businessSector: 'Clean Energy',
      bio: 'Solar micro-grid solutions for off-grid communities.',
    },
  ]

  const innovators = await Promise.all(
    innovatorData.map((d) =>
      prisma.user.create({
        data: {
          email: d.email,
          name: d.name,
          password: hash('Innovator@1234'),
          role: UserRole.innovator,
          programmeId: tia.id,
          innovatorProfile: {
            create: {
              firstName: d.firstName,
              lastName: d.lastName,
              phone: d.phone,
              regionId: d.regionId,
              cohortId: d.cohortId,
              businessName: d.businessName,
              businessSector: d.businessSector,
              bio: d.bio,
            },
          },
        },
        include: { innovatorProfile: true },
      })
    )
  )

  const profiles = innovators.map((u) => u.innovatorProfile!)

  // ── Assessments (3 per innovator: baseline, month_3, month_6) ─────────────
  const assessmentScores = [
    // Zanele - strong growth
    [
      { trl: 2, brl: 1, irl: 2, mrl: 1 },
      { trl: 4, brl: 3, irl: 4, mrl: 3 },
      { trl: 6, brl: 5, irl: 6, mrl: 5 },
    ],
    // Lethiwe - steady progress
    [
      { trl: 3, brl: 2, irl: 3, mrl: 2 },
      { trl: 4, brl: 4, irl: 4, mrl: 4 },
      { trl: 5, brl: 6, irl: 5, mrl: 5 },
    ],
    // Bongani - slower tech, faster business
    [
      { trl: 2, brl: 3, irl: 2, mrl: 2 },
      { trl: 3, brl: 5, irl: 3, mrl: 3 },
      { trl: 4, brl: 7, irl: 4, mrl: 4 },
    ],
    // Palesa - health tech leader
    [
      { trl: 3, brl: 2, irl: 3, mrl: 3 },
      { trl: 5, brl: 4, irl: 5, mrl: 5 },
      { trl: 7, brl: 6, irl: 7, mrl: 6 },
    ],
    // Siphamandla - energy innovator
    [
      { trl: 4, brl: 3, irl: 4, mrl: 3 },
      { trl: 6, brl: 5, irl: 6, mrl: 5 },
      { trl: 7, brl: 7, irl: 7, mrl: 7 },
    ],
  ]

  const periodKeys = ['baseline', 'month_3', 'month_6']

  for (let i = 0; i < profiles.length; i++) {
    for (let j = 0; j < 3; j++) {
      const scores = assessmentScores[i][j]
      const createdAt = addMonths(new Date('2024-01-15'), j * 3)
      await prisma.assessment.create({
        data: {
          innovatorId: profiles[i].id,
          period: periodKeys[j],
          trlScore: scores.trl,
          brlScore: scores.brl,
          irlScore: scores.irl,
          mrlScore: scores.mrl,
          trlJustification: `TRL justification for period ${j + 1}`,
          brlJustification: `BRL justification for period ${j + 1}`,
          irlJustification: `IRL justification for period ${j + 1}`,
          mrlJustification: `MRL justification for period ${j + 1}`,
          assessedBy: 'Nomsa Dlamini',
          lockedAt: createdAt,
          createdAt,
          updatedAt: createdAt,
        },
      })
    }
  }

  // ── Bookings ──────────────────────────────────────────────────────────────
  // Fetch event types for mentor1
  const mentor1ET = await prisma.eventType.findFirst({
    where: { mentorId: mentor1.id, slug: 'mentorship-60' },
  })
  const mentor2ET = await prisma.eventType.findFirst({
    where: { mentorId: mentor2.id, slug: 'mentorship-60' },
  })
  const mentor3ET = await prisma.eventType.findFirst({
    where: { mentorId: mentor3.id, slug: 'mentorship-60' },
  })

  const now = new Date('2024-09-10T09:00:00Z')

  const bookingData = [
    {
      innovatorId: profiles[0].id,
      mentorId: mentor1.id,
      eventTypeId: mentor1ET?.id,
      scheduledStart: addDays(now, -14),
      scheduledEnd: addHours(addDays(now, -14), 1),
      actualStart: addDays(now, -14),
      actualEnd: addHours(addDays(now, -14), 1),
      actualDurationMinutes: 60,
      status: BookingStatus.Completed,
      notes: 'Discussed IoT prototype iteration and next steps for field testing.',
    },
    {
      innovatorId: profiles[0].id,
      mentorId: mentor1.id,
      eventTypeId: mentor1ET?.id,
      scheduledStart: addDays(now, 3),
      scheduledEnd: addHours(addDays(now, 3), 1),
      status: BookingStatus.Confirmed,
      notes: 'Follow-up on field testing results.',
    },
    {
      innovatorId: profiles[1].id,
      mentorId: mentor2.id,
      eventTypeId: mentor2ET?.id,
      scheduledStart: addDays(now, -7),
      scheduledEnd: addHours(addDays(now, -7), 1),
      actualStart: addDays(now, -7),
      actualEnd: addHours(addDays(now, -7), 1),
      actualDurationMinutes: 60,
      status: BookingStatus.Completed,
      notes: 'Payment gateway integration strategy.',
    },
    {
      innovatorId: profiles[2].id,
      mentorId: mentor1.id,
      eventTypeId: mentor1ET?.id,
      scheduledStart: addDays(now, -3),
      scheduledEnd: addHours(addDays(now, -3), 1),
      status: BookingStatus.NoShowPendingReview,
    },
    {
      innovatorId: profiles[3].id,
      mentorId: mentor3.id,
      eventTypeId: mentor3ET?.id,
      scheduledStart: addDays(now, -10),
      scheduledEnd: addHours(addDays(now, -10), 1),
      actualStart: addDays(now, -10),
      actualEnd: addHours(addDays(now, -10), 1),
      actualDurationMinutes: 55,
      status: BookingStatus.Completed,
      notes: 'Regulatory pathway for telemedicine discussed.',
    },
    {
      innovatorId: profiles[3].id,
      mentorId: mentor3.id,
      eventTypeId: mentor3ET?.id,
      scheduledStart: addDays(now, 5),
      scheduledEnd: addHours(addDays(now, 5), 1),
      status: BookingStatus.Confirmed,
    },
    {
      innovatorId: profiles[4].id,
      mentorId: mentor3.id,
      eventTypeId: mentor3ET?.id,
      scheduledStart: addDays(now, -5),
      scheduledEnd: addHours(addDays(now, -5), 1),
      actualStart: addDays(now, -5),
      actualEnd: addHours(addDays(now, -5), 1),
      actualDurationMinutes: 60,
      status: BookingStatus.Completed,
      notes: 'Reviewed solar grid deployment plan for 3 villages.',
    },
  ]

  const bookings = await Promise.all(
    bookingData.map((b) => prisma.booking.create({ data: b as any }))
  )

  const completedBookings = bookings.filter((b) => b.status === BookingStatus.Completed)
  await Promise.all(
    completedBookings.map((b) =>
      prisma.mentorshipLog.create({
        data: {
          bookingId: b.id,
          notes: b.notes ?? 'Session completed successfully.',
          outcomes: 'Clear milestones established for next period.',
          nextSteps: 'Follow up in 2 weeks with updated prototype/plan.',
        },
      })
    )
  )

  // ── Stipend Records ───────────────────────────────────────────────────────
  const stipendStatuses = [
    StipendStatus.Eligible,
    StipendStatus.Eligible,
    StipendStatus.Pending,
    StipendStatus.Eligible,
    StipendStatus.Eligible,
  ]

  for (let i = 0; i < profiles.length; i++) {
    for (let m = 0; m < 3; m++) {
      const periodStart = startOfMonth(addMonths(new Date('2024-06-01'), m))
      const periodEnd = endOfMonth(periodStart)
      const status = m < 2 ? stipendStatuses[i] : StipendStatus.Pending
      await prisma.stipendRecord.create({
        data: {
          innovatorId: profiles[i].id,
          periodStart,
          periodEnd,
          hoursCompleted: m < 2 ? Math.random() * 10 + 4 : 0,
          amount: 1000,
          status,
          paidAt: status === StipendStatus.Eligible && m < 2 ? addDays(periodEnd, 5) : null,
        },
      })
    }
  }

  // ── M&E — Theory of Change ────────────────────────────────────────────────
  await prisma.theoryOfChange.create({
    data: {
      programmeId: tia.id,
      problem:
        'South African youth entrepreneurs face structural barriers to scaling innovative businesses: lack of access to mentors, markets, funding, and readiness measurement frameworks.',
      vision:
        'A thriving ecosystem of market-ready, sustainable youth-led innovative businesses contributing to inclusive economic growth.',
      inputs:
        'Government funding via TIA and DSTI, programme management staff, pool of experienced business and technical mentors, assessment frameworks, digital platform (Innovalanga Hub).',
      activities:
        'Cohort intake and onboarding, structured mentorship sessions, readiness assessments at 5 intervals, stipend disbursements for active participation, facilitator check-ins, IP protection guidance.',
      outputs:
        'Number of innovators mentored, assessments completed per period, hours of mentorship delivered, stipends disbursed, business plans developed or revised.',
      outcomes:
        'Increased TRL/BRL/IRL/MRL scores across cohorts, improved business viability, increased access to finance applications, strengthened mentor–innovator relationships.',
      impact:
        'Sustainable job creation, commercialisation of locally-developed technologies, demonstrable contribution to South Africa\'s STI sector and GDP growth.',
      assumptions:
        'Innovators remain active and engaged throughout the programme period. Mentors maintain availability. Funding disbursements are on time. Policy environment remains supportive.',
    },
  })

  // ── M&E — Logframe ────────────────────────────────────────────────────────
  const logframeRows = [
    {
      level: 'Impact' as const,
      order: 0,
      description: 'Sustainable, scalable youth-led innovation businesses contributing to inclusive growth',
      indicators: 'Number of businesses operational 12 months post-programme; revenue growth',
      verificationMeans: 'Post-programme tracer study, SARS filings',
      assumptions: 'Macro-economic environment supportive; access to markets maintained',
    },
    {
      level: 'Outcome' as const,
      order: 0,
      description: 'Innovators demonstrate increased business, technology, and market readiness',
      indicators: 'Average TRL/BRL/IRL/MRL scores at final assessment vs baseline',
      verificationMeans: 'Innovalanga Hub assessment records',
      assumptions: 'Innovators engage consistently with mentors and complete all assessments',
    },
    {
      level: 'Outcome' as const,
      order: 1,
      description: 'Innovators successfully apply for external funding or market entry',
      indicators: '% of innovators submitting funding applications; number of pilot customers',
      verificationMeans: 'Application records, facilitator reports',
      assumptions: 'Funding landscape remains accessible; market entry barriers manageable',
    },
    {
      level: 'Output' as const,
      order: 0,
      description: 'Structured mentorship sessions delivered across all cohorts',
      indicators: 'Number of sessions completed; average hours per innovator',
      verificationMeans: 'Innovalanga Hub session logs',
      assumptions: 'Mentors maintain availability; booking system functions correctly',
    },
    {
      level: 'Output' as const,
      order: 1,
      description: 'Readiness assessments completed at all 5 programme intervals',
      indicators: 'Number of assessments completed per period (target: 100% of active innovators)',
      verificationMeans: 'Assessment records in Innovalanga Hub',
      assumptions: 'Innovators remain active; facilitators conduct assessments on schedule',
    },
    {
      level: 'Activity' as const,
      order: 0,
      description: 'Cohort intake, onboarding, and platform orientation',
      indicators: 'Number of innovators enrolled and onboarded',
      verificationMeans: 'Registration records, attendance sheets',
      assumptions: 'Eligible applicants identified and selected on time',
    },
    {
      level: 'Activity' as const,
      order: 1,
      description: 'Monthly mentorship sessions scheduled and delivered',
      indicators: 'Number of sessions per month',
      verificationMeans: 'Booking logs, mentorship logs',
      assumptions: 'Innovators actively book and attend sessions',
    },
    {
      level: 'Input' as const,
      order: 0,
      description: 'Programme funding: TIA and DSTI budget allocation',
      indicators: 'Total budget approved (ZAR)',
      verificationMeans: 'Signed MOU, budget approvals',
      assumptions: 'Funding released on schedule',
    },
    {
      level: 'Input' as const,
      order: 1,
      description: 'Mentor pool: 3+ experienced business and technical mentors per cohort',
      indicators: 'Number of active mentors',
      verificationMeans: 'Mentor profiles on Innovalanga Hub',
      assumptions: 'Mentors are available and retain expertise relevant to cohort sectors',
    },
  ]
  for (const row of logframeRows) {
    await prisma.logFrameItem.create({ data: { programmeId: tia.id, ...row } })
  }

  // ── M&E — Indicators ──────────────────────────────────────────────────────
  const indicatorsData = [
    {
      name: 'Total innovators enrolled',
      type: 'Process' as const,
      unit: 'innovators',
      baseline: 0,
      target: 20,
      frequency: 'Annual' as const,
    },
    {
      name: 'Assessments completed',
      type: 'Output' as const,
      unit: 'assessments',
      baseline: 0,
      target: 100,
      frequency: 'Quarterly' as const,
    },
    {
      name: 'Mentorship sessions delivered',
      type: 'Output' as const,
      unit: 'sessions',
      baseline: 0,
      target: 60,
      frequency: 'Monthly' as const,
    },
    {
      name: 'Average TRL score improvement (Baseline → Final)',
      type: 'Outcome' as const,
      unit: 'points',
      baseline: 0,
      target: 2,
      frequency: 'SemiAnnual' as const,
    },
    {
      name: 'Innovators with complete assessment journey (all 5 periods)',
      type: 'Outcome' as const,
      unit: 'innovators',
      baseline: 0,
      target: 15,
      frequency: 'Annual' as const,
    },
    {
      name: 'Stipends disbursed',
      type: 'Process' as const,
      unit: 'ZAR',
      baseline: 0,
      target: 240000,
      frequency: 'Quarterly' as const,
    },
  ]
  const createdIndicators: Record<string, string> = {}
  for (const ind of indicatorsData) {
    const created = await prisma.indicator.create({ data: { programmeId: tia.id, ...ind } })
    createdIndicators[ind.name] = created.id
  }

  // Seed some indicator records
  const enrolledId = createdIndicators['Total innovators enrolled']
  if (enrolledId) {
    await prisma.indicatorRecord.create({
      data: {
        indicatorId: enrolledId,
        periodLabel: 'Cohort 1 — 2024',
        periodStart: new Date('2024-06-01'),
        periodEnd: new Date('2024-06-30'),
        value: 10,
        notes: 'Initial cohort enrolled across GS and FD regions',
        recordedBy: 'Admin',
      },
    })
  }
  const sessionsId = createdIndicators['Mentorship sessions delivered']
  if (sessionsId) {
    await prisma.indicatorRecord.createMany({
      data: [
        {
          indicatorId: sessionsId,
          periodLabel: 'June 2024',
          periodStart: new Date('2024-06-01'),
          periodEnd: new Date('2024-06-30'),
          value: 8,
          notes: 'Initial month — lower uptake expected',
          recordedBy: 'Admin',
        },
        {
          indicatorId: sessionsId,
          periodLabel: 'July 2024',
          periodStart: new Date('2024-07-01'),
          periodEnd: new Date('2024-07-31'),
          value: 14,
          recordedBy: 'Admin',
        },
      ],
    })
  }

  // ── M&E — Beneficiary Counts ──────────────────────────────────────────────
  await prisma.beneficiaryCount.create({
    data: {
      programmeId: tia.id,
      periodLabel: 'Q1 2024 (June–August)',
      periodStart: new Date('2024-06-01'),
      periodEnd: new Date('2024-08-31'),
      direct: 10,
      indirect: 40,
      female: 4,
      youth: 9,
      pwd: 1,
      notes: 'Cohort 1 first quarter — all regions combined',
      recordedBy: 'Admin',
    },
  })

  // ── M&E — Milestones ──────────────────────────────────────────────────────
  const milestoneData = [
    {
      title: 'Baseline assessments complete for all innovators',
      description: 'All enrolled innovators must complete TRL/BRL/IRL/MRL baseline assessment',
      targetDate: new Date('2024-07-15'),
      completedDate: new Date('2024-07-12'),
      status: 'Completed' as const,
    },
    {
      title: 'Month 3 assessments complete',
      description: 'Second assessment round across all active innovators',
      targetDate: new Date('2024-09-15'),
      completedDate: new Date('2024-09-18'),
      status: 'Completed' as const,
    },
    {
      title: 'Month 6 assessments complete',
      description: 'Mid-programme assessment — check for score stagnation',
      targetDate: new Date('2024-12-15'),
      status: 'InProgress' as const,
    },
    {
      title: '60 mentorship sessions delivered',
      description: 'Cumulative target: 60 completed 1-on-1 sessions across all mentors',
      targetDate: new Date('2025-03-31'),
      status: 'InProgress' as const,
    },
    {
      title: 'Final assessments and programme wrap-up',
      description: 'All five assessment periods complete; funder report submitted',
      targetDate: new Date('2025-06-30'),
      status: 'NotStarted' as const,
    },
    {
      title: 'Post-programme tracer study — 12 month follow-up',
      description: 'Survey graduates on business viability and employment outcomes',
      targetDate: new Date('2026-06-30'),
      status: 'NotStarted' as const,
    },
  ]
  for (const m of milestoneData) {
    await prisma.milestoneTracker.create({ data: { programmeId: tia.id, ...m } })
  }

  // ── IP Assessments ────────────────────────────────────────────────────────
  // Seed IP assessments for the first two innovators
  if (profiles.length >= 2) {
    await prisma.iPAssessment.create({
      data: {
        innovatorId: profiles[0].id,
        answers: {
          technical_invention: 'yes',
          novel_and_not_disclosed: 'yes',
          brand_identity: 'yes',
          creative_content: 'yes',
          trade_secret: 'no',
          already_protected: 'no',
          export_intent: 'yes',
          stage: 'pilot',
        },
        recommendations: ['PatentRequired', 'TrademarkRequired', 'CopyrightApplicable', 'MultipleProtection'],
        primaryRec: 'MultipleProtection',
        reasoning: 'Your innovation is a novel technical invention that has not been publicly disclosed — patent protection should be pursued urgently before any public disclosure. You have a distinctive brand identity — trademark registration will protect your name, logo, or slogan from being used by competitors. Your work includes original creative expression — copyright protects this automatically, but formal registration or assignment agreements with collaborators are recommended. Given your international commercialisation plans, consider PCT and Madrid Protocol filings.',
        status: 'ApplicationPending',
        advisorNotes: 'Referred to TIA IP Support desk. Provisional patent application to be filed by end of Q3 2024.',
        reviewedBy: 'Facilitator',
        reviewedAt: new Date('2024-08-15'),
      },
    })

    await prisma.iPAssessment.create({
      data: {
        innovatorId: profiles[1].id,
        answers: {
          technical_invention: 'no',
          novel_and_not_disclosed: 'yes',
          brand_identity: 'yes',
          creative_content: 'yes',
          trade_secret: 'no',
          already_protected: 'no',
          export_intent: 'no',
          stage: 'market',
        },
        recommendations: ['TrademarkRequired', 'CopyrightApplicable'],
        primaryRec: 'TrademarkRequired',
        reasoning: 'You have a distinctive brand identity — trademark registration will protect your name, logo, or slogan from being used by competitors. Your work includes original creative expression — copyright protects this automatically.',
        status: 'Assessed',
      },
    })
  }

  // ── Audit Log ─────────────────────────────────────────────────────────────
  await prisma.auditLog.create({
    data: {
      innovatorId: profiles[0].id,
      action: 'assessment.created',
      entityType: 'Assessment',
      entityId: 'seed',
      diff: { period: 'baseline', trl: 2, brl: 1, irl: 2, mrl: 1 },
    },
  })

  console.log('\nSeed complete!')
  console.log('\nTest accounts:')
  console.log('  admin@innovalanga.co.za        / Admin@1234')
  console.log('  facilitator@innovalanga.co.za  / Facilitator@1234')
  console.log('  mentor1@innovalanga.co.za      / Mentor@1234')
  console.log('  funder@tia.gov.za              / Funder@1234')
  console.log('  zanele@innovalanga.co.za       / Innovator@1234')
  console.log('\nMentor booking slugs:')
  console.log('  /book/sipho-nkosi')
  console.log('  /book/thandi-mokoena')
  console.log('  /book/kabelo-sithole')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
