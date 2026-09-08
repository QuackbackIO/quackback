/**
 * What the last test sign-in would produce under the current draft. Replays
 * the captured sources through the same binder production uses.
 *
 * The visible result is the short version — the person, their email, and the
 * role rule that applied. Provenance, raw claims and per-source snapshots are
 * for troubleshooting and live under "View test details". Diagnostic data is
 * admin-only and never logged.
 */

import { useState } from 'react'
import { TimeAgo } from '@/components/ui/time-ago'
import { Button } from '@/components/ui/button'
import { MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import {
  captureIdentityCaption,
  isReplayableCapture,
  type SsoTestCapture,
} from '@/lib/shared/sso-test-capture'
import {
  SOURCE_WORDS,
  effectiveEmailPath,
  effectiveIdPath,
  previewClaimMapping,
  runtimeFallbackRole,
  type MappingPreviewPolicy,
} from '@/lib/shared/sso-mapping-preview'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'
import type { AttributeDefinition } from '@/lib/shared/plan-claim-attribute-writes'
import type { ProfileOutcome } from '@/lib/shared/sso-profile-outcome'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { AttributeWritesPreview } from './attribute-writes-preview'
import { PROFILE_ROW_LABELS } from './provider-shared'

const PROTOCOL_KEYS = new Set([
  'iss',
  'aud',
  'exp',
  'iat',
  'nbf',
  'jti',
  'nonce',
  'azp',
  'at_hash',
  'c_hash',
  'sid',
  'rh',
  'uti',
  'aio',
  'ver',
  'amr',
  'acr',
])

export function OutcomePreviewRail({
  capture,
  draft,
  definitions,
  providerPolicy,
  dirty,
  onSaveAndTest,
  registrationId,
  canTest,
}: {
  capture: SsoTestCapture | null
  draft: IdentityProviderClaimMapping | null
  definitions: AttributeDefinition[]
  providerPolicy: MappingPreviewPolicy
  dirty: boolean
  onSaveAndTest?: () => void
  registrationId: string
  canTest: boolean
}) {
  const preview = previewClaimMapping({
    draft,
    capture,
    definitions,
    providerPolicy,
  })
  const cta = dirty ? 'Save and test' : capture ? 'Test again' : 'Test sign-in'

  if (!preview.capture) {
    return (
      <aside className="flex flex-col gap-3 rounded-lg border border-border/40 bg-muted/20 px-4 py-4 text-sm">
        <h3 className={cn(MENU_LABEL, 'font-mono')}>Preview</h3>
        <p className="text-muted-foreground">
          Run a test sign-in to inspect this IdP&apos;s claims and preview how they map.
        </p>
        <TestCta
          cta={cta}
          registrationId={registrationId}
          canTest={canTest}
          dirty={dirty}
          onSaveAndTest={onSaveAndTest}
        />
      </aside>
    )
  }

  const fallback = runtimeFallbackRole(providerPolicy.autoProvisionRole)
  const roleRules = draft?.role?.rules ?? []
  const hasAdminRule = roleRules.some((r) => r.role === 'admin')
  const identity = preview.identity

  return (
    <aside className="flex min-w-0 flex-col gap-4 rounded-lg border border-border/40 bg-muted/20 px-4 py-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className={cn(MENU_LABEL, 'font-mono')}>Last test sign-in</h3>
          <div className="mt-1.5 font-medium">{captureIdentityCaption(preview.capture)}</div>
          <div className="text-muted-foreground">
            <TimeAgo date={preview.capture.capturedAt} />
          </div>
        </div>
        <TestCta
          cta={cta}
          registrationId={registrationId}
          canTest={canTest}
          dirty={dirty}
          onSaveAndTest={onSaveAndTest}
        />
      </div>

      {dirty && <p className="font-medium">Preview of unsaved changes</p>}

      {preview.status === 'mapping_failed' && (
        <p className="text-amber-700 dark:text-amber-400">Connection test did not pass.</p>
      )}

      {preview.status === 'needs_retest' && preview.limitations[0] && (
        <p className="text-amber-700 dark:text-amber-400">{preview.limitations[0]}</p>
      )}

      {preview.stale && preview.status === 'ready' && (
        <p className="text-amber-700 dark:text-amber-400">
          Configuration changed since this test. Test again to confirm it.
        </p>
      )}

      {identity && (
        <dl className="grid grid-cols-[6.6em_1fr] gap-x-3 gap-y-1.5 border-t border-border/40 pt-3">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="min-w-0 break-words">
            {identity.name ?? 'Not supplied'}
            {identity.nameSynthesized && (
              <span className="text-muted-foreground"> (generated)</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 break-all">
            <EmailValue identity={identity} draft={draft} />
          </dd>
          <dt className="text-muted-foreground">Account ID</dt>
          <dd className="min-w-0 break-all font-mono text-xs">
            {identity.id ?? `Not supplied by ${effectiveIdPath(draft)}`}
          </dd>
        </dl>
      )}

      {preview.status !== 'needs_retest' && (
        <div className="border-t border-border/40 pt-3">
          <h3 className={cn(MENU_LABEL, 'mb-1.5 font-mono')}>Role</h3>
          {providerPolicy.autoCreateUsers === false ? (
            <p>Roles are not applied because account creation is off.</p>
          ) : preview.roleMatch && draft?.role ? (
            <p>
              <span className="font-medium">{preview.roleMatch.role}</span> — rule{' '}
              {preview.roleMatch.ruleIndex + 1} matched{' '}
              <span className="font-mono text-xs">
                {draft.role.rules[preview.roleMatch.ruleIndex]?.whenContains}
              </span>{' '}
              in <span className="font-mono text-xs">{draft.role.claimPath}</span>.
            </p>
          ) : (
            <p>
              {roleRules.length > 0 ? 'No rule matched. ' : ''}
              {fallback.label} at verified domains.
            </p>
          )}
          {hasAdminRule && providerPolicy.autoCreateUsers !== false && (
            <p className="mt-1.5 text-muted-foreground">
              An admin rule grants admin access even outside this provider&apos;s verified domains.
              A test that matches another rule does not limit this admin rule.
            </p>
          )}
        </div>
      )}

      {preview.status !== 'needs_retest' && (draft?.attributes?.map?.length ?? 0) > 0 && (
        <div className="border-t border-border/40 pt-3">
          <AttributeWritesPreview
            capture={preview.capture}
            registrationId={registrationId}
            detailsChangedAt={providerPolicy.detailsChangedAt}
            attributeRows={draft?.attributes?.map ?? []}
            overrideExisting={draft?.attributes?.overrideExisting === true}
            syncOnSignIn={draft?.attributes?.syncOnSignIn === true}
            canTest={canTest}
            claims={identity?.acceptedClaims}
            plan={preview.peoplePlan}
            hideCaptureChrome
          />
        </div>
      )}

      <TestDetails capture={preview.capture} identity={identity} />
    </aside>
  )
}

function EmailValue({
  identity,
  draft,
}: {
  identity: ProfileOutcome
  draft: IdentityProviderClaimMapping | null
}) {
  if (identity.kind === 'placeholder_required') return <>A placeholder address will be used.</>
  if (identity.kind === 'missing_email') {
    return <>Not supplied by {effectiveEmailPath(draft)}</>
  }
  return <>{identity.email ?? 'Not supplied'}</>
}

function TestCta({
  cta,
  registrationId,
  canTest,
  dirty,
  onSaveAndTest,
}: {
  cta: string
  registrationId: string
  canTest: boolean
  dirty: boolean
  onSaveAndTest?: () => void
}) {
  if (dirty) {
    return (
      <Button type="button" size="sm" onClick={onSaveAndTest} disabled={!canTest}>
        {cta}
      </Button>
    )
  }
  return (
    <TestSignInButton registrationId={registrationId} disabled={!canTest}>
      {cta}
    </TestSignInButton>
  )
}

/**
 * Troubleshooting detail for one capture: where each profile field came from,
 * the raw claims, and which sources the test could read. Collapsed because
 * this is for when something is wrong, not for reading every visit.
 */
export function TestDetails({
  capture,
  identity,
  className,
}: {
  capture: SsoTestCapture
  identity: ProfileOutcome | null
  className?: string
}) {
  const [showProtocol, setShowProtocol] = useState(false)
  const claims = capture.claims
  const keys = Object.keys(claims).filter(
    (key) => showProtocol || !PROTOCOL_KEYS.has(key) || key === 'sub'
  )
  if (!keys.includes('sub') && Object.prototype.hasOwnProperty.call(claims, 'sub')) {
    keys.unshift('sub')
  }
  const sources = isReplayableCapture(capture) ? capture.replay.sources : []
  const provenance = identity
    ? (['id', 'email', 'name'] as const).flatMap((field) => {
        const from = identity.provenance[field]
        return from ? [{ field, path: from.path, source: SOURCE_WORDS[from.source] }] : []
      })
    : []

  return (
    <details className={cn('border-t border-border/40 pt-3 text-sm', className)}>
      <summary className="cursor-pointer font-medium">View test details</summary>
      <div className="mt-3 space-y-4">
        {provenance.length > 0 && (
          <div>
            <h4 className={cn(MENU_LABEL, 'mb-1.5 font-mono')}>Where each field came from</h4>
            <dl className="grid grid-cols-[6.6em_1fr] gap-x-3 gap-y-1">
              {provenance.map((p) => (
                <div key={p.field} className="contents">
                  <dt className="text-muted-foreground">{PROFILE_ROW_LABELS[p.field]}</dt>
                  <dd className="min-w-0 break-all">
                    <span className="font-mono text-xs">{p.path}</span>
                    <span className="text-muted-foreground"> from {p.source}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {identity?.warnings.includes('subject_mismatch') && (
              <p className="mt-1.5 text-muted-foreground">
                A source whose subject did not match was kept for diagnostics and excluded from the
                sign-in outcome.
              </p>
            )}
          </div>
        )}

        {sources.length > 0 && (
          <div>
            <h4 className={cn(MENU_LABEL, 'mb-1.5 font-mono')}>Sources</h4>
            <ul className="space-y-0.5">
              {sources.map((snapshot) => (
                <li key={snapshot.source}>
                  <span className="font-medium">{SOURCE_WORDS[snapshot.source]}</span>
                  <span className="text-muted-foreground">
                    {snapshot.unavailable
                      ? ` — unavailable (${snapshot.unavailable})`
                      : ` — ${Object.keys(snapshot.claims ?? {}).length} claims`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className={cn(MENU_LABEL, 'font-mono')}>Claims</h4>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={showProtocol}
                onChange={(e) => setShowProtocol(e.target.checked)}
              />
              Show protocol claims
            </label>
          </div>
          <p className="mt-1 text-muted-foreground">
            Personal data. Share only with people who should have access.
          </p>
          <dl className="mt-2 space-y-1.5 font-mono text-[11px]">
            {keys.map((key) => (
              <div key={key} className="min-w-0">
                <dt className="break-all text-muted-foreground">{key}</dt>
                <dd className="min-w-0 break-all">{escapeClaimValue(claims[key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </details>
  )
}

function escapeClaimValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not supplied'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return 'Not supplied'
  }
}
