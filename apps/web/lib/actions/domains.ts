'use server'

import { z } from 'zod'
import { withAction } from './with-action'
import { actionOk, actionErr } from './types'
import { db, workspaceDomain, eq, and } from '@/lib/db'
import { generateId, isValidTypeId, workspaceIdSchema, type DomainId } from '@quackback/ids'
import { isCloud } from '@quackback/domain/features'
import {
  isCloudflareConfigured,
  createCustomHostname,
  deleteCustomHostname,
} from '@quackback/ee/cloudflare'

// ============================================
// Schemas
// ============================================

const domainIdSchema = z
  .string()
  .refine((id) => isValidTypeId(id, 'domain'), {
    message: 'Invalid domain ID',
  }) as z.ZodType<DomainId>

const addDomainSchema = z.object({
  workspaceId: workspaceIdSchema,
  domain: z
    .string()
    .min(1)
    .transform((d) => d.toLowerCase().trim())
    .refine((d) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d), {
      message: 'Invalid domain format',
    }),
})

const deleteDomainSchema = z.object({
  workspaceId: workspaceIdSchema,
  domainId: domainIdSchema,
})

const setPrimaryDomainSchema = z.object({
  workspaceId: workspaceIdSchema,
  domainId: domainIdSchema,
})

const verifyDomainSchema = z.object({
  workspaceId: workspaceIdSchema,
  domainId: domainIdSchema,
})

const listDomainsSchema = z.object({
  workspaceId: workspaceIdSchema,
})

// ============================================
// Type Exports
// ============================================

export type AddDomainInput = z.infer<typeof addDomainSchema>
export type DeleteDomainInput = z.infer<typeof deleteDomainSchema>
export type SetPrimaryDomainInput = z.infer<typeof setPrimaryDomainSchema>
export type VerifyDomainInput = z.infer<typeof verifyDomainSchema>
export type ListDomainsInput = z.infer<typeof listDomainsSchema>

export interface WorkspaceDomain {
  id: string
  workspaceId: string
  domain: string
  domainType: 'subdomain' | 'custom'
  isPrimary: boolean
  verified: boolean
  verificationToken: string | null
  cloudflareHostnameId: string | null
  sslStatus: string | null
  ownershipStatus: string | null
  createdAt: string // Serialized from Date by Next.js
}

export interface VerifyDomainResult {
  verified: boolean
  message?: string
  sslStatus?: string | null
  ownershipStatus?: string | null
  mode?: string
  check?: {
    reachable: boolean
    tokenMatch: boolean | null
    error: string | null
  }
}

interface HttpCheckResult {
  verified: boolean
  reachable: boolean
  tokenMatch: boolean | null
  error: string | null
}

// ============================================
// Helper Functions
// ============================================

function getCnameTarget(): string {
  const appDomain = process.env.APP_DOMAIN
  if (!appDomain) {
    throw new Error('APP_DOMAIN is required')
  }
  return appDomain
}

const MAX_REDIRECTS = 5

