/**
 * Session-scoped outcome preview. Renders only when a test capture exists
 * for this provider. Evaluates the current draft against the captured
 * claims with pure functions — no network.
 */

import { TimeAgo } from '@/components/ui/time-ago'
import { Badge } from '@/components/ui/badge'
import { MENU_LABEL } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import { getClaimByPath } from '@/lib/shared/oidc-claim-mapping'
import { resolveSsoRoleMatch } from '@/lib/shared/resolve-sso-role'
import type { SsoTestCapture } from '../sso/use-sso-test-sign-in'
import { TestSignInButton } from '../sso/test-sign-in-button'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import { AttributeWritesPreview } from './attribute-writes-preview'

type RoleMapping = NonNullable<NonNullable<IdentityProvider['claimMapping']>['role']>

const SOURCE_WORDS: Record<string, string> = {
  idToken: 'ID token',
  userinfo: 'userinfo',
  accessTokenJwt: 'access token JWT',
}

export function OutcomePreviewRail({
  capture,
  provider,
  idClaim,
  emailClaim,
  nameClaim,
  roleMapping,
  attributeRows,
  overrideExisting,
  syncOnSignIn,
  registrationId,
}: {
  capture: SsoTestCapture
  provider: IdentityProvider | null
  idClaim: string
  emailClaim: string
  nameClaim: string
  roleMapping: RoleMapping | null
  attributeRows: Array<{ claimPath: string; attributeKey: string }>
  overrideExisting: boolean
  syncOnSignIn: boolean
  registrationId: string
}) {
  const stale =
    !!provider?.detailsChangedAt &&
    new Date(provider.detailsChangedAt).getTime() > new Date(capture.capturedAt).getTime()

  const paths = {
    id: idClaim.trim() || 'sub',
    email: emailClaim.trim() || 'email',
    name: nameClaim.trim() || 'name',
  }
  const claims = capture.claims as Record<string, unknown>
  const idValue = getClaimByPath(claims, paths.id)
  const emailValue = getClaimByPath(claims, paths.email)
  const nameValue = getClaimByPath(claims, paths.name)

  const match = resolveSsoRoleMatch(claims, roleMapping ?? undefined)
  const matchedRule = match && roleMapping ? roleMapping.rules[match.ruleIndex] : undefined

  const provenance = formatProvenance(capture.identity.sources)

  return (
    <aside className="flex flex-col gap-4 border-t border-border/40 bg-muted/20 px-4 py-5 text-[12.5px] lg:border-t-0 lg:border-l">
      <div>
        <h3 className={cn(MENU_LABEL, 'font-mono')}>Outcome preview</h3>
        <div className="mt-2 font-medium">Last test sign-in</div>
        <div className="mt-0.5 text-muted-foreground">
          {capture.identity.email ?? capture.identity.id} · <TimeAgo date={capture.capturedAt} /> ·{' '}
          <TestSignInButton
            registrationId={registrationId}
            variant="link"
            size="sm"
            disabled={!provider}
          >
            Re-test
          </TestSignInButton>
        </div>
      </div>

      <div className="border-t border-border/40 pt-3">
        <h3 className={cn(MENU_LABEL, 'mb-2 font-mono')}>Identity</h3>
        <dl className="grid grid-cols-[4.4em_1fr] gap-x-2.5 gap-y-1 font-mono text-[11.5px]">
          <dt className="font-sans text-muted-foreground">id</dt>
          <dd className="break-all">
            {formatValue(idValue)} <span className="text-muted-foreground">← {paths.id}</span>
          </dd>
          <dt className="font-sans text-muted-foreground">email</dt>
          <dd className="break-all">
            {formatValue(emailValue)} <span className="text-muted-foreground">← {paths.email}</span>
          </dd>
          <dt className="font-sans text-muted-foreground">name</dt>
          <dd className="break-all">
            {formatValue(nameValue)} <span className="text-muted-foreground">← {paths.name}</span>
          </dd>
        </dl>
        {provenance && <p className="mt-1.5 text-xs text-muted-foreground">{provenance}</p>}
      </div>

      <div className="border-t border-border/40 pt-3">
        <h3 className={cn(MENU_LABEL, 'mb-2 font-mono')}>Role</h3>
        {match && matchedRule ? (
          <div>
            <Badge variant="secondary" className="font-mono">
              {match.role}
            </Badge>
            <span className="ml-1.5">
              rule {match.ruleIndex + 1} matched:{' '}
              <span className="font-mono">{roleMapping?.claimPath}</span> contains{' '}
              <span className="font-mono">{matchedRule.whenContains}</span>
            </span>
          </div>
        ) : (
          <div>no rule matched</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          For a new user at a verified domain. Existing admins and members change only when Mirror
          the IdP is on.
        </p>
      </div>

      <div className="border-t border-border/40 pt-3">
        <AttributeWritesPreview
          capture={capture}
          registrationId={registrationId}
          detailsChangedAt={provider?.detailsChangedAt}
          attributeRows={attributeRows}
          overrideExisting={overrideExisting}
          syncOnSignIn={syncOnSignIn}
          canTest={!!provider}
        />
      </div>

      <div className="border-t border-border/40 pt-3 text-xs text-muted-foreground">
        {stale ? (
          <p className="text-amber-700 dark:text-amber-400">
            Configuration changed since capture. Re-test.
          </p>
        ) : (
          <p>
            Re-evaluates as you type. Changes to the connection, scopes, or identity settings
            invalidate this capture and ask for a fresh test.
          </p>
        )}
      </div>
    </aside>
  )
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

function formatProvenance(sources: SsoTestCapture['identity']['sources']): string | null {
  const seen: string[] = []
  for (const key of ['id', 'email', 'name'] as const) {
    const src = sources[key]
    if (!src) continue
    const word = SOURCE_WORDS[src] ?? src
    if (!seen.includes(word)) seen.push(word)
  }
  if (seen.length === 0) return null
  return `Captured via ${seen.join(' + ')}.`
}
