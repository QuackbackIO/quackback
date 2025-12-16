import { NextRequest, NextResponse } from 'next/server'
import { isCloud } from '@quackback/domain/features'
import { isCloudflareConfigured, getCustomHostname } from '@quackback/ee/cloudflare'

/**
 * Cloudflare Custom Hostname HTTP Verification Challenge
 *
 * Cloudflare uses this endpoint to verify domain ownership.
 * When a custom hostname is created, Cloudflare provides a verification token.
 * They then request this URL and expect the token in response.
 *
 * URL format: /.well-known/cf-custom-hostname-challenge/{hostname_id}
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: hostnameId } = await params

  // Only respond in cloud mode with Cloudflare configured
  if (!isCloud() || !isCloudflareConfigured()) {
    return new NextResponse('Not configured', { status: 404 })
  }

  try {
    // Fetch the hostname from Cloudflare to get the verification token
    const hostname = await getCustomHostname(hostnameId)

    if (!hostname) {
      return new NextResponse('Hostname not found', { status: 404 })
    }

    // Return the HTTP verification body
    const httpBody = hostname.ownership_verification_http?.http_body
    if (!httpBody) {
      return new NextResponse('No HTTP verification available', { status: 404 })
    }

    return new NextResponse(httpBody, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch (error) {
    console.error('[CF Challenge] Error fetching hostname:', error)
    return new NextResponse('Error', { status: 500 })
  }
}