async function checkHttpVerification(domain: string): Promise<HttpCheckResult> {
  let url = `https://${domain}/.well-known/domain-verification`
  const visitedUrls = new Set<string>()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    let response: Response
    let redirectCount = 0

    while (true) {
      if (visitedUrls.has(url)) {
        clearTimeout(timeoutId)
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Redirect loop detected.',
        }
      }
      visitedUrls.add(url)

      if (redirectCount >= MAX_REDIRECTS) {
        clearTimeout(timeoutId)
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Too many redirects.',
        }
      }

      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Quackback-Domain-Verification/1.0' },
        redirect: 'manual',
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          clearTimeout(timeoutId)
          return {
            verified: false,
            reachable: true,
            tokenMatch: null,
            error: `Redirect without location header (status ${response.status})`,
          }
        }

        url = new URL(location, url).href
        redirectCount++

        const redirectHost = new URL(url).hostname.toLowerCase()
        if (redirectHost !== domain.toLowerCase()) {
          clearTimeout(timeoutId)
          return {
            verified: false,
            reachable: true,
            tokenMatch: null,
            error: `Domain redirected to ${redirectHost}. CNAME may be misconfigured.`,
          }
        }

        continue
      }

      break
    }

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 404) {
        return {
          verified: false,
          reachable: true,
          tokenMatch: null,
          error: 'Verification endpoint not found. Make sure your CNAME is set up correctly.',
        }
      }
      return {
        verified: false,
        reachable: true,
        tokenMatch: null,
        error: `Endpoint returned status ${response.status}`,
      }
    }

    const responseText = (await response.text()).trim()
    const isVerified = responseText === 'VERIFIED'

    return {
      verified: isVerified,
      reachable: true,
      tokenMatch: isVerified,
      error: isVerified ? null : `Unexpected response: ${responseText.substring(0, 50)}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'Connection timed out. Check your DNS settings.',
      }
    }

    if (
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('getaddrinfo') ||
      errorMessage.includes('DNS')
    ) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'Domain not found. Create a CNAME record pointing to our servers.',
      }
    }

    if (errorMessage.includes('certificate') || errorMessage.includes('SSL')) {
      return {
        verified: false,
        reachable: false,
        tokenMatch: null,
        error: 'SSL certificate error. This may resolve automatically after DNS propagates.',
      }
    }

    console.error(`HTTP verification failed for ${domain}:`, error)
    return {
      verified: false,
      reachable: false,
      tokenMatch: null,
      error: 'Could not reach domain. Check your CNAME configuration.',
    }
  }
}

// ============================================
// Actions
// ============================================

/**
 * List all domains for a workspace.
 */
export const listDomainsAction = withAction(
  listDomainsSchema,
  async (_input, ctx) => {
    const domains = await db.query.workspaceDomain.findMany({
      where: eq(workspaceDomain.workspaceId, ctx.workspace.id),
      orderBy: (wd, { asc }) => [asc(wd.createdAt)],
    })

    return actionOk({ domains })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Add a custom domain to a workspace.
 */
export const addDomainAction = withAction(
  addDomainSchema,
  async (input, ctx) => {
    const { domain } = input

    // Check if domain already exists (globally unique)
    const existingDomain = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.domain, domain),
    })

    if (existingDomain) {
      return actionErr({
        code: 'CONFLICT',
        message: 'Domain is already in use',
        status: 409,
      })
    }

    // Create domain with verification token
    const domainId = generateId('domain')
    const verificationToken = `qb_${crypto.randomUUID().replace(/-/g, '')}`

    await db.insert(workspaceDomain).values({
      id: domainId,
      workspaceId: ctx.workspace.id,
      domain,
      domainType: 'custom',
      isPrimary: false,
      verified: false,
      verificationToken,
      createdAt: new Date(),
    })

    // If cloud edition + Cloudflare configured, register with Cloudflare
    let cloudflareData = null
    if (isCloud() && isCloudflareConfigured()) {
      try {
        const cfHostname = await createCustomHostname({
          hostname: domain,
          workspaceId: ctx.workspace.id,
        })

        await db
          .update(workspaceDomain)
          .set({
            cloudflareHostnameId: cfHostname.id,
            sslStatus: cfHostname.ssl.status,
            ownershipStatus: cfHostname.status,
            verificationToken: null,
          })
          .where(eq(workspaceDomain.id, domainId))

        cloudflareData = {
          hostnameId: cfHostname.id,
          sslStatus: cfHostname.ssl.status,
          ownershipStatus: cfHostname.status,
        }
      } catch (error) {
        console.error('[Domains] Failed to register with Cloudflare:', error)
      }
    }

    const newDomain = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.id, domainId),
    })

    const cnameTarget = getCnameTarget()
    return actionOk({
      domain: newDomain,
      verificationRecord: {
        type: 'CNAME',
        name: domain,
        value: cnameTarget,
      },
      cloudflare: cloudflareData,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Delete a custom domain.
 */
export const deleteDomainAction = withAction(
  deleteDomainSchema,
  async (input, ctx) => {
    const { domainId } = input

    const domain = await db.query.workspaceDomain.findFirst({
      where: and(
        eq(workspaceDomain.id, domainId),
        eq(workspaceDomain.workspaceId, ctx.workspace.id)
      ),
    })

    if (!domain) {
      return actionErr({ code: 'NOT_FOUND', message: 'Domain not found', status: 404 })
    }

    if (domain.domainType === 'subdomain') {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'Cannot delete subdomain',
        status: 400,
      })
    }

    // If deleting a primary custom domain, auto-promote subdomain
    if (domain.isPrimary) {
      await db
        .update(workspaceDomain)
        .set({ isPrimary: true })
        .where(
          and(
            eq(workspaceDomain.workspaceId, ctx.workspace.id),
            eq(workspaceDomain.domainType, 'subdomain')
          )
        )
    }

    // Delete from Cloudflare if registered
    if (isCloud() && isCloudflareConfigured() && domain.cloudflareHostnameId) {
      try {
        await deleteCustomHostname(domain.cloudflareHostnameId)
      } catch (error) {
        console.error('[Domains] Failed to delete from Cloudflare:', error)
      }
    }

    await db.delete(workspaceDomain).where(eq(workspaceDomain.id, domainId))

    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Set a domain as primary.
 */
export const setPrimaryDomainAction = withAction(
  setPrimaryDomainSchema,
  async (input, ctx) => {
    const { domainId } = input

    const domain = await db.query.workspaceDomain.findFirst({
      where: and(
        eq(workspaceDomain.id, domainId),
        eq(workspaceDomain.workspaceId, ctx.workspace.id)
      ),
    })

    if (!domain) {
      return actionErr({ code: 'NOT_FOUND', message: 'Domain not found', status: 404 })
    }

    if (!domain.verified) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'Domain must be verified before setting as primary',
        status: 400,
      })
    }

    // Unset all other domains first
    await db
      .update(workspaceDomain)
      .set({ isPrimary: false })
      .where(eq(workspaceDomain.workspaceId, ctx.workspace.id))

    await db
      .update(workspaceDomain)
      .set({ isPrimary: true })
      .where(eq(workspaceDomain.id, domainId))

    const updatedDomain = await db.query.workspaceDomain.findFirst({
      where: eq(workspaceDomain.id, domainId),
    })

    return actionOk({ domain: updatedDomain })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Verify a custom domain.
 */
export const verifyDomainAction = withAction(
  verifyDomainSchema,
  async (input, ctx) => {
    const { domainId } = input

    const domain = await db.query.workspaceDomain.findFirst({
      where: and(
        eq(workspaceDomain.id, domainId),
        eq(workspaceDomain.workspaceId, ctx.workspace.id)
      ),
    })

    if (!domain) {
      return actionErr({ code: 'NOT_FOUND', message: 'Domain not found', status: 404 })
    }

    // Already verified
    if (domain.verified) {
      return actionOk({ verified: true, message: 'Domain is already verified' })
    }

    // If Cloudflare is managing this domain, skip HTTP verification
    if (isCloud() && isCloudflareConfigured() && domain.cloudflareHostnameId) {
      return actionOk({
        verified: false,
        sslStatus: domain.sslStatus,
        ownershipStatus: domain.ownershipStatus,
        message:
          domain.sslStatus === 'active'
            ? 'Domain verified via Cloudflare'
            : 'Waiting for Cloudflare SSL provisioning. Set up your CNAME record to proceed.',
        mode: 'cloudflare',
      })
    }

    // Self-hosted: Check via HTTP
    const result = await checkHttpVerification(domain.domain)

    if (result.verified) {
      await db
        .update(workspaceDomain)
        .set({ verified: true, verificationToken: null })
        .where(eq(workspaceDomain.id, domainId))

      return actionOk({
        verified: true,
        message: 'Domain verified successfully',
      })
    }

    return actionOk({
      verified: false,
      check: {
        reachable: result.reachable,
        tokenMatch: result.tokenMatch,
        error: result.error,
      },
    })
  },
  { roles: ['owner', 'admin'] }
)
