import { format } from 'date-fns'

function icalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export interface ICalEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  start: Date
  end: Date
  createdAt: Date
  status: 'CONFIRMED' | 'CANCELLED'
}

export function buildICalFeed(calName: string, events: ICalEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Innovalanga Hub//EN',
    `X-WR-CALNAME:${escape(calName)}`,
    'X-WR-TIMEZONE:Africa/Johannesburg',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${icalDate(ev.createdAt)}`,
      `DTSTART:${icalDate(ev.start)}`,
      `DTEND:${icalDate(ev.end)}`,
      `SUMMARY:${escape(ev.summary)}`,
    )
    if (ev.description) lines.push(`DESCRIPTION:${escape(ev.description)}`)
    if (ev.location) lines.push(`LOCATION:${escape(ev.location)}`)
    lines.push(`STATUS:${ev.status}`, 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function buildSingleICalEvent(ev: ICalEvent, calName: string): string {
  return buildICalFeed(calName, [ev])
}
