'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { GENDERS, RACES, TITLES, PROVINCES, deriveFromIdNumber } from '@/lib/beneficiary-form'

/**
 * The Beneficiary Capturing Form, laid out as the funder issues it.
 *
 * Section order, field order and the option sets follow the paper form exactly,
 * including the two-column arrangement of the contact block, so a person
 * holding the printed version and a person looking at the screen are reading
 * the same document.
 *
 * The same component renders the editable and the read-only view. A printed
 * copy that was generated from different markup than the screen is a copy that
 * can disagree with what was signed.
 */

export interface BeneficiaryValues {
  fullName: string
  idNumber: string
  dateOfBirth: string
  gender: string
  hasDisability: string // 'yes' | 'no' | ''
  race: string
  raceOther: string
  title: string
  titleOther: string
  physicalAddress: string
  cellphone: string
  localMunicipality: string
  alternativeNumber: string
  districtMunicipality: string
  email: string
  province: string
  hasInnovativeIdea: string // 'yes' | 'no' | ''
  conceptDescription: string
  projectTitle: string
  developmentStage: string
  sector: string
  supportRequired: string
  otherInformation: string
}

export const EMPTY_BENEFICIARY: BeneficiaryValues = {
  fullName: '',
  idNumber: '',
  dateOfBirth: '',
  gender: '',
  hasDisability: '',
  race: '',
  raceOther: '',
  title: '',
  titleOther: '',
  physicalAddress: '',
  cellphone: '',
  localMunicipality: '',
  alternativeNumber: '',
  districtMunicipality: '',
  email: '',
  province: '',
  hasInnovativeIdea: '',
  conceptDescription: '',
  projectTitle: '',
  developmentStage: '',
  sector: '',
  supportRequired: '',
  otherInformation: '',
}

const SECTION =
  'border border-border bg-muted/50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-foreground print:bg-transparent'

function Section({ children }: { children: React.ReactNode }) {
  return <div className={SECTION}>{children}</div>
}

/** A labelled cell, matching one box on the paper form. */
function Cell({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="print-keep space-y-1.5 border border-border p-3">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

/** Radio row. The paper form uses ticked boxes; these are the same choices. */
function Choice({
  name,
  options,
  value,
  onChange,
  readOnly,
}: {
  name: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  readOnly: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            disabled={readOnly}
            className="h-4 w-4 accent-brand-volt-deep"
          />
          {option}
        </label>
      ))}
    </div>
  )
}

