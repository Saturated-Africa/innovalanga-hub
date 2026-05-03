import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a date as DD/MM/YYYY (SA standard) */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd/MM/yyyy')
}

/** Format a datetime with time in SAST display */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'dd/MM/yyyy HH:mm')
}

/** Format ZAR currency */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
  }).format(amount)
}

/** Mask SA ID number — show only last 4 digits */
export function maskIdNumber(id: string): string {
  if (!id || id.length < 4) return '***'
  return '*'.repeat(id.length - 4) + id.slice(-4)
}

/** Validate SA ID number (13 digits, Luhn check) */
export function validateSAIdNumber(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false
  // Luhn algorithm
  let sum = 0
  let alternate = false
  for (let i = id.length - 1; i >= 0; i--) {
    let n = parseInt(id[i], 10)
    if (alternate) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alternate = !alternate
  }
  return sum % 10 === 0
}

/** Validate SA phone number */
export function validateSAPhone(phone: string): boolean {
  return /^(\+27|0)[6-8][0-9]{8}$/.test(phone.replace(/\s/g, ''))
}

/** Convert minutes to "Xh Ym" string */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** TRL level label */
export function getTRLLabel(score: number): string {
  const labels: Record<number, string> = {
    1: 'Basic Principles',
    2: 'Technology Concept',
    3: 'Experimental Proof',
    4: 'Lab Validation',
    5: 'Relevant Environment',
    6: 'Relevant Demo',
    7: 'Prototype Demo',
    8: 'System Complete',
    9: 'Operational',
  }
  return labels[score] ?? 'Unknown'
}

/** BRL level label */
export function getBRLLabel(score: number): string {
  const labels: Record<number, string> = {
    1: 'Idea Stage',
    2: 'Problem Defined',
    3: 'Market Research',
    4: 'Business Model',
    5: 'MVP Tested',
    6: 'Early Revenue',
    7: 'Scaling',
    8: 'Established',
    9: 'Investment Ready',
  }
  return labels[score] ?? 'Unknown'
}

/** IRL level label */
export function getIRLLabel(score: number): string {
  const labels: Record<number, string> = {
    1: 'Awareness',
    2: 'Interest',
    3: 'Engaged',
    4: 'Applied',
    5: 'Collaborating',
    6: 'Contributing',
    7: 'Leading',
    8: 'Systemic',
    9: 'Ecosystem Influence',
  }
  return labels[score] ?? 'Unknown'
}

/** MRL level label */
export function getMRLLabel(score: number): string {
  const labels: Record<number, string> = {
    1: 'Problem Identified',
    2: 'Customer Research',
    3: 'Value Proposition',
    4: 'Early Adopters',
    5: 'Validated Demand',
    6: 'Market Entry',
    7: 'Growing Revenue',
    8: 'Market Expansion',
    9: 'Scaled Presence',
  }
  return labels[score] ?? 'Unknown'
}
