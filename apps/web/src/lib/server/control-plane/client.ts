import { createHmac } from 'node:crypto'
import {
  getCurrentWorkspace,
  getWorkspaceSecretKey,
} from '@/lib/server/workspaces/workspace-context'

export class ControlPlaneUnavailableError extends Error {
  constructor(message = 'Billing is temporarily unavailable. Please try again.') {
    super(message)
    this.name = 'ControlPlaneUnavailableError'
  }
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
  const workspace = getCurrentWorkspace()
  const secretKey = getWorkspaceSecretKey()
  if (!workspace || !secretKey) throw new ControlPlaneUnavailableError()
  const response = await fetch(new URL(path, controlPlaneOrigin()), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${deriveControlPlaneCredential(secretKey)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
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

export async function createHostedBillingSession(
  input:
    | { action: 'portal' }
    | {
        action: 'checkout'
        planId: 'growth' | 'pro' | 'scale'
        billingPeriod: 'monthly' | 'annual'
      }
): Promise<string> {
  const result = await callWorkspaceControlPlane<{ url?: unknown }>(
    '/api/v1/internal/billing/session',
    input
  )
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) {
    throw new ControlPlaneUnavailableError()
  }
  return result.url
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
