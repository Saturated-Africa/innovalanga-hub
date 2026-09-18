/**
 * One-off data migration: rebrand persisted session-type colours.
 *
 * `EventType.color` stores hex in the database and is rendered through inline
 * styles, so the brand refresh cannot reach it from CSS. This maps every legacy
 * swatch onto its nearest brand replacement and leaves anything already on the
 * brand palette untouched.
 *
 * Run with:  npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/migrate-event-colors.ts
 * Safe to run more than once.
 */
import { PrismaClient } from '@prisma/client'
import {
  EVENT_COLORS,
  DEFAULT_EVENT_COLOR,
  LEGACY_EVENT_COLOR_MAP,
} from '../lib/event-colors'

const prisma = new PrismaClient()

async function main() {
  const eventTypes = await prisma.eventType.findMany({
    select: { id: true, name: true, color: true },
  })

  const brand = new Set<string>(EVENT_COLORS.map((c) => c.toUpperCase()))
  let updated = 0
  let skipped = 0

  for (const et of eventTypes) {
    const current = (et.color ?? '').toUpperCase()

    if (brand.has(current)) {
      skipped++
      continue
    }

    const mapped =
      LEGACY_EVENT_COLOR_MAP[(et.color ?? '').toLowerCase()] ?? DEFAULT_EVENT_COLOR

    await prisma.eventType.update({
      where: { id: et.id },
      data: { color: mapped },
    })
    console.log(`  ${et.name}: ${et.color} -> ${mapped}`)
    updated++
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already on the brand palette.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
