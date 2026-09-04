import { createHmac } from 'node:crypto'
import { canonicalPlanId, isPlanId } from '@/lib/server/domains/settings/cloud/cloud.types'
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
  const catalogue = await getWorkspaceControlPlane<BillingCatalogue>(
    '/api/v1/internal/billing/catalogue'
  )
  return normalizeBillingCatalogue(catalogue)
}

export async function fetchBillingInvoices(): Promise<CustomerInvoice[]> {
  const result = await getWorkspaceControlPlane<{ invoices?: CustomerInvoice[] }>(
    '/api/v1/internal/billing/invoices'
  )
  return Array.isArray(result.invoices) ? result.invoices : []
}

export type CanonicalCataloguePlanId = 'free' | 'growth' | 'pro' | 'scale'
/** Incoming CP slugs; aliases are normalised to {@link CanonicalCataloguePlanId} on fetch. */
export type CataloguePlanId = CanonicalCataloguePlanId | 'business' | 'enterprise'
export type PaidCataloguePlanId = Exclude<CataloguePlanId, 'free'>

export type BillingCatalogue = {
  version: 1
  currency: 'usd'
  annualDiscountMonths: number
  recommendedPlanId: PaidCataloguePlanId
  /** @deprecated unread; older catalogues may still send this. */
  aiOutcomePriceCents?: number
  /** @deprecated unread; older catalogues may still send this. */
  copilot?: {
    freeConversationsPerSeat: number
    addonMonthlyCents: number
    addonAnnualCents: number
  }
  brandingRemoval: { monthlyCents: number; annualCents: number }
  /** @deprecated unread; older catalogues may still send this. */
  liteSeatsIncluded?: Record<CataloguePlanId, number | null>
  aiIncludedCentsPerMonth?: Partial<Record<CataloguePlanId, number>>
  aiTopUpPackCents?: number
  aiBlendedCentsPerMTok?: number
  emailTopUpPackCents?: number
  emailTopUpPackUnits?: number
  plans: Array<{
    id: CataloguePlanId
    name: string
    rank: number
    priceMonthlyCents: number
    priceYearlyCents: number
    billedPer: 'seat' | 'workspace'
    annualSavingsCents?: number
    bestFor: string
    highlights: string[]
    recommended: boolean
  }>
  trialDays?: number
  trialedPlanIds?: PaidCataloguePlanId[]
  lastTrialPlanId?: PaidCataloguePlanId | null
}

function canonicalCataloguePlanId(id: string): CataloguePlanId {
  const canonical = canonicalPlanId(id)
  return isPlanId(canonical) ? canonical : (id as CataloguePlanId)
}

function remapPlanKeyedRecord<T>(
  record: Partial<Record<CataloguePlanId, T>> | undefined
): Partial<Record<CataloguePlanId, T>> | undefined {
  if (!record) return record
  const next: Partial<Record<CataloguePlanId, T>> = {}
  for (const [key, value] of Object.entries(record)) {
    next[canonicalCataloguePlanId(key)] = value as T
  }
  return next
}

