import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const periods = await prisma.assessmentPeriodDef.findMany({
    where: { programmeId: params.id },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json(periods)
}
