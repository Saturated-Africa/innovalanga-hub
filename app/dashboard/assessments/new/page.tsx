import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { AssessmentForm } from './AssessmentForm'

interface Props {
  searchParams: { innovatorId?: string }
}

export default async function NewAssessmentPage({ searchParams }: Props) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const innovators = await prisma.innovatorProfile.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      businessName: true,
      cohort: { select: { programmeId: true } },
    },
    orderBy: { lastName: 'asc' },
  })

  // Fetch existing assessments to check what periods are taken
  const existingAssessments = await prisma.assessment.findMany({
    where: { innovatorId: { in: innovators.map((i) => i.id) } },
    select: { innovatorId: true, period: true, trlScore: true, brlScore: true, irlScore: true, mrlScore: true },
  })

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Assessment</h1>
        <p className="text-muted-foreground mt-1">Record TRL, BRL, IRL, and MRL scores for an innovator</p>
      </div>
      <AssessmentForm
        innovators={innovators}
        existingAssessments={existingAssessments}
        defaultInnovatorId={searchParams.innovatorId}
        assessorName={session.user.name ?? 'Unknown'}
      />
    </div>
  )
}
