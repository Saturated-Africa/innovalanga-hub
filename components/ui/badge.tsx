import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/*
  Badges carry the entire status colour language of the app — booking states,
  stipend states, IP recommendations, milestone states, audit actions. Every
  variant below resolves to a semantic token so a status reads the same
  everywhere and survives a theme change.

  The tinted variants use a translucent fill over the surface rather than a
  fixed `-100` shade, so they hold up on both the light canvas and the dark
  shell without needing a second set of dark-mode classes.
*/
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold tracking-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-destructive/25 bg-destructive/12 text-destructive hover:bg-destructive/20',
        outline: 'border-border text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-success/25 bg-success/12 text-success hover:bg-success/20',
        warning: 'border-warning/25 bg-warning/12 text-warning hover:bg-warning/20',
        info: 'border-info/25 bg-info/12 text-info hover:bg-info/20',
      },
      size: {
        default: 'px-2 py-0.5 text-xs',
        sm: 'px-1.5 py-0 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

/** The status variants, shared by every status-badge helper. */
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
