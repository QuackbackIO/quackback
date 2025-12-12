import { NextResponse } from 'next/server'
import { getCurrentUserRole } from '@/lib/tenant'

/**
 * GET /api/user/role
 * Returns the current user's role in the organization for the current domain.
 */
export async function GET() {
  const role = await getCurrentUserRole()

  return NextResponse.json({ role })
}
