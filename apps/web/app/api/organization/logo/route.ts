import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@/lib/db'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * GET /api/organization/logo?organizationId={id}
 *
 * Get logo data for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, validation.organization.id),
      columns: { logoBlob: true, logoType: true },
    })

    if (!org) {
      throw new ApiError('Organization not found', 404)
    }

    const hasCustomLogo = !!org.logoType && !!org.logoBlob
    let logoUrl: string | null = null

    if (hasCustomLogo && org.logoBlob) {
      // Convert blob to base64 data URL
      const base64 = org.logoBlob.toString('base64')
      logoUrl = `data:${org.logoType};base64,${base64}`
    }

    return NextResponse.json({ logoUrl, hasCustomLogo })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/logo
 *
 * Upload a new logo for the organization.
 * Requires owner or admin role.
 * Accepts multipart/form-data with 'logo' file and 'organizationId' field.
 */
export const PATCH = withApiHandler(
  async (request: NextRequest, { validation }) => {
    const contentType = request.headers.get('content-type') || ''

    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError('Content-Type must be multipart/form-data', 400)
    }

    const formData = await request.formData()
    const logoField = formData.get('logo')

    if (!logoField || !(logoField instanceof File) || logoField.size === 0) {
      throw new ApiError('No logo file provided', 400)
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(logoField.type)) {
      throw new ApiError('Invalid file type. Allowed: JPEG, PNG, GIF, WebP', 400)
    }

    // Validate file size
    if (logoField.size > MAX_FILE_SIZE) {
      throw new ApiError('File too large. Maximum size is 5MB', 400)
    }

    const arrayBuffer = await logoField.arrayBuffer()
    const logoBuffer = Buffer.from(arrayBuffer)

    // Update the organization
    await db
      .update(organization)
      .set({
        logoBlob: logoBuffer,
        logoType: logoField.type,
      })
      .where(eq(organization.id, validation.organization.id))

    // Return base64 URL for immediate display
    const base64 = logoBuffer.toString('base64')
    const logoUrl = `data:${logoField.type};base64,${base64}`

    return successResponse({ success: true, logoUrl })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * DELETE /api/organization/logo?organizationId={id}
 *
 * Remove the organization's logo.
 * Requires owner or admin role.
 */
export const DELETE = withApiHandler(
  async (_request, { validation }) => {
    await db
      .update(organization)
      .set({
        logoBlob: null,
        logoType: null,
      })
      .where(eq(organization.id, validation.organization.id))

    return successResponse({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
