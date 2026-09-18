'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Eraser } from 'lucide-react'

/**
 * Draw-to-sign panel.
 *
 * Pointer events rather than separate mouse and touch handlers, so a finger on
 * a phone, a stylus on a tablet and a mouse all take the same path. Most of
 * these forms are signed on whatever device the facilitator has with them.
 *
 * The canvas is sized to its own displayed width multiplied by the device
 * pixel ratio, otherwise the stroke is blurry on exactly the high-density
 * screens people sign on.
 */
export function SignaturePad({
  onChange,
  disabled = false,
  label,
}: {
  /** Emits a PNG data URL, or null when the pad is cleared. */
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  label: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const [empty, setEmpty] = useState(true)

  const prepare = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width === width * ratio && canvas.height === height * ratio) return

    canvas.width = width * ratio
    canvas.height = height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Ink, not pure black: matches the rest of the brand and prints softer.
    ctx.strokeStyle = '#1F1D1E'
  }, [])

  useEffect(() => {
    prepare()
    window.addEventListener('resize', prepare)
    return () => window.removeEventListener('resize', prepare)
  }, [prepare])

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawing.current = true
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    hasInk.current = true
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    if (!hasInk.current) return
    setEmpty(false)
    onChange(canvasRef.current?.toDataURL('image/png') ?? null)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {!empty && !disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <Eraser className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className={`h-36 w-full rounded-md border bg-card ${
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair touch-none'
        }`}
        // touch-none stops the browser scrolling the page while someone signs.
        aria-label={label}
        role="img"
      />

      {empty && !disabled && (
        <p className="text-xs text-muted-foreground">Sign inside the box above.</p>
      )}
    </div>
  )
}
