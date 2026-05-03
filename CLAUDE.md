# Innovalanga Hub — Claude Code Context

## Project overview

Innovalanga Hub is a full-stack innovation progress tracker for a South African
government-backed entrepreneurship programme operating under TIA (Technology Innovation
Agency) and DSTI (Department of Science, Technology and Innovation). It tracks the
business, technological, and personal development progress of youth innovators across
two districts: Gert Sibande (Mpumalanga) and Fezile Dabi (Free State).

This is NOT a learning management system. There are no courses, lessons, or quizzes.
It is a structured readiness measurement, mentorship scheduling, and programme reporting
platform.

---

## Tech stack

- **Framework:** Next.js 14 (App Router), TypeScript
- **Styling:** Tailwind CSS, shadcn/ui
- **Database:** PostgreSQL via Prisma ORM
- **Auth:** NextAuth.js (role-based)
- **Storage:** AWS S3 (or Cloudflare R2) for file uploads
- **Charts:** Recharts (RadarChart, LineChart, BarChart, PieChart)
- **Email:** Resend
- **Calendar:** Google Calendar API (OAuth) — optional per mentor
- **PDF export:** React PDF or jsPDF
- **Deployment:** Vercel + Railway/Supabase

---

## Commands

```bash
npm run dev          # Start dev server at localhost:3000
npm run build        # Production build
npm run typecheck    # Run TypeScript type checks
npx prisma migrate dev --name <name>   # Run DB migration
npx prisma db seed   # Seed database with sample data
npx prisma studio    # Open DB browser at localhost:5555
```

---

## Directory structure

```
app/                  # Next.js App Router pages and layouts
  (auth)/             # Login, register routes
  dashboard/          # All protected dashboard routes
    innovators/       # Innovator list and profiles
    assessments/      # Assessment creation and history
    cohorts/          # Cohort management
    mentorship/       # Enriched mentorship log
    sessions/         # Booking and session views (mentor)
    book/             # Innovator booking flow
    stipends/         # Stipend tracker
    reports/          # Programme KPI dashboard
    mentor/           # Mentor availability setup
    innovator/        # Innovator session view
components/           # Reusable UI components (see key components below)
lib/                  # Utilities, helpers, auth config
prisma/               # Schema, migrations, seed file
  schema.prisma
  seed.ts
```

---

## User roles

| Role | Access |
|---|---|
| super_admin | Full access to all modules |
| facilitator | Assessments, cohorts, innovator profiles, stipends |
| mentor | Availability setup, session booking, mentorship log |
| innovator | Own profile, booking flow, session history (read-only) |
| funder_viewer | Reports only, no PII |

All `/dashboard/*` routes are protected by NextAuth middleware. Role-aware redirects
on login. Menu items show/hide based on role.

---

## Core measurement framework

Every innovator is assessed on three scales (1–9) at five intervals:
Baseline, Month 3, Month 6, Month 9, Final.

**TRL** — Technology Readiness Level (concept through operational deployment)
**BRL** — Business Readiness Level (idea through investment-ready)
**IRL** — Innovation Readiness Level (awareness through ecosystem influence)

Assessment records are locked after submission. Scores cannot drop more than 2 points
between periods without a written justification. All three scores required before submit.

---

## Key components to build

- `ReadinessScoreCard` — TRL/BRL/IRL score, delta badge, level label
- `RadarSnapshot` — RadarChart for TRL/BRL/IRL vs cohort average
- `TrajectoryChart` — LineChart of score over assessment periods
- `AssessmentTimeline` — vertical timeline of assessment records
- `SessionTimer` — live clock, end session button, post-session prompt
- `AvailabilityGrid` — weekly slot selector (day × time block)
- `BookingCalendar` — date picker (available/unavailable days)
- `TimeSlotPicker` — slot list for a selected date
- `BookingStatusBadge` — Confirmed / In Progress / Completed / Cancelled / No-show
- `StipendStatusBadge` — Eligible / Not Eligible / Pending / Override
- `DataTable` — search, filter, sort, pagination, CSV export (used on all list views)
- `DocumentVault` — upload + list with document type tags
- `AuditLog` — read-only timestamped change log
- `GoogleCalendarConnectButton` — OAuth trigger + sync status

