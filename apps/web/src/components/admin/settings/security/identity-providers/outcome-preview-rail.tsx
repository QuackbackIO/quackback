/**
 * Draft mapping preview. Replays the selected capture through the shared
 * binder. Diagnostic dump is admin-only and is never logged.
 */

import { useState } from 'react'
import { TimeAgo } from '@/components/ui/time-ago'
import { Badge } from '@/components/ui/badge'
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
  effectiveNamePath,
  previewClaimMapping,
  runtimeFallbackRole,
  type MappingPreviewPolicy,
} from '@/lib/shared/sso-mapping-preview'
import type { IdentityProviderClaimMapping } from '@/lib/shared/oidc-claim-mapping'
import type { AttributeDefinition } from '@/lib/shared/plan-claim-attribute-writes'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { AttributeWritesPreview } from './attribute-writes-preview'

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
  const cta = dirty ? 'Save and test' : capture ? 'Re-test' : 'Test sign-in'

  if (!preview.capture) {
    return (
      <aside className="flex flex-col gap-4 border-t border-border/40 bg-muted/20 px-4 py-5 text-[12.5px] lg:border-t-0 lg:border-l">
        <h3 className={cn(MENU_LABEL, 'font-mono')}>Preview</h3>
        <p className="text-xs text-muted-foreground">
          Run a test sign-in to inspect this IdP&apos;s claims and preview mappings.
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

  return (
    <aside className="flex flex-col gap-4 border-t border-border/40 bg-muted/20 px-4 py-5 text-[12.5px] lg:border-t-0 lg:border-l">
      <div>
        <h3 className={cn(MENU_LABEL, 'font-mono')}>Last test sign-in</h3>
        <div className="mt-2 font-medium">{captureIdentityCaption(preview.capture)}</div>
        <div className="mt-0.5 text-muted-foreground">
          <TimeAgo date={preview.capture.capturedAt} />
        </div>
        <div className="mt-2">
          <TestCta
            cta={cta}
            registrationId={registrationId}
            canTest={canTest}
            dirty={dirty}
            onSaveAndTest={onSaveAndTest}
          />
        </div>
      </div>

      {dirty && <p className="font-medium">Preview of unsaved mappings</p>}

      {preview.status === 'mapping_failed' && (
        <p className="text-amber-700 dark:text-amber-400">Connection test did not pass.</p>
      )}

      {preview.status === 'needs_retest' && preview.limitations[0] && (
        <p className="text-amber-700 dark:text-amber-400">{preview.limitations[0]}</p>
      )}

      {preview.stale && preview.status === 'ready' && (
        <p className="text-amber-700 dark:text-amber-400">
          Configuration changed since this test. Re-test to validate it. Preview uses the captured
          claims with your current draft.
        </p>
      )}

      {preview.identity && (
        <div className="border-t border-border/40 pt-3">
          <h3 className={cn(MENU_LABEL, 'mb-2 font-mono')}>Identity</h3>
          <IdentityLines draft={draft} identity={preview.identity} />
        </div>
      )}

      {preview.status !== 'needs_retest' && (
        <div className="border-t border-border/40 pt-3">
          <h3 className={cn(MENU_LABEL, 'mb-2 font-mono')}>Role</h3>
          {providerPolicy.autoCreateUsers === false ? (
            <p>Role application is disabled because auto-create is off.</p>
          ) : preview.roleMatch && draft?.role ? (
            <div>
              <Badge variant="secondary" className="font-mono">
                {preview.roleMatch.role}
              </Badge>
              <span className="ml-1.5">
                Rule {preview.roleMatch.ruleIndex + 1} matched:{' '}
                <span className="font-mono">{draft.role.claimPath}</span> equals an array member{' '}
                <span className="font-mono">
                  {draft.role.rules[preview.roleMatch.ruleIndex]?.whenContains}
                </span>
              </span>
            </div>
          ) : (
            <div>No match. {fallback.label}, at verified domains.</div>
          )}
          {roleRules.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-muted-foreground">All configured targets:</div>
              <ol className="mt-1 list-decimal pl-4">
                {roleRules.map((rule, index) => (
                  <li key={index}>
                    {rule.whenContains} {'->'} {rule.role}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            A matching rule assigns this role even outside this provider&apos;s verified domains.
            {hasAdminRule ? ' The preview matching member does not limit this admin rule.' : ''}
            {providerPolicy.autoCreateUsers
              ? ' Existing admin and member roles stay unless role sync is on.'
              : ''}
          </p>
        </div>
      )}

      {preview.status !== 'needs_retest' && (
        <div className="border-t border-border/40 pt-3">
          <AttributeWritesPreview
            capture={preview.capture}
            registrationId={registrationId}
            detailsChangedAt={providerPolicy.detailsChangedAt}
            attributeRows={draft?.attributes?.map ?? []}
            overrideExisting={draft?.attributes?.overrideExisting === true}
            syncOnSignIn={draft?.attributes?.syncOnSignIn === true}
            canTest={canTest}
            claims={preview.identity?.acceptedClaims}
            plan={preview.peoplePlan}
            hideCaptureChrome
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Name and email show account-creation inputs. Existing profiles are not overwritten on later
        sign-ins. People preview assumes no existing attributes.
      </p>

      <ClaimsDisclosure capture={preview.capture} />
    </aside>
  )
}

function IdentityLines({
  draft,
  identity,
}: {
  draft: IdentityProviderClaimMapping | null
  identity: NonNullable<ReturnType<typeof previewClaimMapping>['identity']>
}) {
  const idPath = effectiveIdPath(draft)
  const emailPath = effectiveEmailPath(draft)
  const namePath = effectiveNamePath(draft)
  return (
    <dl className="grid grid-cols-[6.2em_1fr] gap-x-2.5 gap-y-1 font-mono text-[11.5px]">
      <dt className="font-sans text-muted-foreground">Identifier</dt>
      <dd className="break-all">
        {identity.id ?? 'Not supplied'}
        {identity.provenance.id && (
          <span className="text-muted-foreground">
            {' '}
            {'<-'} {identity.provenance.id.path}, {SOURCE_WORDS[identity.provenance.id.source]}
          </span>
        )}
      </dd>
      <dt className="font-sans text-muted-foreground">Email</dt>
      <dd className="break-all">
        {identity.kind === 'placeholder_required'
          ? 'A placeholder address will be used.'
          : identity.kind === 'missing_email'
            ? `Not supplied by the configured path ${emailPath}`
            : (identity.email ?? 'Not supplied')}
        {identity.provenance.email && identity.kind === 'identity' && (
          <span className="text-muted-foreground">
            {' '}
            {'<-'} {identity.provenance.email.path},{' '}
            {SOURCE_WORDS[identity.provenance.email.source]}
          </span>
        )}
      </dd>
      <dt className="font-sans text-muted-foreground">Name</dt>
      <dd className="break-all">
        {identity.name ?? 'Not supplied'}
        {identity.nameSynthesized
          ? ' (generated)'
          : identity.provenance.name
            ? ` <- ${identity.provenance.name.path}, ${SOURCE_WORDS[identity.provenance.name.source]}`
            : !identity.name
              ? ` <- ${namePath}`
              : ''}
      </dd>
      {identity.warnings.includes('subject_mismatch') && (
        <dd className="col-span-2 font-sans text-xs text-muted-foreground">
          A mismatched source was kept for diagnostics and is excluded from the sign-in outcome.
        </dd>
      )}
      {identity.id === undefined && (
        <dd className="col-span-2 font-sans text-xs text-muted-foreground">
          Not supplied by the configured path {idPath}.
        </dd>
      )}
    </dl>
  )
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

function ClaimsDisclosure({ capture }: { capture: SsoTestCapture }) {
  const [showProtocol, setShowProtocol] = useState(false)
  const claims = capture.claims
  const keys = Object.keys(claims).filter(
    (key) => showProtocol || !PROTOCOL_KEYS.has(key) || key === 'sub'
  )
  if (!keys.includes('sub') && Object.prototype.hasOwnProperty.call(claims, 'sub')) {
    keys.unshift('sub')
  }
  const sources = isReplayableCapture(capture) ? capture.replay.sources : []

  return (
    <details className="border-t border-border/40 pt-3">
      <summary className="cursor-pointer text-sm font-medium">Claims from test sign-in</summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Personal data. Share only with people who should have access.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={showProtocol}
          onChange={(e) => setShowProtocol(e.target.checked)}
        />
        Show protocol claims
      </label>
      <dl className="mt-2 grid grid-cols-[7em_1fr] gap-x-2.5 gap-y-1 font-mono text-[11px]">
        {keys.map((key) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground break-all">{key}</dt>
            <dd className="min-w-0 break-all">{escapeClaimValue(claims[key])}</dd>
          </div>
        ))}
      </dl>
      {sources.length > 0 && (
        <div className="mt-3 space-y-2">
          {sources.map((snapshot) => (
            <div key={snapshot.source}>
              <div className="text-xs font-medium">{SOURCE_WORDS[snapshot.source]}</div>
              {snapshot.unavailable ? (
                <p className="text-xs text-muted-foreground">
                  Unavailable ({snapshot.unavailable})
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {Object.keys(snapshot.claims ?? {}).length} claims captured
                </p>
              )}
            </div>
          ))}
        </div>
      )}
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
