import { Resend } from 'resend'
import { formatDateTime } from '@/lib/utils'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

const FROM = 'Innovalanga Hub <noreply@innovalanga.org.za>'

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
  const meetLink = zoomLink ? `<p><strong>Meeting link:</strong> <a href="${zoomLink}">${zoomLink}</a></p>` : ''

  await Promise.all([
    getResend().emails.send({
      from: FROM,
      to: innovatorEmail,
      subject: `Session confirmed with ${mentorName}`,
      html: `<p>Hi ${innovatorName},</p>
<p>Your mentoring session with <strong>${mentorName}</strong> has been confirmed.</p>
<p><strong>Date &amp; time:</strong> ${dateStr} SAST</p>
${meetLink}
<p>The Innovalanga Hub Team</p>`,
    }),
    getResend().emails.send({
      from: FROM,
      to: mentorEmail,
      subject: `New session booked by ${innovatorName}`,
      html: `<p>Hi ${mentorName},</p>
<p><strong>${innovatorName}</strong> has booked a session with you.</p>
<p><strong>Date &amp; time:</strong> ${dateStr} SAST</p>
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
    subject: `Session with ${innovatorName} completed — please log your notes`,
    html: `<p>Hi ${mentorName},</p>
<p>Your session with <strong>${innovatorName}</strong> on ${formatDateTime(scheduledStart)} SAST has been marked complete.</p>
<p>Please log your session notes, outcomes, and next steps:</p>
<p><a href="${logUrl}">Add mentorship log</a></p>
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
      subject: `No-show flagged — ${innovatorName}`,
      html: `<p>Hi ${mentorName},</p>
<p>The session with <strong>${innovatorName}</strong> scheduled for ${formatDateTime(scheduledStart)} SAST was flagged as a no-show. A facilitator will follow up.</p>
<p>The Innovalanga Hub Team</p>`,
    }),
    getResend().emails.send({
      from: FROM,
      to: innovatorEmail,
      subject: 'Missed session notification',
      html: `<p>Hi ${innovatorName},</p>
<p>You missed your scheduled mentoring session on ${formatDateTime(scheduledStart)} SAST. A facilitator will be in touch. Please book a new session when you are ready.</p>
<p>The Innovalanga Hub Team</p>`,
    }),
  ])
}
