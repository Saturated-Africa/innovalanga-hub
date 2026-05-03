/**
 * IP Protection Questionnaire Engine
 *
 * Questions and recommendation logic for determining which type(s) of
 * intellectual property protection apply to an innovator's work.
 */

export interface IPQuestion {
  id: string
  text: string
  hint?: string
  type: 'yesno' | 'select' | 'multi'
  options?: { value: string; label: string }[]
}

export const IP_QUESTIONS: IPQuestion[] = [
  {
    id: 'technical_invention',
    text: 'Is your innovation a new technical process, device, product, substance, or method?',
    hint: 'E.g. a new machine, manufacturing process, chemical compound, software algorithm with technical effect.',
    type: 'yesno',
  },
  {
    id: 'novel_and_not_disclosed',
    text: 'Has your innovation NOT yet been publicly disclosed (not published, exhibited, sold, or demonstrated)?',
    hint: 'Patent protection requires novelty — public disclosure before filing can invalidate a patent.',
    type: 'yesno',
  },
  {
    id: 'brand_identity',
    text: 'Does your innovation have a distinctive name, logo, slogan, or brand used to identify it in the market?',
    hint: 'E.g. a product name, company logo, tagline, or packaging design.',
    type: 'yesno',
  },
  {
    id: 'creative_content',
    text: 'Does your work include original creative expression — software source code, written content, artistic works, or designs?',
    hint: 'Copyright arises automatically but registration provides evidence of ownership.',
    type: 'yesno',
  },
  {
    id: 'trade_secret',
    text: 'Does your competitive advantage come from keeping a formula, process, method, or data set confidential?',
    hint: 'E.g. a proprietary algorithm, customer list, or manufacturing process you do not intend to patent.',
    type: 'yesno',
  },
  {
    id: 'already_protected',
    text: 'Have you already applied for or obtained any IP protection for this innovation?',
    hint: 'Patent pending, registered trademark, copyright registration, etc.',
    type: 'yesno',
  },
  {
    id: 'export_intent',
    text: 'Do you plan to commercialise or operate in markets outside South Africa?',
    hint: 'International IP requires separate filings in each jurisdiction or via PCT/Madrid systems.',
    type: 'yesno',
  },
  {
    id: 'stage',
    text: 'What is the current stage of your innovation?',
    type: 'select',
    options: [
      { value: 'idea', label: 'Idea / concept — not yet built' },
      { value: 'prototype', label: 'Prototype / MVP — built but not tested' },
      { value: 'pilot', label: 'Pilot — being tested with users' },
      { value: 'market', label: 'In the market — generating revenue' },
    ],
  },
]

export type Answers = Record<string, string>

export interface IPResult {
  recommendations: string[]
  primaryRec: string
  reasoning: string
}

/**
 * Derives IP recommendations from questionnaire answers.
 * Returns all applicable types, a primary recommendation, and reasoning.
 */
