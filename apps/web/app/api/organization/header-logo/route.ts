import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { withApiHandler, ApiError, successResponse } from '@/lib/api-handler'
import type { HeaderDisplayMode } from '@quackback/domain'

// SVG is allowed for header logos (scales perfectly)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

/**
 * GET /api/organization/header-logo?organizationId={id}
 *
 * Get header logo and display mode for an organization.
 * Requires owner or admin role.
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, validation.organization.id),
      columns: {
        headerLogoBlob: true,
        headerLogoType: true,
        headerDisplayMode: true,
        headerDisplayName: true,
      },
    })

    if (!org) {
      throw new ApiError('Organization not found', 404)
    }

    const hasHeaderLogo = !!org.headerLogoType && !!org.headerLogoBlob
    let headerLogoUrl: string | null = null

    if (hasHeaderLogo && org.headerLogoBlob) {
      // Convert blob to base64 data URL
      const base64 = org.headerLogoBlob.toString('base64')
      headerLogoUrl = `data:${org.headerLogoType};base64,${base64}`
    }

    return NextResponse.json({
      headerLogoUrl,
      hasHeaderLogo,
      headerDisplayMode: (org.headerDisplayMode as HeaderDisplayMode) || 'logo_and_name',
      headerDisplayName: org.headerDisplayName || null,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * PATCH /api/organization/header-logo
 *
 * Upload a new header logo or update display mode.
 * Requires owner or admin role.
 *
 * For logo upload: multipart/form-data with 'headerLogo' file and 'organizationId'
 * For display mode: JSON with { organizationId, headerDisplayMode }
 */
export const PATCH = withApiHandler(
  async (request: NextRequest, { validation }) => {
    const contentType = request.headers.get('content-type') || ''

    // Handle JSON body (display mode and/or display name update)
    if (contentType.includes('application/json')) {
      const body = await request.json()
      const { headerDisplayMode, headerDisplayName } = body

      const updateData: {
        headerDisplayMode?: HeaderDisplayMode
        headerDisplayName?: string | null
      } = {}

      if (headerDisplayMode !== undefined) {
        const validModes: HeaderDisplayMode[] = ['logo_and_name', 'logo_only', 'custom_logo']
        if (!validModes.includes(headerDisplayMode)) {
          throw new ApiError('Invalid header display mode', 400)
        }
        updateData.headerDisplayMode = headerDisplayMode
      }

      if (headerDisplayName !== undefined) {
        // Allow empty string to clear, or set new name (trim whitespace)
        updateData.headerDisplayName = headerDisplayName?.trim() || null
      }

      if (Object.keys(updateData).length === 0) {
        throw new ApiError('No update provided', 400)
      }

      await db
        .update(organization)
        .set(updateData)
        .where(eq(organization.id, validation.organization.id))

      return successResponse({ success: true, ...updateData })
    }

    // Handle multipart form data (logo upload)
    if (!contentType.includes('multipart/form-data')) {
      throw new ApiError('Content-Type must be multipart/form-data or application/json', 400)
    }

    const formData = await request.formData()
    const logoField = formData.get('headerLogo')
    const displayMode = formData.get('headerDisplayMode') as HeaderDisplayMode | null

    if (!logoField || !(logoField instanceof File) || logoField.size === 0) {
      throw new ApiError('No header logo file provided', 400)
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(logoField.type)) {
      throw new ApiError('Invalid file type. Allowed: JPEG, PNG, WebP, SVG', 400)
    }

    // Validate file size
    if (logoField.size > MAX_FILE_SIZE) {
      throw new ApiError('File too large. Maximum size is 2MB', 400)
    }

    const arrayBuffer = await logoField.arrayBuffer()
    const logoBuffer = Buffer.from(arrayBuffer)

    // Build update object
    const updateData: {
      headerLogoBlob: Buffer
      headerLogoType: string
      headerDisplayMode?: HeaderDisplayMode
    } = {
      headerLogoBlob: logoBuffer,
      headerLogoType: logoField.type,
    }

    // If display mode provided, update it too
    if (displayMode) {
      const validModes: HeaderDisplayMode[] = ['logo_and_name', 'logo_only', 'custom_logo']
      if (validModes.includes(displayMode)) {
        updateData.headerDisplayMode = displayMode
      }
    }

    // Update the organization
    await db
      .update(organization)
      .set(updateData)
      .where(eq(organization.id, validation.organization.id))

    // Return base64 URL for immediate display
    const base64 = logoBuffer.toString('base64')
    const headerLogoUrl = `data:${logoField.type};base64,${base64}`

    return successResponse({
      success: true,
      headerLogoUrl,
      headerDisplayMode: displayMode || 'custom_logo',
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * DELETE /api/organization/header-logo?organizationId={id}
 *
 * Remove the organization's header logo.
 * Optionally resets display mode to 'logo_and_name'.
 * Requires owner or admin role.
 */
export const DELETE = withApiHandler(
  async (_request, { validation }) => {
    await db
      .update(organization)
      .set({
        headerLogoBlob: null,
        headerLogoType: null,
        // Reset to default mode when removing custom logo
        headerDisplayMode: 'logo_and_name',
      })
      .where(eq(organization.id, validation.organization.id))

    return successResponse({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
