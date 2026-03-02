import { createFileRoute, isRedirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import {
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  BoltIcon,
  MapIcon,
} from '@heroicons/react/24/outline'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  acceptInvitationFn,
  getInvitationDetailsFn,
  getInviteBrandingFn,
  setPasswordFn,
} from '@/lib/server/functions/invitations'

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_TOKEN:
    'This invitation link is invalid. It may have already been used. Please ask your administrator to resend the invitation.',
  EXPIRED_TOKEN:
    'This invitation link has expired. Please ask your administrator to resend the invitation.',
  failed_to_create_user:
    "We couldn't create your account. Please try again or contact your administrator.",
  new_user_signup_disabled:
    'New account creation is currently disabled. Please contact your administrator.',
  failed_to_create_session: "We couldn't sign you in. Please try again.",
}

const FEATURES = [
  { icon: ChatBubbleLeftRightIcon, label: 'Feedback & voting' },
  { icon: SparklesIcon, label: 'AI-powered insights' },
  { icon: BoltIcon, label: '24 integrations' },
  { icon: MapIcon, label: 'Roadmap & changelog' },
] as const

interface InviteBranding {
  workspaceName: string
  logoUrl: string | null
  inviterName: string | null
}

const DEFAULT_BRANDING: InviteBranding = {
  workspaceName: 'Quackback',
  logoUrl: null,
  inviterName: null,
}

