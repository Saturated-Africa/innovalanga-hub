'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'
import {
  BeneficiaryFormFields,
  type BeneficiaryValues,
} from '@/components/beneficiary/BeneficiaryFormFields'

/**
 * A completed form, and the thing that prints.
 *
 * It renders the same field component as the capture screen, so the printed
 * copy cannot show a different layout or a different set of fields from the one
 * that was signed. Print rules live in globals.css under `@media print`.
 *
 * `next/image` is not used for the signatures: they are PNG data URLs held in
 * the record, and the optimiser is disabled for this deployment anyway.
 */
export function SignedForm({
  values,
  idNumberMasked,
  signature,
  acceptance,
}: {
  values: BeneficiaryValues
  idNumberMasked: string | null
  signature: {
    name: string | null
    at: string | null
    image: string | null
  }
  acceptance: {
    name: string | null
    at: string | null
    image: string | null
  }
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" aria-hidden />
          Print or save as PDF
        </Button>
      </div>

      <div className="print-form">
        <PartnerHeader />

        {/* The funder's own title, so a printed page is recognisable as their
            form rather than as a screenshot of software. */}
        <h2 className="mb-3 text-center text-sm font-semibold uppercase tracking-widest">
          Beneficiary Capturing Form
        </h2>

        <BeneficiaryFormFields
          values={values}
          onChange={() => {}}
          readOnly
          idNumberMasked={idNumberMasked}
        />

        {/* ── Signatures ─────────────────────────────────────────────── */}
        <div className="border border-border bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider print:bg-transparent">
          Signatures
        </div>

        <SignatureBlock
          heading="Beneficiary"
          name={signature.name}
          at={signature.at}
          image={signature.image}
        />

        <div className="border border-border bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider print:bg-transparent">
          Acceptance by the Centre
        </div>

        <SignatureBlock
          heading="Name and Surname"
          name={acceptance.name}
          at={acceptance.at}
          image={acceptance.image}
        />
      </div>
    </div>
  )
}

/**
 * The partner header carried by every printed form.
 *
 * Order is fixed by the funder: the department first on the left, then the
 * programme, then the implementing agency, then TIA last on the right.
 *
 * All four assets are pre-cropped to a common height, so a uniform CSS height
 * puts them on one optical baseline despite their different aspect ratios.
 * They are plain `img` tags rather than `next/image` because the optimiser is
 * disabled on this deployment, and because an optimiser that fails silently in
 * a print view would leave a compliance document with no logos on it.
 */
function PartnerHeader() {
  const logos = [
    { src: '/brand/partners/dsti.png', alt: 'Department of Science, Technology and Innovation' },
    { src: '/brand/partners/innovalanga.png', alt: 'Innovalanga' },
    { src: '/brand/partners/saturated.png', alt: 'Saturated Africa' },
    { src: '/brand/partners/tia.png', alt: 'Technology Innovation Agency' },
  ]

  return (
    <div className="print-keep mb-4 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        {logos.map((logo) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={logo.src}
            src={logo.src}
            alt={logo.alt}
            className="h-9 w-auto shrink-0 object-contain sm:h-11 print:h-10"
          />
        ))}
      </div>
    </div>
  )
}

function SignatureBlock({
  heading,
  name,
  at,
  image,
}: {
  heading: string
  name: string | null
  at: string | null
  image: string | null
}) {
  return (
    <div className="print-keep grid grid-cols-1 border border-border sm:grid-cols-3">
      <div className="space-y-1 p-3 sm:border-r sm:border-border">
        <p className="text-xs text-muted-foreground">{heading}</p>
        <p className="text-sm font-medium">{name ?? '—'}</p>
      </div>
      <div className="space-y-1 p-3 sm:border-r sm:border-border">
        <p className="text-xs text-muted-foreground">Signature</p>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={`${heading} signature`} className="h-14 w-auto" />
        ) : (
          <p className="text-sm">—</p>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="text-xs text-muted-foreground">Date</p>
        <p className="text-sm">{at ?? '—'}</p>
      </div>
    </div>
  )
}
