import { createFileRoute, isRedirect } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  acceptInvitationFn,
  getInvitationDetailsFn,
  setPasswordFn,
} from '@/lib/server/functions/invitations'

export const Route = createFileRoute('/accept-invitation/$id')({
  loader: async ({ params, context }) => {
    const { id } = params
    const { session } = context

    if (!session?.user) {
      return {
        state: 'error' as const,
        error: 'Please use the invitation link from your email to join the team.',
      }
    }

    try {
      const data = await getInvitationDetailsFn({ data: id })
      return { state: 'welcome' as const, ...data }
    } catch (err) {
      if (isRedirect(err)) throw err
      const message = err instanceof Error ? err.message : 'Failed to load invitation'
      return { state: 'error' as const, error: message }
    }
  },
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const data = Route.useLoaderData()

  if (data.state === 'error') {
    return <ErrorView error={data.error} />
  }

  return (
    <WelcomeView
      invite={data.invite}
      passwordEnabled={data.passwordEnabled}
      requiresPasswordSetup={data.requiresPasswordSetup}
    />
  )
}

function WelcomeView({
  invite,
  passwordEnabled,
  requiresPasswordSetup,
}: {
  invite: {
    name: string | null
    email: string
    workspaceName: string
    inviterName: string | null
  }
  passwordEnabled: boolean
  requiresPasswordSetup: boolean
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
      // For users without an existing credential password, password setup is required.
      if (requiresPasswordSetup) {
        await setPasswordFn({ data: { newPassword: password } })
      }

      await acceptInvitationFn({ data: { invitationId: id, name: trimmedName } })

      // Optional password setup for users who already had a credential account.
      if (!requiresPasswordSetup && !skipPassword && password.length >= 8) {
        await setPasswordFn({ data: { newPassword: password } }).catch((err) => {
          console.warn('[accept-invitation] optional setPassword failed:', err)
        })
      }

      window.location.href = '/admin'
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to accept invitation'
      // Treat "already accepted" as success (idempotency on retry)
      if (message.includes('already been accepted')) {
        window.location.href = '/admin'
        return
      }
      setError(message)
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md px-4">
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-sm">
          <div className="p-8">
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold">Welcome to {invite.workspaceName}</h1>
              <p className="mt-2 text-muted-foreground">
                {invite.inviterName
                  ? `You were invited by ${invite.inviterName}`
                  : 'You have been invited to join the team'}
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
                  isLoading ||
                  name.trim().length < 2 ||
                  (requiresPasswordSetup && password.length < 8)
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
      </div>
    </div>
  )
}

function ErrorView({ error }: { error: string }) {
  const [retrying, setRetrying] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md text-center px-4">
        {retrying ? (
          <div>
            <Spinner size="xl" className="border-primary mx-auto" />
            <p className="mt-4 text-muted-foreground">Retrying...</p>
          </div>
        ) : (
          <div>
            <div className="text-destructive text-xl font-medium">Unable to accept invitation</div>
            <p className="mt-2 text-muted-foreground">{error}</p>
            <div className="mt-6 flex flex-col gap-3">
              <Button
                onClick={() => {
                  setRetrying(true)
                  window.location.reload()
                }}
              >
                Try Again
              </Button>
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
    </div>
  )
}
