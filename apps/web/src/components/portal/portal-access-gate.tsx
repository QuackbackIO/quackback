/**
 * In-place privacy wall for private portals.
 *
 * Renders a decorative blurred backdrop (purely fake chrome — no real portal
 * content ever reaches this component) with a centered card overlay.
 *
 * Two variants:
 *   - unauthenticated: sign-in CTA that opens the existing portal auth dialog.
 *   - unauthorized: informational message, no CTA.
 *
 * After a successful sign-in the router is invalidated so the _portal loader
 * re-runs; if the visitor is now authorized, the real portal replaces this.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { useAuthPopover } from '@/components/auth/auth-popover-context'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { signOut } from '@/lib/client/auth-client'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'

// ── Types ────────────────────────────────────────────────────────────────────

// Re-exported so existing `import type { PortalAccessGateError } from
// '@/components/portal/portal-access-gate'` imports keep working.
export type { PortalAccessGateError } from '@/lib/shared/types/portal-gate-error'

// ── Decorative backdrop ───────────────────────────────────────────────────────

/** A purely fake portal chrome — rows of skeleton elements that mimic the
 *  layout of a feedback list. No real data is ever loaded or shown. */
function DecorativeBackdrop() {
  return (
    <div className="min-h-screen bg-background select-none pointer-events-none" aria-hidden>
      {/* Fake header */}
      <div className="w-full py-2 border-b border-border bg-background shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-4 w-32 hidden sm:block" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
          {/* Fake nav */}
          <div className="mt-2 flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      {/* Fake content area */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-8">
          {/* Main column */}
          <div className="flex-1 space-y-4">
            <Skeleton className="h-10 w-48 rounded-md" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <div className="flex gap-3 pt-1">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-12 rounded-full" />
                </div>
              </div>
            ))}
          </div>
          {/* Sidebar */}
          <div className="hidden lg:block w-64 space-y-4">
            <Skeleton className="h-6 w-24" />
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inner card (needs auth popover context) ───────────────────────────────────

interface GateCardProps {
  reason: 'unauthenticated' | 'unauthorized'
  workspaceName: string
  logoUrl: string | null
  authConfig: PortalAccessGateError['authConfig']
  /** Signed-in visitor's email when reason === 'unauthorized'. */
  userEmail?: string | null
}

function GateCard({ reason, workspaceName, logoUrl, authConfig, userEmail }: GateCardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { openAuthPopover } = useAuthPopover()
  const [signingOut, setSigningOut] = useState(false)

  // After a successful sign-in, re-evaluate access by re-running the loader.
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
  })

  const handleSignIn = () => {
    openAuthPopover({
      mode: 'login',
      onSuccess: () => {
        // onAuthSuccess in the context already closes the dialog; invalidate
        // here so the _portal loader re-runs immediately after.
        router.invalidate()
      },
    })
  }

  // Sign out + invalidate so the gate re-evaluates as unauthenticated and
  // the visitor can sign back in with a different account. Mirrors the
  // portal-header sign-out path so cookie + cache + router stay in sync.
  //
  // All invalidations are awaited so the spinner doesn't clear before
  // the loader has actually re-run — otherwise the gate keeps showing
  // the old userEmail message with a re-enabled Sign-out button for a
  // visible frame. The signOut call itself is wrapped in catch so a
  // CSRF / network failure surfaces a toast instead of silently
  // bouncing back to the same screen.
  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal', 'post'] }),
        queryClient.invalidateQueries({ queryKey: ['votedPosts'] }),
        router.invalidate(),
      ])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign out failed. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border bg-card shadow-lg p-8 w-full max-w-sm text-center space-y-4">
        {/* Org logo, or the workspace initial as a branded fallback (matches
            the portal header — never a generic icon). */}
        {logoUrl ? (
          <img src={logoUrl} alt={workspaceName} className="mx-auto h-12 w-auto object-contain" />
        ) : (
          <div className="mx-auto flex h-12 w-12 items-center justify-center [border-radius:calc(var(--radius)*0.6)] bg-primary text-lg font-semibold text-primary-foreground">
            {workspaceName.charAt(0).toUpperCase()}
          </div>
        )}

        {reason === 'unauthenticated' ? (
          <>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Sign in to access {workspaceName}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This portal is private. Sign in or create an account to continue.
              </p>
            </div>
            <Button className="w-full" onClick={handleSignIn}>
              Sign in / Register
            </Button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">You don&apos;t have access</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {userEmail ? (
                  <>
                    You&apos;re signed in as{' '}
                    <span className="font-medium text-foreground">{userEmail}</span>, but this
                    account isn&apos;t on the access list for this private portal.
                  </>
                ) : (
                  <>This portal is private and your account isn&apos;t on the access list.</>
                )}{' '}
                Reach out to the {workspaceName} team to request access, or sign out and try a
                different account.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {signingOut ? <ArrowPathIcon className="mr-2 h-3 w-3 animate-spin" /> : null}
              Sign out
            </Button>
          </>
        )}
      </div>

      {/* Auth dialog — mounted here so the CTA can open it */}
      <AuthDialog authConfig={authConfig} workspaceName={workspaceName} />
    </>
  )
}

// ── Public export ─────────────────────────────────────────────────────────────

export interface PortalAccessGateProps
  extends
    Omit<GateCardProps, 'authConfig'>,
    Pick<
      PortalAccessGateError,
      'authConfig' | 'themeStyles' | 'customCss' | 'userEmail' | 'locale'
    > {}

export function PortalAccessGate({
  reason,
  workspaceName,
  logoUrl,
  authConfig,
  themeStyles,
  customCss,
  userEmail,
  locale,
}: PortalAccessGateProps) {
  return (
    // The gate renders on the route's error path (a beforeLoad throw), which
    // skips the loader that mounts PortalIntlProvider for the normal portal.
    // The auth dialog below uses react-intl, so the gate provides its own
    // provider — without it <FormattedMessage> has no context and crashes.
    // No SSR catalog here (the error path has no loader data); useIntlSetup
    // fetches it client-side, which lands well before the user opens the dialog.
    <PortalIntlProvider locale={locale ?? DEFAULT_LOCALE}>
      <div className="relative min-h-screen">
        {/* Theme/custom CSS injected here too so the backdrop looks branded */}
        {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
        {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

        {/* Blurred decorative backdrop */}
        <div className="absolute inset-0 overflow-hidden blur-sm" aria-hidden>
          <DecorativeBackdrop />
        </div>

        {/* Darkening scrim */}
        <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" aria-hidden />

        {/* Centered card */}
        <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
          <AuthPopoverProvider>
            <GateCard
              reason={reason}
              workspaceName={workspaceName}
              logoUrl={logoUrl}
              authConfig={authConfig}
              userEmail={userEmail}
            />
          </AuthPopoverProvider>
        </div>
      </div>
    </PortalIntlProvider>
  )
}
