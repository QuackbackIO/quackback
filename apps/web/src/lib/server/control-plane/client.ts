import { createHmac } from 'node:crypto'
import {
  getCurrentWorkspace,
  getWorkspaceSecretKey,
} from '@/lib/server/workspaces/workspace-context'

export class ControlPlaneUnavailableError extends Error {
  constructor(message = 'Quackback Cloud is temporarily unavailable. Please try again.') {
    super(message)
    this.name = 'ControlPlaneUnavailableError'
  }
}

export type CustomDomainAction = 'add' | 'refresh' | 'makePrimary' | 'remove'

export type CustomDomainInstruction = {
  hostname: string
  readiness: 'pending' | 'ready' | 'failed'
  isPrimary: boolean
  updatedAt: string
  cnameTarget: string
  ownershipTxt: { name: string; value: string } | null
}

export async function requestWorkspaceIdentityMutation(input: {
  displayName?: string
  platformLabel?: string
  customDomain?: { action: CustomDomainAction; hostname: string }
}): Promise<{ projectionToken: string }> {
  const result = await requestWorkspaceControlPlane<{ projectionToken?: unknown }>(
    '/api/v1/internal/identity',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    input.customDomain ? 25_000 : 10_000
  )
  if (typeof result.projectionToken !== 'string' || result.projectionToken.length === 0) {
    throw new ControlPlaneUnavailableError()
  }
  return { projectionToken: result.projectionToken }
}

export async function fetchWorkspaceCustomDomains(): Promise<CustomDomainInstruction[]> {
  const result = await requestWorkspaceControlPlane<{ customDomains?: unknown }>(
    '/api/v1/internal/identity',
    { method: 'GET' }
  )
  if (!Array.isArray(result.customDomains)) return []
  return result.customDomains.filter((row): row is CustomDomainInstruction => {
    if (!row || typeof row !== 'object') return false
    const domain = row as CustomDomainInstruction
    return (
      typeof domain.hostname === 'string' &&
      (domain.readiness === 'pending' ||
        domain.readiness === 'ready' ||
        domain.readiness === 'failed') &&
      typeof domain.isPrimary === 'boolean' &&
      typeof domain.cnameTarget === 'string'
    )
  })
}

export function deriveControlPlaneCredential(workspaceSecretKey: string): string {
  if (workspaceSecretKey.length < 32) throw new Error('workspace secret key is too short')
  return `qbint_${createHmac('sha256', workspaceSecretKey)
    .update('quackback-control-plane-credential-v1')
    .digest('base64url')}`
}

function controlPlaneOrigin(): URL {
  const raw = process.env.QUACKBACK_CONTROL_PLANE_URL
  if (!raw) throw new ControlPlaneUnavailableError()
  const origin = new URL(raw)
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('QUACKBACK_CONTROL_PLANE_URL must be an HTTPS origin')
  }
  return origin
}

export async function callWorkspaceControlPlane<T>(path: string, body: unknown): Promise<T> {
  return requestWorkspaceControlPlane<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getWorkspaceControlPlane<T>(path: string): Promise<T> {
  return requestWorkspaceControlPlane<T>(path, { method: 'GET' })
}

async function requestWorkspaceControlPlane<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 10_000
): Promise<T> {
  const workspace = getCurrentWorkspace()
  const secretKey = getWorkspaceSecretKey()
  if (!workspace || !secretKey) throw new ControlPlaneUnavailableError()
  const response = await fetch(new URL(path, controlPlaneOrigin()), {
    ...init,
    headers: {
      authorization: `Bearer ${deriveControlPlaneCredential(secretKey)}`,
      ...(init.headers ?? {}),
    },
    redirect: 'manual',
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  }).catch(() => {
    throw new ControlPlaneUnavailableError()
  })
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : undefined
    throw new ControlPlaneUnavailableError(message)
  }
  return payload as T
}

export async function fetchBillingCatalogue(): Promise<BillingCatalogue> {
  return getWorkspaceControlPlane<BillingCatalogue>('/api/v1/internal/billing/catalogue')
}

export async function fetchBillingInvoices(): Promise<CustomerInvoice[]> {
  const result = await getWorkspaceControlPlane<{ invoices?: CustomerInvoice[] }>(
    '/api/v1/internal/billing/invoices'
  )
  return Array.isArray(result.invoices) ? result.invoices : []
}

export type BillingCatalogue = {
  version: 1
  currency: 'usd'
  annualDiscountMonths: number
  recommendedPlanId: 'growth' | 'pro' | 'scale'
  aiOutcomePriceCents: number
  copilot: {
    freeConversationsPerSeat: number
    addonMonthlyCents: number
    addonAnnualCents: number
  }
  brandingRemoval: { monthlyCents: number; annualCents: number }
  liteSeatsIncluded: Record<'free' | 'growth' | 'pro' | 'scale', number | null>
  plans: Array<{
    id: 'free' | 'growth' | 'pro' | 'scale'
    name: string
    rank: number
    priceMonthlyCents: number
    priceYearlyCents: number
    billedPer: 'seat' | 'workspace'
    bestFor: string
    highlights: string[]
    recommended: boolean
  }>
  trialDays?: number
  trialedPlanIds?: Array<'growth' | 'pro' | 'scale'>
}

