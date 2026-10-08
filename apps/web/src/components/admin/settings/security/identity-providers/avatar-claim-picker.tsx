/**
 * The Avatar mapping body: a claim path beside a preview of what sign-in
 * would make of it from the last test sign-in, and every claim that test sent
 * to choose from. The admin chooses; nothing is preselected or guessed.
 *
 * The preview replays the test through the same binder sign-in uses, under
 * the draft mapping with the typed claim as the avatar claim. So it reads the
 * same sources in the same order, takes the first http(s) URL any of them
 * holds, and a value that is not one blocks Apply. Avatar URLs often have no
 * file extension, so none is required. A claim the test did not send is
 * allowed, because the next sign-in may carry it, and a picture that fails to
 * load here is only a warning: the browser may simply not be allowed to fetch
 * it.
 */
import { useId, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { JsonValue } from '@/lib/shared/json'
import { deriveAttributeClaimPaths } from '@/lib/shared/claim-suggestions'
import {
  OIDC_PROFILE_DEFAULTS,
  getClaimByPath,
  identityMappingFor,
  type IdentityProviderClaimMapping,
} from '@/lib/shared/oidc-claim-mapping'
import {
  asHttpUrl,
  claimIsMissing,
  finishBinding,
  replayClaimMapping,
} from '@/lib/shared/sso-claim-binder'
import { previewProfileValues } from '@/lib/shared/sso-mapping-preview'
import {
  isReplayableCapture,
  type SsoTestCapture,
  type SsoTestCaptureV2,
} from '@/lib/shared/sso-test-capture'
import { cn } from '@/lib/shared/utils'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { ClaimPicture } from './claim-picture'

type Draft = IdentityProviderClaimMapping | null | undefined

export type AvatarClaimCheck =
  { kind: 'no_capture' } | { kind: 'missing' } | { kind: 'not_url' } | { kind: 'url'; url: string }

/** The claims sign-in accepts from the test under this mapping: each source
 *  it reads, in order, a later one adding only keys an earlier one lacked.
 *  `path` is also filled from a later source when an earlier one lacks it. */
function acceptedClaims(
  draft: Draft,
  capture: SsoTestCaptureV2,
  path?: string
): Record<string, JsonValue> {
  const bound = finishBinding(
    replayClaimMapping(
      {
        mapping: identityMappingFor(draft),
        requiredClaimPaths: path ? [path] : undefined,
        wantImage: true,
        exhaustive: true,
      },
      capture.replay.sources
    )
  )
  return bound.acceptedClaims as Record<string, JsonValue>
}

/** The claims to choose from: what sign-in reads from the last test under
 *  this draft. Null when the preview cannot replay that test. */
export function testSignInClaims(
  draft: Draft,
  capture: SsoTestCapture | null | undefined
): Record<string, JsonValue> | null {
  if (!capture || !isReplayableCapture(capture)) return null
  if (!previewProfileValues(draft, capture)) return null
  return acceptedClaims(draft, capture)
}

/**
 * What sign-in would make of `path` as the avatar claim, from the last test.
 * The avatar comes from the profile preview itself; the raw value is read only
 * to tell a claim the test did not send from one that is not an image URL. A
 * blank path is the standard `picture` claim.
 */
export function checkAvatarClaim(
  draft: Draft,
  capture: SsoTestCapture | null | undefined,
  path: string
): AvatarClaimCheck {
  if (!capture || !isReplayableCapture(capture)) return { kind: 'no_capture' }
  const claim = path.trim()
  const probe = {
    ...draft,
    profile: { ...draft?.profile, claims: { ...draft?.profile?.claims, image: claim } },
  }
  const values = previewProfileValues(probe, capture)
  if (!values) return { kind: 'no_capture' }
  if (values.image) return { kind: 'url', url: values.image }
  const read = claim || OIDC_PROFILE_DEFAULTS.image
  const raw = getClaimByPath(acceptedClaims(probe, capture, read), read)
  return claimIsMissing(raw) ? { kind: 'missing' } : { kind: 'not_url' }
}

function statusFor(check: AvatarClaimCheck, loadFailed: boolean): { text: string; tone: string } {
  switch (check.kind) {
    case 'no_capture':
      return { text: 'Run a test sign-in to preview', tone: 'text-muted-foreground' }
    case 'missing':
      return { text: 'Not in the last test sign-in', tone: 'text-muted-foreground' }
    case 'not_url':
      return { text: 'Not an image URL', tone: 'text-destructive' }
    case 'url':
      return loadFailed
        ? { text: 'Could not load this picture', tone: 'text-warning' }
        : { text: 'Shows this picture', tone: 'text-success' }
  }
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value) ?? String(value)
}