export function deriveRecommendations(answers: Answers): IPResult {
  const recs: string[] = []
  const reasons: string[] = []

  const yes = (id: string) => answers[id] === 'yes'
  const no = (id: string) => answers[id] === 'no'

  // Patent — needs technical invention AND not yet publicly disclosed
  if (yes('technical_invention') && yes('novel_and_not_disclosed')) {
    recs.push('PatentRequired')
    reasons.push('Your innovation is a novel technical invention that has not been publicly disclosed — patent protection should be pursued urgently before any public disclosure.')
  } else if (yes('technical_invention') && no('novel_and_not_disclosed')) {
    reasons.push('Your innovation is technical but may have been publicly disclosed — a patent attorney should assess whether a grace period or provisional application applies.')
    if (!recs.includes('ReviewRequired')) recs.push('ReviewRequired')
  }

  // Trademark
  if (yes('brand_identity')) {
    recs.push('TrademarkRequired')
    reasons.push('You have a distinctive brand identity — trademark registration will protect your name, logo, or slogan from being used by competitors.')
  }

  // Copyright
  if (yes('creative_content')) {
    recs.push('CopyrightApplicable')
    reasons.push('Your work includes original creative expression — copyright protects this automatically, but formal registration or assignment agreements with collaborators are recommended.')
  }

  // Trade Secret
  if (yes('trade_secret')) {
    recs.push('TradeSecret')
    reasons.push('Your competitive advantage relies on confidential information — implement non-disclosure agreements (NDAs) and access controls to protect your trade secret.')
  }

  // Already protected
  if (yes('already_protected')) {
    reasons.push('You already have some IP protection in place — ensure your registrations cover all aspects of your current innovation and are renewed on time.')
  }

  // International note
  if (yes('export_intent') && recs.some((r) => ['PatentRequired', 'TrademarkRequired'].includes(r))) {
    reasons.push('Given your international commercialisation plans, consider PCT (Patent Cooperation Treaty) and Madrid Protocol filings for international coverage.')
  }

  // Stage note
  if (answers['stage'] === 'idea') {
    reasons.push('At the idea stage, filing early is critical — especially for patents, where priority date determines who owns the invention.')
  }

  // No clear protection needed
  if (recs.length === 0) {
    recs.push('NoProtectionNeeded')
    reasons.push('Based on your answers, formal IP protection may not be immediately applicable. Continue developing your innovation and reassess as it matures.')
  }

  // Multiple protection
  const substantiveRecs = recs.filter((r) => r !== 'ReviewRequired')
  if (substantiveRecs.length > 1) {
    if (!recs.includes('MultipleProtection')) recs.push('MultipleProtection')
  }

  // Primary recommendation: priority order
  const priority = ['PatentRequired', 'MultipleProtection', 'TrademarkRequired', 'CopyrightApplicable', 'TradeSecret', 'ReviewRequired', 'NoProtectionNeeded']
  const primaryRec = priority.find((p) => recs.includes(p)) ?? recs[0]

  return {
    recommendations: recs,
    primaryRec,
    reasoning: reasons.join(' '),
  }
}

export const REC_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  PatentRequired: {
    label: 'Patent Required',
    color: 'bg-blue-100 text-blue-800',
    description: 'File a provisional patent application immediately to secure your priority date. Consult a patent attorney before any public disclosure.',
  },
  TrademarkRequired: {
    label: 'Trademark Required',
    color: 'bg-purple-100 text-purple-800',
    description: 'Register your brand name, logo, or slogan with the Companies and Intellectual Property Commission (CIPC) in South Africa.',
  },
  CopyrightApplicable: {
    label: 'Copyright Applicable',
    color: 'bg-green-100 text-green-800',
    description: 'Copyright protection applies automatically — ensure written agreements assign ownership and consider formal registration as evidence.',
  },
  TradeSecret: {
    label: 'Trade Secret',
    color: 'bg-orange-100 text-orange-800',
    description: 'Protect confidential information with NDAs, employee agreements, and strict access controls.',
  },
  MultipleProtection: {
    label: 'Multiple Protection Types',
    color: 'bg-indigo-100 text-indigo-800',
    description: 'Your innovation requires more than one type of IP protection. Engage a specialist IP attorney for a comprehensive strategy.',
  },
  NoProtectionNeeded: {
    label: 'No Immediate Action',
    color: 'bg-gray-100 text-gray-700',
    description: 'No formal IP protection is required at this stage. Reassess as your innovation develops.',
  },
  ReviewRequired: {
    label: 'Expert Review Required',
    color: 'bg-yellow-100 text-yellow-800',
    description: 'Your situation requires expert review by an IP attorney before determining the right protection strategy.',
  },
}

export const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  NotAssessed: { label: 'Not Assessed', color: 'bg-gray-100 text-gray-700' },
  Assessed: { label: 'Assessed', color: 'bg-blue-100 text-blue-800' },
  ApplicationPending: { label: 'Application Pending', color: 'bg-yellow-100 text-yellow-800' },
  Protected: { label: 'Protected', color: 'bg-green-100 text-green-800' },
  Expired: { label: 'Expired', color: 'bg-red-100 text-red-800' },
}
