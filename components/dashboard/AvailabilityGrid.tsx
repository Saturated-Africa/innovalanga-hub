'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_INDICES = [1, 2, 3, 4, 5, 6, 0] // Mon–Sun mapped to JS getDay()

// Half-hour blocks from 07:00 to 17:30 UTC (displayed as SAST = UTC+2)
const BLOCKS: { utc: string; sast: string }[] = []
for (let h = 7; h <= 17; h++) {
  for (const m of ['00', '30']) {
    if (h === 17 && m === '30') break
    const utc = `${String(h).padStart(2, '0')}:${m}`
    const sastH = h + 2
    const sast = `${String(sastH > 23 ? sastH - 24 : sastH).padStart(2, '0')}:${m}`
    BLOCKS.push({ utc, sast })
  }
}

// A slot is "active" if a 60-min window starting at `startUtc` on `dayOfWeek` is available
interface Slot {
  dayOfWeek: number
  startTime: string
  endTime: string
  bufferMins: number
}

type Grid = Record<string, boolean> // key: `${dayIndex}-${utcTime}`

function slotsToGrid(slots: Slot[]): Grid {
  const grid: Grid = {}
  for (const slot of slots) {
    // Mark each 30-min block within the slot's start→end range as active
    const [sh, sm] = slot.startTime.split(':').map(Number)
    const [eh, em] = slot.endTime.split(':').map(Number)
    const startMins = sh * 60 + sm
    const endMins = eh * 60 + em

    for (const block of BLOCKS) {
      const [bh, bm] = block.utc.split(':').map(Number)
      const bMins = bh * 60 + bm
      if (bMins >= startMins && bMins < endMins) {
        grid[`${slot.dayOfWeek}-${block.utc}`] = true
      }
    }
  }
  return grid
}

function gridToSlots(grid: Grid): Slot[] {
  const slots: Slot[] = []

  for (let di = 0; di < DAY_INDICES.length; di++) {
    const dayOfWeek = DAY_INDICES[di]
    // Collect active blocks for this day, sorted
    const activeBlocks = BLOCKS.filter((b) => grid[`${dayOfWeek}-${b.utc}`]).map((b) => b.utc)
    if (activeBlocks.length === 0) continue

    // Merge consecutive blocks into contiguous slots
    let rangeStart = activeBlocks[0]
    let prevIdx = BLOCKS.findIndex((b) => b.utc === activeBlocks[0])

    for (let i = 1; i <= activeBlocks.length; i++) {
      const isLast = i === activeBlocks.length
      const currIdx = isLast ? -1 : BLOCKS.findIndex((b) => b.utc === activeBlocks[i])
      const consecutive = !isLast && currIdx === prevIdx + 1

      if (!consecutive) {
        // Close this range: endTime = block after prevIdx
        const endBlock = BLOCKS[prevIdx + 1]
        const endTime = endBlock
          ? endBlock.utc
          : `${String(parseInt(BLOCKS[prevIdx].utc.split(':')[0]) + (BLOCKS[prevIdx].utc.split(':')[1] === '30' ? 1 : 0)).padStart(2,'0')}:${BLOCKS[prevIdx].utc.split(':')[1] === '30' ? '00' : '30'}`

        slots.push({ dayOfWeek, startTime: rangeStart, endTime, bufferMins: 15 })

        if (!isLast) {
          rangeStart = activeBlocks[i]
          prevIdx = currIdx
        }
      } else {
        prevIdx = currIdx
      }
    }
  }

  return slots
}

interface AvailabilityGridProps {
  mentorId: string
  existingSlots: Slot[]
}

export function AvailabilityGrid({ mentorId, existingSlots }: AvailabilityGridProps) {
  const router = useRouter()
  const [grid, setGrid] = useState<Grid>(() => slotsToGrid(existingSlots))
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<boolean | null>(null) // true=adding, false=removing

  function toggleCell(dayOfWeek: number, utc: string) {
    const key = `${dayOfWeek}-${utc}`
    setGrid((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleMouseDown(dayOfWeek: number, utc: string) {
    const key = `${dayOfWeek}-${utc}`
    const next = !grid[key]
    setDragging(next)
    setGrid((prev) => ({ ...prev, [key]: next }))
  }

  function handleMouseEnter(dayOfWeek: number, utc: string) {
    if (dragging === null) return
    const key = `${dayOfWeek}-${utc}`
    setGrid((prev) => ({ ...prev, [key]: dragging }))
  }

  async function handleSave() {
    setSaving(true)
    const slots = gridToSlots(grid)
    const res = await fetch(`/api/mentors/${mentorId}/availability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots }),
    })
    setSaving(false)
    if (res.ok) {
      toast({ title: 'Availability saved' })
      router.refresh()
    } else {
      toast({ title: 'Failed to save', variant: 'destructive' })
    }
  }

  const activeCount = Object.values(grid).filter(Boolean).length

  return (
    <div
      className="space-y-4"
      onMouseUp={() => setDragging(null)}
      onMouseLeave={() => setDragging(null)}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Weekly Availability</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click or drag to toggle 30-minute blocks. Times shown in SAST (UTC+2).
          </p>
        </div>
        {activeCount > 0 && (
          <span className="text-xs text-muted-foreground">{activeCount} block{activeCount !== 1 ? 's' : ''} selected</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="text-xs border-collapse select-none" style={{ userSelect: 'none' }}>
          <thead>
            <tr>
              <th className="w-16 pr-2 text-right text-muted-foreground font-normal pb-1" />
              {DAYS.map((d) => (
                <th key={d} className="w-10 text-center font-medium pb-1 text-muted-foreground">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BLOCKS.map((block, bi) => (
              <tr key={block.utc}>
                <td className="pr-2 text-right text-muted-foreground w-16 py-0 leading-none">
                  {block.sast.endsWith(':00') ? block.sast : ''}
                </td>
                {DAY_INDICES.map((dayOfWeek) => {
                  const key = `${dayOfWeek}-${block.utc}`
                  const active = !!grid[key]
                  // Check if prev block for same day is active (for rounded top)
                  const prevBlock = bi > 0 ? BLOCKS[bi - 1] : null
                  const prevActive = prevBlock ? !!grid[`${dayOfWeek}-${prevBlock.utc}`] : false
                  const nextBlock = bi < BLOCKS.length - 1 ? BLOCKS[bi + 1] : null
                  const nextActive = nextBlock ? !!grid[`${dayOfWeek}-${nextBlock.utc}`] : false

                  return (
                    <td key={dayOfWeek} className="p-0">
                      <div
                        className={cn(
                          'mx-0.5 h-4 cursor-pointer transition-colors',
                          active
                            ? 'bg-primary'
                            : 'bg-muted hover:bg-primary/20',
                          active && !prevActive && 'rounded-t',
                          active && !nextActive && 'rounded-b',
                        )}
                        onMouseDown={() => handleMouseDown(dayOfWeek, block.utc)}
                        onMouseEnter={() => handleMouseEnter(dayOfWeek, block.utc)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Saving…</> : 'Save Availability'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setGrid({})}
          disabled={saving || activeCount === 0}
        >
          Clear all
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        All times are UTC. Innovators see SAST (UTC+2) when booking.
        Each selected block is a 30-minute window; consecutive blocks on the same day are merged into one availability slot.
      </p>
    </div>
  )
}
