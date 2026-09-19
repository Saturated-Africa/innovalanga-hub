import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/shared/PageHeader'
import { formatDateTime } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { MyFormClient } from './MyFormClient'
import { EMPTY_BENEFICIARY, type BeneficiaryValues } from '@/components/beneficiary/BeneficiaryFormFields'

function yesNo(v: boolean | null): string {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return ''
}

export default async function MyBeneficiaryFormPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  // Scoped to the caller's own record by user id, so this page cannot show
  // anybody else's form regardless of what the API allows.
  const record = await prisma.beneficiaryRecord.findFirst({
    where: { programmeId, userId: session.user.id },
  })

  const values: BeneficiaryValues = record
    ? {
        fullName: record.fullName,
        idNumber: '',
        // The stored date, unlike the ID number, which is never sent back.
        dateOfBirth: record.dateOfBirth
          ? record.dateOfBirth.toISOString().slice(0, 10)
          : '',
        gender: record.gender ?? '',
        hasDisability: yesNo(record.hasDisability),
        race: record.race ?? '',
        raceOther: record.raceOther ?? '',
        title: record.title ?? '',
        titleOther: record.titleOther ?? '',
        physicalAddress: record.physicalAddress ?? '',
        cellphone: record.cellphone ?? '',
        localMunicipality: record.localMunicipality ?? '',
        alternativeNumber: record.alternativeNumber ?? '',
        districtMunicipality: record.districtMunicipality ?? '',
        email: record.email,
        province: record.province ?? '',
        hasInnovativeIdea: yesNo(record.hasInnovativeIdea),
        conceptDescription: record.conceptDescription ?? '',
        projectTitle: record.projectTitle ?? '',
        developmentStage: record.developmentStage ?? '',
        sector: record.sector ?? '',
        supportRequired: record.supportRequired ?? '',
        otherInformation: record.otherInformation ?? '',
      }
    : { ...EMPTY_BENEFICIARY, email: session.user.email ?? '', fullName: session.user.name ?? '' }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Beneficiary Capturing Form"
        description="Required by the programme funder. Complete it, sign it, and a facilitator will approve it."
      />
      <MyFormClient
        recordId={record?.id ?? null}
        status={(record?.status ?? 'None') as 'None' | 'Draft' | 'AwaitingAcceptance' | 'Accepted' | 'Withdrawn'}
        initial={values}
        returnedReason={record?.returnedReason ?? null}
        signedAt={record?.beneficiarySignedAt ? formatDateTime(record.beneficiarySignedAt) : null}
        acceptedAt={record?.acceptedAt ? formatDateTime(record.acceptedAt) : null}
      />
    </div>
  )
}