export function AvatarClaimPicker({
  value,
  onChange,
  check,
  claims,
  registrationId,
  canTest,
}: {
  value: string
  onChange: (next: string) => void
  /** `checkAvatarClaim` for `value`. */
  check: AvatarClaimCheck
  /** `testSignInClaims`, or null when there is no test to choose from. */
  claims: Record<string, JsonValue> | null
  registrationId: string
  canTest: boolean
}) {
  const id = useId()
  const inputId = `${id}-claim`
  const hintId = `${id}-hint`
  const statusId = `${id}-status`
  const listLabelId = `${id}-claims`
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  // Every leaf claim, with its value and, for an http(s) URL, a thumbnail.
  const options = useMemo(
    () =>
      claims
        ? deriveAttributeClaimPaths(claims).map(({ path }) => {
            const claimValue = getClaimByPath(claims, path)
            return { path, display: displayValue(claimValue), url: asHttpUrl(claimValue) }
          })
        : [],
    [claims]
  )

  const url = check.kind === 'url' ? check.url : undefined
  const status = statusFor(check, url !== undefined && failedUrl === url)
  const chosen = value.trim()

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor={inputId}>Provider claim</Label>
          <Input
            id={inputId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={OIDC_PROFILE_DEFAULTS.image}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={check.kind === 'not_url' || undefined}
            aria-describedby={`${hintId} ${statusId}`}
            className="font-mono text-[13px] md:text-[13px]"
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            For a nested claim use a dot, like profile.photo
          </p>
        </div>
        <figure
          className={cn(
            'm-0 flex w-[132px] shrink-0 flex-col items-center gap-2 rounded-lg border px-2.5 py-3 text-center',
            check.kind === 'not_url'
              ? 'border-destructive/30 bg-destructive/5'
              : 'border-border/50 bg-muted/30'
          )}
        >
          <ClaimPicture
            src={url}
            alt={url ? 'Picture from the test sign-in' : undefined}
            className="size-16"
            iconClassName="size-5"
            onError={() => setFailedUrl(url ?? null)}
          />
          <figcaption
            id={statusId}
            role="status"
            className={cn('text-xs leading-snug font-medium', status.tone)}
          >
            {status.text}
          </figcaption>
          {check.kind === 'no_capture' && (
            <TestSignInButton registrationId={registrationId} disabled={!canTest} />
          )}
        </figure>
      </div>

      {options.length > 0 && (
        <div className="space-y-1.5">
          <p id={listLabelId} className="text-sm font-medium">
            Claims in your last test sign-in
          </p>
          <ul
            aria-labelledby={listLabelId}
            className="max-h-56 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border/50"
          >
            {options.map((option) => {
              const pressed = option.path === chosen
              return (
                <li key={option.path}>
                  <button
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onChange(option.path)}
                    className={cn(
                      'grid min-h-11 w-full grid-cols-[minmax(0,8rem)_1.75rem_minmax(0,1fr)] items-center gap-2.5 px-3 py-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-muted-foreground/40 focus-visible:ring-inset',
                      pressed && 'bg-muted'
                    )}
                  >
                    <code className="max-w-full justify-self-start truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {option.path}
                    </code>
                    <span className="grid place-items-center">
                      {option.url && (
                        <ClaimPicture src={option.url} className="size-7" placeholder={false} />
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{option.display}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
