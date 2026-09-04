/**
 * Inline preview of claim → person-attribute writes, evaluated against the
 * last matching test capture. Extracted from OutcomePreviewRail so the
 * claim-mapping card can show it without mounting the unbuilt Identity
 * pickers. `existing` is always `{}`: the preview has no access to the
 * tester's stored attributes, so `kept_existing` cannot be shown truthfully.
 */

import { TimeAgo } from '@/components/ui/time-ago'
import { Badge } from '@/components/ui/badge'
import { getClaimByPath } from '@/lib/shared/oidc-claim-mapping'
import { planClaimAttributeWrites } from '@/lib/shared/plan-claim-attribute-writes'
import type { SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'

export function AttributeWritesPreview({
  capture,
  registrationId,
  detailsChangedAt,
  attributeRows,
  overrideExisting,
  syncOnSignIn,
  canTest,
}: {
  capture: SsoTestCapture | null
  registrationId: string
  detailsChangedAt?: string | null
  attributeRows: Array<{ claimPath: string; attributeKey: string }>
  overrideExisting: boolean
  syncOnSignIn: boolean
  canTest: boolean
}) {
  const { data: attributes } = useUserAttributes()
  const defs = (attributes ?? []).map((d) => ({
    key: d.key,
    type: d.type,
    label: d.label,
  }))

  if (!capture) {
    return (
      <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 px-3 py-3">
        <p className="text-xs text-muted-foreground">
          Run a test sign-in to preview what these mappings would write.
        </p>
        <TestSignInButton registrationId={registrationId} disabled={!canTest} />
      </div>
    )
  }

  const stale =
    !!detailsChangedAt &&
    new Date(detailsChangedAt).getTime() > new Date(capture.capturedAt).getTime()

  const claims = capture.claims as Record<string, unknown>
  const plan =
    attributeRows.length > 0
      ? planClaimAttributeWrites({
          claims,
          mapping: {
            map: attributeRows.filter((r) => r.claimPath && r.attributeKey),
            ...(overrideExisting ? { overrideExisting: true } : {}),
            ...(syncOnSignIn ? { syncOnSignIn: true } : {}),
          },
          existing: {},
          definitions: defs,
          explain: true,
        })
      : null

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 px-3 py-3 text-[12.5px]">
      <div>
        <div className="font-medium">Attribute writes from your last test sign-in</div>
        <div className="mt-0.5 text-muted-foreground">
          {capture.identity.email ?? capture.identity.id} · <TimeAgo date={capture.capturedAt} /> ·{' '}
          <TestSignInButton
            registrationId={registrationId}
            variant="link"
            size="sm"
            disabled={!canTest}
          >
            Re-test
          </TestSignInButton>
        </div>
      </div>

      {plan && (Object.keys(plan.valid).length > 0 || (plan.skips?.length ?? 0) > 0) ? (
        <dl className="grid grid-cols-[6.6em_1fr] gap-x-2.5 gap-y-1 text-[12px]">
          {defs
            .filter((d) => d.key in plan.valid || plan.skips?.some((s) => s.key === d.key))
            .map((d) => {
              const written = plan.valid[d.key]
              const skip = plan.skips?.find((s) => s.key === d.key)
              const row = attributeRows.find((r) => r.attributeKey === d.key)
              const raw = row ? getClaimByPath(claims, row.claimPath) : undefined
              const joined = Array.isArray(raw) && d.type === 'string' && written !== undefined
              return (
                <div key={d.key} className="contents">
                  <dt className="text-muted-foreground">{d.label}</dt>
                  <dd className="min-w-0 break-all">
                    {written !== undefined ? (
                      <>
                        “{String(written)}”
                        {joined && (
                          <Badge variant="outline" className="ml-1 align-middle">
                            array joined to text
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        skipped: {skipReason(skip?.reason, raw)}
                      </span>
                    )}
                  </dd>
                </div>
              )
            })}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">No attribute mappings yet.</p>
      )}

      {stale ? (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Configuration changed since capture. Re-test.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Assumes the person has no attributes yet. With Overwrite off, someone who already has a
          value keeps it.
        </p>
      )}
    </div>
  )
}

function skipReason(reason: string | undefined, raw: unknown): string {
  if (reason === 'type_mismatch') {
    const kind = raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw
    return `type mismatch (${kind})`
  }
  if (reason === 'kept_existing') return 'kept existing'
  return 'missing claim'
}
