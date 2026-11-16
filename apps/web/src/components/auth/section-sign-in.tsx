/**
 * Provider sign-in (OAuth, OIDC) for a visitor on a section host, run on the
 * primary domain at /auth/section-sign-in. The section host's
 * `/sign-in/social` sends the client there (lib/server/auth/section-sign-in.ts):
 * the provider's callback and the sign-in's state cookie live on this domain.
 * Once signed in here, the library sends the browser to the section handoff
 * on `to`, which carries the session back.
 *
 * `to` is only ever used inside the callback URLs handed to the library, which
 * refuses any origin that is not one of this workspace's trusted origins.
 * Nothing here navigates to `to` itself, so a crafted link cannot turn this
 * page into an open redirect.
 */
import { useEffect, useState } from 'react'
import { authClient } from '@/lib/client/auth-client'
import { handoffReturnTo, sectionHandoffUrl } from '@/lib/shared/section-handoff'

export interface SectionSignInSearch {
  provider?: string
  to?: string
  returnTo?: string
  errorReturnTo?: string
  loginHint?: string
}

/** A bare host name: letters, digits, dots and hyphens, nothing that changes the URL around it. */
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

export function SectionSignIn({ search }: { search: SectionSignInSearch }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const { provider, to } = search
    if (!provider || !to || !HOST_NAME.test(to) || to === window.location.hostname) {
      setFailed(true)
      return
    }
    const target = `https://${to}`
    let cancelled = false
    authClient.signIn
      .social({
        provider,
        callbackURL: sectionHandoffUrl({
          targetOrigin: target,
          fromHost: window.location.host,
          returnTo: handoffReturnTo(search.returnTo),
        }),
        errorCallbackURL: `${target}${handoffReturnTo(search.errorReturnTo ?? search.returnTo)}`,
        ...(search.loginHint ? { loginHint: search.loginHint } : {}),
        disableRedirect: true,
      })
      .then((result) => {
        const url = (result as { data?: { url?: string } | null })?.data?.url
        if (cancelled) return
        if (url) window.location.replace(url)
        else setFailed(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [search])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      {failed ? (
        <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Sign-in could not start</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Go back to the page you came from and try again.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Go to the home page
          </a>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Signing you in…</p>
      )}
    </main>
  )
}