export function BeneficiaryFormFields({
  values,
  onChange,
  readOnly = false,
  idNumberMasked,
}: {
  values: BeneficiaryValues
  onChange: (patch: Partial<BeneficiaryValues>) => void
  readOnly?: boolean
  /** Shown instead of the input once a form is signed. */
  idNumberMasked?: string | null
}) {
  const set =
    (field: keyof BeneficiaryValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ [field]: e.target.value } as Partial<BeneficiaryValues>)

  const selectClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-100'

  return (
    <div className="space-y-0">
      {/* ── PERSONAL INFORMATION ───────────────────────────────────────── */}
      <Section>Personal Information</Section>

      <Cell label="Name and Surname" htmlFor="fullName">
        <Input
          id="fullName"
          value={values.fullName}
          onChange={set('fullName')}
          disabled={readOnly}
          required
        />
      </Cell>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        <Cell label="ID Number" htmlFor="idNumber">
          {readOnly ? (
            <p className="py-2 font-mono text-sm">{idNumberMasked ?? '—'}</p>
          ) : (
            <Input
              id="idNumber"
              value={values.idNumber}
              onChange={(e) => {
                const idNumber = e.target.value
                // Fill the date of birth from the ID, but only while the field is
                // empty. Overwriting a date somebody typed would hide a mismatch
                // that the server is about to refuse - and a mismatch is the
                // signal that one of the two is mistyped.
                const derived =
                  values.dateOfBirth === ''
                    ? deriveFromIdNumber(idNumber)?.dateOfBirth
                    : null
                // A patch, not the whole object: sending everything back would
                // re-assert values the parent may have changed since this render.
                onChange({
                  idNumber,
                  ...(derived
                    ? { dateOfBirth: derived.toISOString().slice(0, 10) }
                    : {}),
                })
              }}
              inputMode="numeric"
              maxLength={13}
              placeholder="13 digits"
            />
          )}
        </Cell>
        <Cell label="Date of birth" htmlFor="dateOfBirth">
          <Input
            id="dateOfBirth"
            type="date"
            value={values.dateOfBirth}
            onChange={set('dateOfBirth')}
            disabled={readOnly}
          />
          {!readOnly && (
            <p className="mt-1 text-xs text-muted-foreground">
              Filled in from the ID number when one is entered. Asked for separately
              because the ID is optional, and without a date of birth this person cannot
              be counted in a youth figure.
            </p>
          )}
        </Cell>
        <Cell label="Gender">
          <Choice
            name="gender"
            options={GENDERS}
            value={values.gender}
            onChange={(v) => onChange({ gender: v })}
            readOnly={readOnly}
          />
        </Cell>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        <Cell label="Are you disabled?">
          <Choice
            name="hasDisability"
            options={['Yes', 'No']}
            value={values.hasDisability}
            onChange={(v) => onChange({ hasDisability: v })}
            readOnly={readOnly}
          />
        </Cell>
        <Cell label="Race">
          <Choice
            name="race"
            options={RACES}
            value={values.race}
            onChange={(v) => onChange({ race: v })}
            readOnly={readOnly}
          />
          {values.race === 'Other' && (
            <Input
              aria-label="Race, other"
              value={values.raceOther}
              onChange={set('raceOther')}
              disabled={readOnly}
              placeholder="Please specify"
              className="mt-2"
            />
          )}
        </Cell>
      </div>

      <Cell label="Title">
        <Choice
          name="title"
          options={TITLES}
          value={values.title}
          onChange={(v) => onChange({ title: v })}
          readOnly={readOnly}
        />
        {values.title === 'Other' && (
          <Input
            aria-label="Title, other"
            value={values.titleOther}
            onChange={set('titleOther')}
            disabled={readOnly}
            placeholder="Please specify"
            className="mt-2 max-w-xs"
          />
        )}
      </Cell>

      {/* ── PERSONAL CONTACT DETAILS ───────────────────────────────────── */}
      <Section>Personal Contact Details</Section>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        <Cell label="Physical Address" htmlFor="physicalAddress">
          <Textarea
            id="physicalAddress"
            value={values.physicalAddress}
            onChange={set('physicalAddress')}
            disabled={readOnly}
            rows={2}
          />
        </Cell>
        <Cell label="Cellphone No" htmlFor="cellphone">
          <Input
            id="cellphone"
            value={values.cellphone}
            onChange={set('cellphone')}
            disabled={readOnly}
            placeholder="+27 or 0XX"
          />
        </Cell>

        <Cell label="Local Municipality" htmlFor="localMunicipality">
          <Input
            id="localMunicipality"
            value={values.localMunicipality}
            onChange={set('localMunicipality')}
            disabled={readOnly}
          />
        </Cell>
        <Cell label="Alternative No" htmlFor="alternativeNumber">
          <Input
            id="alternativeNumber"
            value={values.alternativeNumber}
            onChange={set('alternativeNumber')}
            disabled={readOnly}
          />
        </Cell>

        <Cell label="District Municipality" htmlFor="districtMunicipality">
          <Input
            id="districtMunicipality"
            value={values.districtMunicipality}
            onChange={set('districtMunicipality')}
            disabled={readOnly}
          />
        </Cell>
        <Cell label="Email address" htmlFor="email">
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={set('email')}
            disabled={readOnly}
            required
          />
        </Cell>

        <Cell label="Province" htmlFor="province">
          <select
            id="province"
            value={values.province}
            onChange={set('province')}
            disabled={readOnly}
            className={selectClass}
          >
            <option value="">Select…</option>
            {PROVINCES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Cell>
        <div className="border border-border p-3" aria-hidden />
      </div>

      {/* ── PROJECT DETAILS ────────────────────────────────────────────── */}
      <Section>Project Details</Section>

      <Cell label="Do you have an innovative idea?">
        <Choice
          name="hasInnovativeIdea"
          options={['Yes', 'No']}
          value={values.hasInnovativeIdea}
          onChange={(v) => onChange({ hasInnovativeIdea: v })}
          readOnly={readOnly}
        />
      </Cell>

      <Cell
        label="Description of proposed innovative business, social or technology concept"
        htmlFor="conceptDescription"
      >
        <Textarea
          id="conceptDescription"
          value={values.conceptDescription}
          onChange={set('conceptDescription')}
          disabled={readOnly}
          rows={4}
        />
      </Cell>

      <Cell label="Project title" htmlFor="projectTitle">
        <Input
          id="projectTitle"
          value={values.projectTitle}
          onChange={set('projectTitle')}
          disabled={readOnly}
        />
      </Cell>

      <Cell label="Stage of development" htmlFor="developmentStage">
        <Input
          id="developmentStage"
          value={values.developmentStage}
          onChange={set('developmentStage')}
          disabled={readOnly}
        />
      </Cell>

      <Cell label="Sector that the innovation falls under" htmlFor="sector">
        <Input
          id="sector"
          value={values.sector}
          onChange={set('sector')}
          disabled={readOnly}
        />
      </Cell>

      <Cell label="Type of support required" htmlFor="supportRequired">
        <Textarea
          id="supportRequired"
          value={values.supportRequired}
          onChange={set('supportRequired')}
          disabled={readOnly}
          rows={3}
        />
      </Cell>

      <Cell label="Any other key information" htmlFor="otherInformation">
        <Textarea
          id="otherInformation"
          value={values.otherInformation}
          onChange={set('otherInformation')}
          disabled={readOnly}
          rows={3}
        />
      </Cell>
    </div>
  )
}
