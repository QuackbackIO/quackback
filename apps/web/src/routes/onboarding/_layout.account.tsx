import { useEffect, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/client/auth-client'
import { checkOnboardingState, getPublicAuthConfig } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './onboarding-step'

export const Route = createFileRoute('/onboarding/_layout/account')({
  loader: async ({ context }) => {
    const { session } = context

    if (session?.user) {
      const state = await checkOnboardingState({ data: session.user.id })
      throw redirect({
        to: pickOnboardingStep({
          session: { userId: session.user.id },
          state: {
            needsInvitation: state.needsInvitation,
            setupState: state.setupState,
            principalRecord: state.principalRecord,
          },
        }),
      })
    }

    // When an env-baked SSO provider is configured, hide the manual
    // signup form so the first user lands as admin via SSO instead of
    // creating a self-serve account that would shadow the intended
    // workspace owner. Operators who don't set SSO_OIDC_* keep the
    // standard Jane-Doe form.
    const { ssoEnabled } = await getPublicAuthConfig()
    return { ssoEnabled }
  },
  component: AccountStep,
})

function AccountStep() {
  const { ssoEnabled } = Route.useLoaderData()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Auto-trigger the SSO redirect on mount when the operator has
  // configured a single sign-on provider. SSO is the only legitimate
  // path to admin in that mode, so skipping the click avoids a useless
  // intermediate page. If the kick-off fails the button below stays
  // interactable as a manual retry.
  useEffect(() => {
    if (!ssoEnabled) return
    void authClient.signIn
      .oauth2({ providerId: 'sso', callbackURL: '/' })
      .catch((err) => setError(err instanceof Error ? err.message : 'Sign-in failed'))
  }, [ssoEnabled])

  if (ssoEnabled) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-sm">
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold">Welcome to Quackback</h1>
            <p className="mt-2 text-muted-foreground">Sign in with single sign-on to continue</p>
            {error && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <Button
              onClick={() =>
                void authClient.signIn
                  .oauth2({ providerId: 'sso', callbackURL: '/' })
                  .catch((err) => setError(err instanceof Error ? err.message : 'Sign-in failed'))
              }
              className="mt-6 w-full h-11"
            >
              Continue with single sign-on
            </Button>
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || name.trim().length < 2) {
      setError('Please enter your name')
      return
    }
    if (!email.trim()) {
      setError('Please enter your email')
      return
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setError('')
    setIsLoading(true)

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email,
        password,
      })

      if (result.error) {
        throw new Error(result.error.message || 'Failed to create account')
      }

      window.location.href = '/onboarding/usecase'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Main card */}
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-sm">
        <div className="p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">Welcome to Quackback</h1>
            <p className="mt-2 text-muted-foreground">Create your account to get started</p>
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

            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                autoComplete="email"
                disabled={isLoading}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="At least 8 characters"
                autoComplete="new-password"
                disabled={isLoading}
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading || !email.trim() || !name.trim() || password.length < 8}
              className="w-full h-11"
            >
              {isLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Continue'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
