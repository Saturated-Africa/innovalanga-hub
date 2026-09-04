import { Skeleton } from '@/components/ui/skeleton'

/**
 * Route-level loading state for the dashboard.
 *
 * The server-rendered pages here await several Prisma queries in parallel and
 * previously showed nothing at all while that happened — there were no
 * `loading.tsx` files anywhere in the app, and `Skeleton` was imported by
 * nothing. This gives every dashboard route a shell that matches the common
 * page shape: heading, stat row, content.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-3 h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}