export const Route = createFileRoute('/accept-invitation/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: (search.error as string) || undefined,
  }),
  loader: async ({ params, context }) => {
    const { id } = params
    const { session } = context

    const branding = await getInviteBrandingFn({ data: id }).catch(() => DEFAULT_BRANDING)

    if (!session?.user) {
      return { state: 'not-authenticated' as const, branding }
    }

    try {
      const data = await getInvitationDetailsFn({ data: id })
      return { state: 'welcome' as const, ...data, branding }
    } catch (err) {
      if (isRedirect(err)) throw err
      const message = err instanceof Error ? err.message : 'Failed to load invitation'
      return { state: 'error' as const, error: message, branding }
    }
  },
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const data = Route.useLoaderData()
  const { error: errorCode } = Route.useSearch()
  const { id } = Route.useParams()
  const { branding } = data

  if (errorCode) {
    const message =
      ERROR_MESSAGES[errorCode] ??
      'Something went wrong with the invitation link. Please ask your administrator to resend the invitation.'
    return (
      <PageShell>
        <ErrorContent error={message} invitationId={id} errorKind="token" branding={branding} />
      </PageShell>
    )
  }

  if (data.state === 'not-authenticated') {
    return (
      <PageShell>
        <NotAuthenticatedContent invitationId={id} branding={branding} />
        <FeatureHighlights />
      </PageShell>
    )
  }

  if (data.state === 'error') {
    return (
      <PageShell>
        <ErrorContent error={data.error} invitationId={id} branding={branding} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <WelcomeContent
        invite={data.invite}
        passwordEnabled={data.passwordEnabled}
        requiresPasswordSetup={data.requiresPasswordSetup}
        branding={branding}
      />
      <FeatureHighlights />
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.07]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 50% at 25% 15%, var(--primary), transparent),
            radial-gradient(ellipse 50% 80% at 80% 85%, var(--primary), transparent)
          `,
        }}
      />
      <div className="relative w-full max-w-md py-12">
        <div className="mb-8 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="" className="h-6 w-6 rounded" />
          <span className="text-sm font-medium text-muted-foreground">Quackback</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function WorkspaceIdentity({ branding }: { branding: InviteBranding }) {
  return (
    <div className="flex items-center justify-center gap-2.5">
      {branding.logoUrl ? (
        <img
          src={branding.logoUrl}
          alt={branding.workspaceName}
          className="h-8 w-8 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold">
          {branding.workspaceName.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-lg font-semibold">{branding.workspaceName}</span>
    </div>
  )
}

function FeatureHighlights() {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
      {FEATURES.map(({ icon: Icon, label }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 rounded-full border border-border/30 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {label}
        </div>
      ))}
    </div>
  )
}

function NotAuthenticatedContent({
  invitationId,
  branding,
}: {
  invitationId: string
  branding: InviteBranding
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-8 text-center backdrop-blur-sm"
      style={{
        boxShadow:
          '0 0 80px -20px oklch(0.886 0.176 86 / 0.12), 0 20px 40px -12px rgb(0 0 0 / 0.08)',
      }}
    >
      <WorkspaceIdentity branding={branding} />
      <div className="mt-6 mb-6 h-px bg-border/50" />
      <h1 className="text-2xl font-bold tracking-tight">You're invited!</h1>
      <p className="mt-2 text-muted-foreground">
        {branding.inviterName
          ? `${branding.inviterName} invited you to join the team. Sign in to get started.`
          : 'Sign in to accept your invitation and get started with your team.'}
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <a href={`/admin/login?callbackUrl=/accept-invitation/${invitationId}`}>
          <Button className="w-full h-11">Sign in</Button>
        </a>
        <a
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Go to Home
        </a>
      </div>
    </div>
  )
}

function WelcomeContent({
  invite,
  passwordEnabled,
  requiresPasswordSetup,
  branding,
}: {
  invite: {
    name: string | null
    email: string
    workspaceName: string
    inviterName: string | null
  }
  passwordEnabled: boolean
  requiresPasswordSetup: boolean
  branding: InviteBranding
}) {
  const { id } = Route.useParams()
  const [name, setName] = useState(invite.name ?? '')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await accept(false)
  }

  async function accept(skipPassword: boolean) {
    const trimmedName = name.trim()

    if (trimmedName.length < 2) {
      setError('Please enter your name (at least 2 characters)')
      return
    }
    if (requiresPasswordSetup && password.length < 8) {
      setError('Please set a password (at least 8 characters)')
      return
    }
    if (!requiresPasswordSetup && !skipPassword && password && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setError('')
    setIsLoading(true)

    try {
      if (requiresPasswordSetup) {
        await setPasswordFn({ data: { newPassword: password } })
      }

      await acceptInvitationFn({ data: { invitationId: id, name: trimmedName } })

      if (!requiresPasswordSetup && !skipPassword && password.length >= 8) {
        await setPasswordFn({ data: { newPassword: password } }).catch((err) => {
          console.warn('[accept-invitation] optional setPassword failed:', err)
        })
      }

      window.location.href = '/admin'
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation'
      if (message.includes('already been accepted')) {
        window.location.href = '/admin'
        return
      }
      setError(message)
      setIsLoading(false)
    }
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 backdrop-blur-sm"
      style={{
        boxShadow:
          '0 0 80px -20px oklch(0.886 0.176 86 / 0.12), 0 20px 40px -12px rgb(0 0 0 / 0.08)',
      }}
    >
      <div className="p-8">
        <WorkspaceIdentity branding={branding} />
        <div className="mt-6 mb-6 h-px bg-border/50" />
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome!</h1>
          <p className="mt-2 text-muted-foreground">
            {invite.inviterName
              ? `Invited by ${invite.inviterName}`
              : 'Complete your account setup to get started'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Your name
            </label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Jane Doe"
              autoComplete="name"
              autoFocus
              disabled={isLoading}
              className="h-11"
            />
          </div>

          {passwordEnabled && (
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Set a password{' '}
                {!requiresPasswordSetup && (
                  <span className="text-muted-foreground font-normal">(optional)</span>
                )}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={isLoading}
                required={requiresPasswordSetup}
                className="h-11"
              />
            </div>
          )}

          <Button
            type="submit"
            disabled={
              isLoading || name.trim().length < 2 || (requiresPasswordSetup && password.length < 8)
            }
            className="w-full h-11"
          >
            {isLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Get started'}
          </Button>

          {passwordEnabled && !requiresPasswordSetup && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => accept(true)}
              disabled={isLoading}
              className="w-full text-muted-foreground"
            >
              Skip password setup
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}

type ErrorKind = 'token' | 'already-accepted' | 'generic'

function getErrorKind(error: string): ErrorKind {
  if (error.includes('already been accepted')) return 'already-accepted'
  if (error.includes('sign in') || error.includes('session has expired')) return 'token'
  return 'generic'
}

function ErrorContent({
  error,
  invitationId,
  errorKind,
  branding,
}: {
  error: string
  invitationId: string
  errorKind?: ErrorKind
  branding: InviteBranding
}) {
  const [retrying, setRetrying] = useState(false)
  const kind = errorKind ?? getErrorKind(error)

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-8 text-center backdrop-blur-sm"
      style={{
        boxShadow: '0 20px 40px -12px rgb(0 0 0 / 0.08)',
      }}
    >
      <WorkspaceIdentity branding={branding} />
      <div className="mt-6 mb-6 h-px bg-border/50" />
      {retrying ? (
        <div>
          <Spinner size="xl" className="border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Retrying...</p>
        </div>
      ) : (
        <div>
          <div className="text-destructive text-xl font-medium tracking-tight">
            Unable to accept invitation
          </div>
          <p className="mt-2 text-muted-foreground">{error}</p>
          <div className="mt-6 flex flex-col gap-3">
            {kind === 'already-accepted' ? (
              <a href="/admin">
                <Button className="w-full h-11">Go to Dashboard</Button>
              </a>
            ) : kind === 'token' ? (
              <a href={`/admin/login?callbackUrl=/accept-invitation/${invitationId}`}>
                <Button className="w-full h-11">Sign in</Button>
              </a>
            ) : (
              <Button
                className="h-11"
                onClick={() => {
                  setRetrying(true)
                  window.location.reload()
                }}
              >
                Try Again
              </Button>
            )}
            <a
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Go to Home
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