/** Maps `business`/`enterprise` onto stored `pro`/`scale` without dropping the payload. */
export function normalizeBillingCatalogue(catalogue: BillingCatalogue): BillingCatalogue {
  return {
    ...catalogue,
    recommendedPlanId: canonicalCataloguePlanId(catalogue.recommendedPlanId) as PaidCataloguePlanId,
    lastTrialPlanId:
      catalogue.lastTrialPlanId == null
        ? catalogue.lastTrialPlanId
        : (canonicalCataloguePlanId(catalogue.lastTrialPlanId) as PaidCataloguePlanId),
    trialedPlanIds: catalogue.trialedPlanIds
      ? [
          ...new Set(
            catalogue.trialedPlanIds.map(
              (id) => canonicalCataloguePlanId(id) as PaidCataloguePlanId
            )
          ),
        ]
      : undefined,
    plans: catalogue.plans.map((plan) => ({
      ...plan,
      id: canonicalCataloguePlanId(plan.id),
    })),
    liteSeatsIncluded: remapPlanKeyedRecord(catalogue.liteSeatsIncluded) as
      Record<CataloguePlanId, number | null> | undefined,
    aiIncludedCentsPerMonth: remapPlanKeyedRecord(catalogue.aiIncludedCentsPerMonth),
  }
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

export type HostedBillingSessionInput =
  | { action: 'portal' }
  | {
      action: 'checkout'
      planId: PaidCataloguePlanId
      billingPeriod: 'monthly' | 'annual'
      quantity?: number
      /** Bundle branding removal into the same subscription and checkout. */
      brandingRemoval?: boolean
    }
  | { action: 'downgrade'; planId: 'free' }
  | { action: 'seats'; quantity: number }
  | { action: 'topup'; meter: 'ai' | 'email'; packs: number }
  | { action: 'branding'; billingPeriod: 'monthly' | 'annual' }
  | { action: 'branding-remove' }

export type HostedBillingSessionResult = {
  url?: string
  status?: 'downgraded' | 'scheduled' | 'updated'
}

function canonicalizeSessionInput(input: HostedBillingSessionInput): HostedBillingSessionInput {
  if (input.action !== 'checkout') return input
  const planId = canonicalCataloguePlanId(input.planId)
  return { ...input, planId: planId as PaidCataloguePlanId }
}

export async function createHostedBillingSession(
  input: HostedBillingSessionInput
): Promise<HostedBillingSessionResult> {
  const payload = canonicalizeSessionInput(input)
  const result = await callWorkspaceControlPlane<{ url?: unknown; status?: unknown }>(
    '/api/v1/internal/billing/session',
    payload
  )
  if (typeof result.url === 'string' && result.url.startsWith('https://')) {
    return { url: result.url }
  }
  if (input.action === 'downgrade') {
    if (result.status === 'downgraded' || result.status === 'scheduled') {
      return { status: result.status }
    }
    throw new ControlPlaneUnavailableError()
  }
  if (
    input.action === 'seats' ||
    input.action === 'branding' ||
    input.action === 'branding-remove' ||
    input.action === 'checkout'
  ) {
    if (result.status === 'updated' || result.status === 'scheduled') {
      return { status: result.status }
    }
    throw new ControlPlaneUnavailableError()
  }
  throw new ControlPlaneUnavailableError()
}

export type SeatsPreview = {
  amountDueCents: number | null
  currency?: 'usd'
  periodEnd?: string
}

export async function fetchSeatsPreview(quantity: number): Promise<SeatsPreview> {
  const result = await getWorkspaceControlPlane<{
    amountDueCents?: unknown
    currency?: unknown
    periodEnd?: unknown
  }>(`/api/v1/internal/billing/seats-preview?quantity=${encodeURIComponent(String(quantity))}`)
  if (result.amountDueCents === null) return { amountDueCents: null }
  if (typeof result.amountDueCents !== 'number' || !Number.isFinite(result.amountDueCents)) {
    return { amountDueCents: null }
  }
  return {
    amountDueCents: result.amountDueCents,
    currency: result.currency === 'usd' ? 'usd' : undefined,
    periodEnd: typeof result.periodEnd === 'string' ? result.periodEnd : undefined,
  }
}

export type WorkspaceUsageReport = {
  month: string
  aiTokens: number
  emailsSent: number
  teamSeatCount: number
  pendingInviteCount: number
  postCount: number
  boardCount: number
}

export async function reportWorkspaceUsage(report: WorkspaceUsageReport): Promise<void> {
  await callWorkspaceControlPlane('/api/v1/internal/usage/report', report)
}

export async function startWorkspaceTrial(
  planId: PaidCataloguePlanId
): Promise<'started' | 'already_started'> {
  const result = await callWorkspaceControlPlane<{ status?: unknown }>(
    '/api/v1/internal/billing/start-trial',
    { planId: canonicalCataloguePlanId(planId) }
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