export type CustomerInvoice = {
  id: string
  number: string | null
  createdAt: string
  amountCents: number
  currency: string
  status: string
  hostedUrl: string | null
}

export async function createHostedBillingSession(
  input:
    | { action: 'portal' }
    | {
        action: 'checkout'
        planId: 'growth' | 'pro' | 'scale'
        billingPeriod: 'monthly' | 'annual'
      }
    | { action: 'downgrade'; planId: 'free' }
): Promise<{ url?: string; status?: 'downgraded' | 'scheduled' }> {
  const result = await callWorkspaceControlPlane<{ url?: unknown; status?: unknown }>(
    '/api/v1/internal/billing/session',
    input
  )
  if (input.action === 'downgrade') {
    if (result.status === 'downgraded' || result.status === 'scheduled') {
      return { status: result.status }
    }
    throw new ControlPlaneUnavailableError()
  }
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) {
    throw new ControlPlaneUnavailableError()
  }
  return { url: result.url }
}

export async function startWorkspaceTrial(
  planId: 'growth' | 'pro' | 'scale'
): Promise<'started' | 'already_started'> {
  const result = await callWorkspaceControlPlane<{ status?: unknown }>(
    '/api/v1/internal/billing/start-trial',
    { planId }
  )
  if (result.status !== 'started' && result.status !== 'already_started') {
    throw new ControlPlaneUnavailableError()
  }
  return result.status
}

export async function reportTrialActivation(input: {
  idempotencyKey: string
  resolution: 'created' | 'configured'
  artifactType: 'board' | 'messenger' | 'article' | 'invitation'
  occurredAt: string
}): Promise<'started' | 'already_started'> {
  const result = await callWorkspaceControlPlane<{ status?: unknown }>(
    '/api/v1/internal/billing/activate-trial',
    input
  )
  if (result.status !== 'started' && result.status !== 'already_started') {
    throw new ControlPlaneUnavailableError()
  }
  return result.status
}

export type OwnerWorkspace = {
  instanceId: string
  displayName: string
  url: string | null
}

export type OwnerSiblingWorkspace = OwnerWorkspace

function isGeneratedSystemUrl(value: string): boolean {
  return /(?:^|\.|\/\/)ws-[0-9a-f]{24}(?:\.|$|\/)/i.test(value)
}

function sanitizeOwnerWorkspace(raw: unknown): OwnerWorkspace | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as { instanceId?: unknown; displayName?: unknown; url?: unknown }
  if (typeof row.instanceId !== 'string' || row.instanceId.length === 0) return null
  const displayName =
    typeof row.displayName === 'string' && row.displayName.trim()
      ? row.displayName.trim()
      : 'Untitled workspace'
  const url = typeof row.url === 'string' && row.url.startsWith('https://') ? row.url : null
  return {
    instanceId: row.instanceId,
    displayName,
    url: url && !isGeneratedSystemUrl(url) ? url : null,
  }
}

export async function fetchOwnerWorkspaces(): Promise<OwnerWorkspace[]> {
  const result = await getWorkspaceControlPlane<{ workspaces?: unknown }>(
    '/api/v1/internal/workspaces'
  )
  if (!Array.isArray(result.workspaces)) return []
  return result.workspaces
    .map(sanitizeOwnerWorkspace)
    .filter((row): row is OwnerWorkspace => row !== null)
}

export async function fetchWorkspaceOwnerEmail(): Promise<string | null> {
  const result = await getWorkspaceControlPlane<{ ownerEmail?: unknown }>(
    '/api/v1/internal/ownership'
  )
  return typeof result.ownerEmail === 'string' ? result.ownerEmail : null
}

export async function transferWorkspaceOwnership(toEmail: string): Promise<void> {
  await callWorkspaceControlPlane('/api/v1/internal/ownership', { toEmail })
}

export async function leaveCloudWorkspace(email: string): Promise<void> {
  await callWorkspaceControlPlane('/api/v1/internal/membership/leave', { email })
}

export async function pushWorkspaceMembership(emails: string[]): Promise<void> {
  await callWorkspaceControlPlane('/api/v1/internal/membership/reconcile', { emails })
}

export async function wipeCloudWorkspace(): Promise<void> {
  await callWorkspaceControlPlane('/api/v1/internal/lifecycle/soft-delete', { confirm: 'wipe' })
}

export async function openOwnerWorkspace(instanceId: string): Promise<string> {
  const result = await callWorkspaceControlPlane<{ url?: unknown }>(
    '/api/v1/internal/workspaces/open',
    { instanceId }
  )
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) {
    throw new ControlPlaneUnavailableError()
  }
  return result.url
}
