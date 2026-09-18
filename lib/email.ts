import { Resend } from 'resend'
import { formatDateTime } from '@/lib/utils'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

/**
 * Sender address.
 *
 * Must be a domain that is verified in Resend and whose SPF and DKIM records
 * we actually control, otherwise every message silently fails authentication
 * and lands in spam. Innovalanga uses innovalanga.co.za.
 *
 * Overridable so a staging environment can send from its own subdomain without
 * a code change.
 */
const FROM = process.env.EMAIL_FROM ?? 'Innovalanga Hub <noreply@innovalanga.co.za>'

/**
 * Escape a value before it is interpolated into an HTML email body.
 *
 * Every template here builds HTML by interpolation, and the values are names,
 * business names and links that participants supply. Without escaping, a
 * participant named `<img src=x onerror=...>` has that markup delivered into a
 * mentor's inbox, and a mail client that renders it is the one running it.
 */
function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A link that is safe to put in an href.
 *
 * Anything that is not plainly http(s) becomes empty rather than being rendered
 * as an anchor, so a stored `javascript:` value cannot reach a mail client.
 */
function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export async function sendBookingConfirmation(params: {
  innovatorEmail: string
  innovatorName: string
  mentorName: string
  mentorEmail: string
  scheduledStart: Date
  scheduledEnd: Date
  zoomLink?: string | null
}) {
  const { innovatorEmail, innovatorName, mentorName, mentorEmail, scheduledStart, zoomLink } = params
  const dateStr = formatDateTime(scheduledStart)
  const link = safeHref(zoomLink)
  const meetLink = link
    ? `<p><strong>Meeting link:</strong> <a href="${esc(link)}">${esc(link)}</a></p>`
    : ''

  await Promise.all([
    getResend().emails.send({
      from: FROM,
      to: innovatorEmail,
      subject: `Session confirmed with ${esc(mentorName)}`,
      html: `<p>Hi ${esc(innovatorName)},</p>
<p>Your mentoring session with <strong>${esc(mentorName)}</strong> has been confirmed.</p>
<p><strong>Date &amp; time:</strong> ${esc(dateStr)} SAST</p>
${meetLink}
<p>The Innovalanga Hub Team</p>`,
    }),
    getResend().emails.send({
      from: FROM,
      to: mentorEmail,
      subject: `New session booked by ${esc(innovatorName)}`,
      html: `<p>Hi ${esc(mentorName)},</p>
<p><strong>${esc(innovatorName)}</strong> has booked a session with you.</p>
<p><strong>Date &amp; time:</strong> ${esc(dateStr)} SAST</p>
${meetLink}
<p>The Innovalanga Hub Team</p>`,
    }),
  ])
}

export async function sendSessionCompletedToMentor(params: {
  mentorEmail: string
  mentorName: string
  innovatorName: string
  scheduledStart: Date
  logUrl: string
}) {
  const { mentorEmail, mentorName, innovatorName, scheduledStart, logUrl } = params
  await getResend().emails.send({
    from: FROM,
    to: mentorEmail,
    subject: `Session with ${esc(innovatorName)} completed — please log your notes`,
    html: `<p>Hi ${esc(mentorName)},</p>
<p>Your session with <strong>${esc(innovatorName)}</strong> on ${formatDateTime(scheduledStart)} SAST has been marked complete.</p>
<p>Please log your session notes, outcomes, and next steps:</p>
<p><a href="${esc(logUrl)}">Add mentorship log</a></p>
<p>The Innovalanga Hub Team</p>`,
  })
}

export async function sendNoShowAlert(params: {
  mentorEmail: string
  mentorName: string
  innovatorName: string
  innovatorEmail: string
  scheduledStart: Date
}) {
  const { mentorEmail, mentorName, innovatorName, innovatorEmail, scheduledStart } = params
  await Promise.all([
    getResend().emails.send({
      from: FROM,
      to: mentorEmail,
      subject: `No-show flagged — ${esc(innovatorName)}`,
      html: `<p>Hi ${esc(mentorName)},</p>
<p>The session with <strong>${esc(innovatorName)}</strong> scheduled for ${formatDateTime(scheduledStart)} SAST was flagged as a no-show. A facilitator will follow up.</p>
<p>The Innovalanga Hub Team</p>`,
    }),
    getResend().emails.send({
      from: FROM,
      to: innovatorEmail,
      subject: 'Missed session notification',
      html: `<p>Hi ${esc(innovatorName)},</p>
<p>You missed your scheduled mentoring session on ${formatDateTime(scheduledStart)} SAST. A facilitator will be in touch. Please book a new session when you are ready.</p>
<p>The Innovalanga Hub Team</p>`,
    }),
  ])
}
