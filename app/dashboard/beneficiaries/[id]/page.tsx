import { getSession } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { ArrowLeft } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { tenantScope } from '@/lib/tenant-db'
import { SignedForm } from './SignedForm'
import { ReviewActions } from './ReviewActions'
import type { BeneficiaryValues } from '@/components/beneficiary/BeneficiaryFormFields'

function yesNo(v: boolean | null): string {
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  return ''
}

export default async function BeneficiaryPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession()
  if (!session) redirect('/login')
  if (!['super_admin', 'facilitator'].includes(session.user.role)) redirect('/dashboard')

  const scope = await tenantScope(session)
  if (!scope) redirect('/dashboard')
  // Bound to `prisma` so the queries below are unchanged. This connection
  // cannot see another programme even if a query forgets to say so.
  const { programmeId, db: prisma } = scope

  const r = await prisma.beneficiaryRecord.findFirst({
    where: { id: params.id, programmeId },
  })
  if (!r) notFound()

  // The ID number is never decrypted for display. Its presence is confirmed;
  // its value stays where it was put.
  const idNumberMasked = r.idNumberEncrypted ? '••••••••• on file' : null

  const values: BeneficiaryValues = {
    fullName: r.fullName,
    idNumber: '',
    gender: r.gender ?? '',
    hasDisability: yesNo(r.hasDisability),
    race: r.race ?? '',
    raceOther: r.raceOther ?? '',
    title: r.title ?? '',
    titleOther: r.titleOther ?? '',
    physicalAddress: r.physicalAddress ?? '',
    cellphone: r.cellphone ?? '',
    localMunicipality: r.localMunicipality ?? '',
    alternativeNumber: r.alternativeNumber ?? '',
    districtMunicipality: r.districtMunicipality ?? '',
    email: r.email,
    province: r.province ?? '',
    hasInnovativeIdea: yesNo(r.hasInnovativeIdea),
    conceptDescription: r.conceptDescription ?? '',
    projectTitle: r.projectTitle ?? '',
    developmentStage: r.developmentStage ?? '',
    sector: r.sector ?? '',
    supportRequired: r.supportRequired ?? '',
    otherInformation: r.otherInformation ?? '',
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="print:hidden">
        <PageHeader
          title={r.fullName}
          description={
            r.status === 'Accepted'
              ? 'Signed and accepted. This record is locked.'
              : r.status === 'AwaitingAcceptance'
                ? 'Signed by the beneficiary, awaiting acceptance by the centre.'
                : 'Draft, not yet signed.'
          }
          actions={
            <div className="flex items-center gap-3">
              <Badge variant={r.status === 'Accepted' ? 'default' : 'secondary'}>
                {r.status === 'AwaitingAcceptance' ? 'Awaiting acceptance' : r.status}
              </Badge>
              <Button variant="ghost" asChild>
                <Link href="/dashboard/beneficiaries">
                  <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />
                  Back
                </Link>
              </Button>
            </div>
          }
        />
      </div>

      {r.status === 'AwaitingAcceptance' && r.userId !== session.user.id && (
        <ReviewActions recordId={r.id} />
      )}

      {r.returnedReason && r.status === 'Draft' && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm print:hidden">
          <p className="font-medium">Returned for correction</p>
          <p className="mt-1 text-muted-foreground">{r.returnedReason}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            The signature was voided. The beneficiary signs again once corrected.
          </p>
        </div>
      )}

      <SignedForm
        values={values}
        idNumberMasked={idNumberMasked}
        signature={{
          name: r.beneficiarySignedName,
          at: r.beneficiarySignedAt ? formatDateTime(r.beneficiarySignedAt) : null,
          image: r.beneficiarySignatureImage,
        }}
        acceptance={{
          name: r.acceptedByName,
          at: r.acceptedAt ? formatDateTime(r.acceptedAt) : null,
          image: r.acceptanceSignatureImage,
        }}
      />

      {/* The circumstances of signing. Kept off the printed form, which is the
          funder's document, but available to anyone auditing the record. */}
      {r.beneficiarySignedAt && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground print:hidden">
          <p className="mb-2 font-medium text-foreground">Signature record</p>
          <dl className="grid gap-1 sm:grid-cols-2">
            <div>Signed: {formatDateTime(r.beneficiarySignedAt)}</div>
            <div>From: {r.beneficiarySignedIp ?? 'unknown'}</div>
            {r.acceptedAt && <div>Accepted: {formatDateTime(r.acceptedAt)}</div>}
            {r.acceptedIp && <div>From: {r.acceptedIp}</div>}
          </dl>
          {r.beneficiarySignedHash && (
            <p className="mt-2 break-all font-mono">
              Content fingerprint: {r.beneficiarySignedHash.slice(0, 32)}…
            </p>
          )}
        </div>
      )}
    </div>
  )
}
