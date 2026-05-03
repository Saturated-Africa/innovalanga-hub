import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const regions = await prisma.region.findMany({
    where: { programmeId: params.id },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true },
  })
  return NextResponse.json(regions)
}
