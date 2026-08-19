import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { startProviderLink } from '@/lib/client/start-provider-link'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

interface LinkSsoSearch {
  provider?: string
  type?: 'oidc' | 'social'
  next?: string
}

/**
 * Magic-link landing for the account-link-conflict recovery flow.
 *
 * When an OAuth/OIDC sign-in fails with `account_not_linked` (an
 * existing local account wasn't verified), the recovery emails the user
 * a magic link whose callback points here with `?provider=…&type=…&next=…`.
 * Arriving means the magic-link verify just succeeded: the user is
 * signed in and their email is now verified. This page immediately
 * resumes the original attempt via Better-Auth's *explicit* link
 * endpoints (`/oauth2/link` / `linkSocial`), which link under the
 * active session — the IdP session is still warm, so the round-trip is
 * usually instant — and land on `next` with SSO connected.
 *
 * If resuming fails the user is still signed in; they land on `next`
 * anyway and the next SSO sign-in will link implicitly now that the
 * email is verified.
 */
export const Route = createFileRoute('/auth/link-sso')({
  validateSearch: (search: Record<string, unknown>): LinkSsoSearch => ({
    provider:
      typeof search.provider === 'string' && /^[a-z0-9_-]{1,64}$/i.test(search.provider)
        ? search.provider
        : undefined,
    type: search.type === 'oidc' || search.type === 'social' ? search.type : undefined,
    next: isSafeCallbackUrl(search.next) ? search.next : undefined,
  }),
  component: LinkSsoPage,
})

function LinkSsoPage() {
  const { provider, type, next } = Route.useSearch()
  const destination = next ?? '/'
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const resume = async () => {
      if (!provider || !type) {
        window.location.assign(destination)
        return
      }
      try {
        const url = await startProviderLink({
          providerId: provider,
          providerType: type,
          callbackURL: destination,
        })
        if (url) {
          window.location.assign(url)
          return
        }
        // No redirect URL back means the link call was refused — the
        // session is still valid, so continue to the destination.
        window.location.assign(destination)
      } catch {
        setFailed(true)
      }
    }
    void resume()
  }, [provider, type, destination])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 p-8 max-w-md">
        {failed ? (
          <>
            <ExclamationTriangleIcon className="h-12 w-12 text-amber-500 mx-auto" />
            <p className="text-foreground font-medium">You&apos;re signed in</p>
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t connect single sign-on automatically, but your email is confirmed —
              the next time you sign in with SSO it will be linked to this account.
            </p>
            <a href={destination} className="text-sm font-medium text-primary hover:underline">
              Continue
            </a>
          </>
        ) : (
          <>
            <ArrowPathIcon className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Connecting single sign-on…</p>
          </>
        )}
      </div>
    </div>
  )
}