---

## Scheduling module rules (implement carefully)

1. **Slot generation:** available slots = recurring weekly availability MINUS
   booked slots (+buffer) MINUS Google Calendar busy periods MINUS date overrides
   MINUS blackout periods. Computed server-side on demand.

2. **Timezone:** all times stored as UTC in the database. All display converts to
   SAST (Africa/Johannesburg, UTC+2). Never store SAST directly.

3. **Concurrency:** use a DB-level transaction when creating a booking to prevent
   two innovators booking the same slot simultaneously. Return a clear error message
   if the slot is taken between selection and confirmation.

4. **Auto-completion cron** (runs every 15 min via Vercel cron):
   - Confirmed bookings with no start action 15+ min past scheduled start →
     status: NoShowPendingReview
   - InProgress bookings with no end action 30+ min past scheduled end →
     status: Completed, actual duration = scheduled duration

5. **Actual duration:** timestamp diff between
   `PATCH /bookings/[id]/start` and `PATCH /bookings/[id]/complete`.

6. **Stipend hours:** SUM of actualDurationMinutes for Completed bookings within
   a period's date range ÷ 60. Recalculated on demand, cached on StipendRecord.

7. **Booking restriction:** an innovator can only have 1 confirmed upcoming booking
   at a time. Second booking only allowed after first is Completed or Cancelled.

---

## Data and localisation rules

- SA ID number: 13-digit validation, encrypted at rest, masked in all UI after save
- Date format: DD/MM/YYYY throughout all UI
- Timezone: always display SAST (UTC+2), store UTC
- Currency: ZAR, default stipend R1,000 per month
- Phone: accept +27 or 0XX format

---

## Environment variables required

```
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
RESEND_API_KEY
ENCRYPTION_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_CALENDAR_REDIRECT_URI
CRON_SECRET
```

---

## Build phases — work in this order

### Phase 1 — Foundation
- Scaffold Next.js 14 with TypeScript, Tailwind, shadcn/ui
- Set up Prisma schema with all models; run migration
- Seed: 2 cohorts, 5 innovators, 3 mentors, 3 assessments per innovator,
  sample bookings (mix of statuses), sample stipend records
- NextAuth with role-based middleware on all /dashboard/* routes

### Phase 2 — Core progress tracking
- /login
- /dashboard (role-aware redirect)
- /dashboard/innovators (list + profile page with radar chart, timeline, documents)
- /dashboard/assessments/new (TRL/BRL/IRL scoring form)
- /dashboard/cohorts (list + detail with group charts)

### Phase 3 — Scheduling engine
- /dashboard/mentor/availability (weekly availability setup)
- /dashboard/book/[mentorId] (3-step booking flow)
- /dashboard/sessions (mentor: today, upcoming, past + session timer)
- /dashboard/innovator/sessions (innovator session view)
- Google Calendar OAuth connect + event sync

### Phase 4 — Operations and reporting
- /dashboard/mentorship (enriched log from completed bookings)
- /dashboard/stipends (monthly register + hours column + CSV export)
- /dashboard/reports (programme KPIs + funder PDF/XLSX export)
- Notification centre + all email triggers via Resend

**Always confirm a phase is working before starting the next.**

---

## Out of scope for v1

- Courses, lessons, quizzes (this is not an LMS)
- Payment gateway
- Group bookings (1-on-1 only)
- Video/call integration (Zoom links added manually)
- Native mobile app
- Multi-language UI (add i18n hooks only, do not implement translations)
- DSBD or SEDA references (programme is TIA and DSTI only)

---

## Reference documents

Additional detail on modules is in `docs/` (create this folder):

- `docs/modules.md` — full module specifications
- `docs/schema.md` — complete Prisma schema reference
- `docs/api.md` — all API endpoint definitions
- `docs/scheduling-logic.md` — full scheduling business logic
