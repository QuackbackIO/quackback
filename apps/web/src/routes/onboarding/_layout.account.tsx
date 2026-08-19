import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/client/auth-client'
import { checkOnboardingState, getPublicAuthConfig } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './-onboarding-step'

export const Route = createFileRoute('/onboarding/_layout/account')({
  loader: async ({ context }) => {
    const { session } = context

    if (session?.user) {
      const state = await checkOnboardingState()
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
  const intl = useIntl()
  const navigate = useNavigate()
  const router = useRouter()
  const { ssoEnabled } = Route.useLoaderData()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [ssoRedirecting, setSsoRedirecting] = useState(false)

  async function startSso() {
    setSsoRedirecting(true)
    setError('')
    try {
      const result = await authClient.signIn.oauth2({
        providerId: 'sso',
        callbackURL: '/onboarding',
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'onboarding.account.ssoError',
              defaultMessage: 'We couldn’t start single sign-on. Try again.',
            })
        )
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.account.ssoError',
              defaultMessage: 'We couldn’t start single sign-on. Try again.',
            })
      )
      setSsoRedirecting(false)
    }
  }

  // Auto-trigger the SSO redirect on mount when the operator has
  // configured a single sign-on provider. SSO is the only legitimate
  // path to admin in that mode, so skipping the click avoids a useless
  // intermediate page. If the kick-off fails the button below stays
  // interactable as a manual retry.
  useEffect(() => {
    if (!ssoEnabled) return
    void startSso()
  }, [ssoEnabled])

  if (ssoEnabled) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold">
              <FormattedMessage
                id="onboarding.account.title"
                defaultMessage="Welcome to Quackback"
              />
            </h1>
            <p className="mt-2 text-muted-foreground">
              <FormattedMessage
                id="onboarding.account.ssoDescription"
                defaultMessage="Continue with your company account."
              />
            </p>
            <div aria-live="polite" aria-atomic="true">
              {ssoRedirecting && !error && (
                <p role="status" className="mt-4 text-sm text-muted-foreground">
                  <FormattedMessage
                    id="onboarding.account.redirecting"
                    defaultMessage="Taking you to your identity provider…"
                  />
                </p>
              )}
              {error && (
                <div
                  role="alert"
                  className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
                >
                  {error}
                </div>
              )}
            </div>
            <Button
              onClick={() => void startSso()}
              disabled={ssoRedirecting}
              className="mt-6 w-full h-11"
            >
              {ssoRedirecting ? (
                <FormattedMessage
                  id="onboarding.account.redirectingShort"
                  defaultMessage="Redirecting…"
                />
              ) : error ? (
                <FormattedMessage id="onboarding.account.ssoRetry" defaultMessage="Try SSO again" />
              ) : (
                <FormattedMessage
                  id="onboarding.account.ssoContinue"
                  defaultMessage="Continue with SSO"
                />
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!name.trim() || name.trim().length < 2) {
      setError(
        intl.formatMessage({
          id: 'onboarding.account.nameError',
          defaultMessage: 'Enter your name.',
        })
      )
      return
    }
    if (!email.trim()) {
      setError(
        intl.formatMessage({
          id: 'onboarding.account.emailError',
          defaultMessage: 'Enter your work email.',
        })
      )
      return
    }
    if (!password || password.length < 8) {
      setError(
        intl.formatMessage({
          id: 'onboarding.account.passwordError',
          defaultMessage: 'Use at least 8 characters for your password.',
        })
      )
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
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'onboarding.account.createError',
              defaultMessage: 'We couldn’t create your account. Try again.',
            })
        )
      }

      // Better Auth sets the session cookie before resolving. Refresh the
      // router context after the session read so navigation does not depend on
      // a hard reload racing the cookie cache.
      await authClient.getSession()
      await router.invalidate()
      await navigate({ to: '/onboarding/workspace' })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.account.createError',
              defaultMessage: 'We couldn’t create your account. Try again.',
            })
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Main card */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold">
              <FormattedMessage
                id="onboarding.account.title"
                defaultMessage="Welcome to Quackback"
              />
            </h1>
            <p className="mt-2 text-muted-foreground">
              <FormattedMessage
                id="onboarding.account.description"
                defaultMessage="Create your account to set up your workspace."
              />
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                <FormattedMessage id="onboarding.account.name" defaultMessage="Your name" />
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
                <FormattedMessage id="onboarding.account.email" defaultMessage="Work email" />
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder={intl.formatMessage({
                  id: 'onboarding.account.emailPlaceholder',
                  defaultMessage: 'you@company.com',
                })}
                autoComplete="email"
                disabled={isLoading}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                <FormattedMessage id="onboarding.account.password" defaultMessage="Password" />
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={intl.formatMessage({
                  id: 'onboarding.account.passwordPlaceholder',
                  defaultMessage: 'At least 8 characters',
                })}
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
              {isLoading ? (
                <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <FormattedMessage id="onboarding.account.create" defaultMessage="Create account" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
