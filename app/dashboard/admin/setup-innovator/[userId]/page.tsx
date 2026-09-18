import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { InnovatorSetupForm } from './InnovatorSetupForm'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface Props {
  params: Promise<{ userId: string }>
}

export default async function SetupInnovatorPage(props: Props) {
  const params = await props.params;
  const session = await getSession()
  if (!session || !['super_admin', 'facilitator'].includes(session.user.role)) {
    redirect('/dashboard')
  }

  const [user, cohorts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.userId },
      include: { innovatorProfile: true },
    }),
    prisma.cohort.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, programmeId: true, region: { select: { id: true, name: true } } },
    }),
  ])

  if (!user) notFound()
  if (user.role !== 'innovator') redirect('/dashboard/admin')
  if (user.innovatorProfile) redirect(`/dashboard/innovators/${user.innovatorProfile.id}`)

  const nameParts = user.name.split(' ')
  const defaultFirst = nameParts[0] ?? ''
  const defaultLast = nameParts.slice(1).join(' ') ?? ''

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/admin">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Set Up Innovator Profile</h1>
          <p className="text-muted-foreground mt-0.5">
            Completing onboarding for <strong>{user.name}</strong> ({user.email})
          </p>
        </div>
      </div>

      <InnovatorSetupForm
        userId={user.id}
        cohorts={cohorts}
        defaultFirstName={defaultFirst}
        defaultLastName={defaultLast}
      />
    </div>
  )
}
