import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/solid'
import { authClient } from '@/lib/client/auth-client'
import { PortalAuthShell } from '@/components/auth/portal-auth-shell'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { getPortalLocaleFn } from '@/lib/server/functions/locale'

export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || '',
    error: (search.error as string) || '',
  }),
  loader: async () => ({ locale: await getPortalLocaleFn() }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { locale } = Route.useLoaderData()
  const { token, error: urlError } = Route.useSearch()

  return (
    <PortalIntlProvider locale={locale}>
      <ResetPasswordContent token={token} urlError={urlError} />
    </PortalIntlProvider>
  )
}

function ResetPasswordContent({ token, urlError }: { token: string; urlError: string }) {
  const intl = useIntl()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(
    urlError === 'INVALID_TOKEN'
      ? intl.formatMessage({
          id: 'portal.auth.resetPassword.invalidLink',
          defaultMessage: 'This reset link is invalid or has expired.',
        })
      : ''
  )
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.resetPassword.missingToken',
          defaultMessage: 'Missing reset token. Please use the link from your email.',
        })
      )
      return
    }
    if (newPassword.length < 8) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.error.passwordTooShort',
          defaultMessage: 'Password must be at least 8 characters',
        })
      )
      return
    }
    if (newPassword !== confirmPassword) {
      setError(
        intl.formatMessage({
          id: 'portal.auth.resetPassword.passwordsDoNotMatch',
          defaultMessage: 'Passwords do not match',
        })
      )
      return
    }

    setLoading(true)
    try {
      const result = await authClient.resetPassword({
        newPassword,
        token,
      })
      if (result.error) {
        throw new Error(
          result.error.message ||
            intl.formatMessage({
              id: 'portal.auth.resetPassword.failed',
              defaultMessage: 'Failed to reset password',
            })
        )
      }
      setSuccess(true)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'portal.auth.resetPassword.failed',
              defaultMessage: 'Failed to reset password',
            })
      )
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <PortalAuthShell
        heading={
          <FormattedMessage
            id="portal.auth.resetPassword.successHeading"
            defaultMessage="Password reset"
          />
        }
        subheading={
          <FormattedMessage
            id="portal.auth.resetPassword.successSubheading"
            defaultMessage="Your password has been updated successfully."
          />
        }
      >
        <div className="flex flex-col items-center gap-6">
          <CheckCircleIcon className="h-12 w-12 text-green-600 dark:text-green-400" />
          <Link to="/auth/login" className="w-full">
            <Button className="w-full">
              <FormattedMessage id="portal.auth.signIn" defaultMessage="Sign in" />
            </Button>
          </Link>
        </div>
      </PortalAuthShell>
    )
  }

  return (
    <PortalAuthShell
      heading={
        <FormattedMessage
          id="portal.auth.resetPassword.heading"
          defaultMessage="Set a new password"
        />
      }
      subheading={
        <FormattedMessage
          id="portal.auth.resetPassword.subheading"
          defaultMessage="Enter your new password below."
        />
      }
      footer={
        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/auth/login"
            className="font-medium text-primary hover:underline underline-offset-4"
          >
            <FormattedMessage
              id="portal.auth.resetPassword.backToSignIn"
              defaultMessage="Back to sign in"
            />
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <FormError message={error} />}

        <div className="space-y-2">
          <label htmlFor="new-password" className="text-sm font-medium">
            <FormattedMessage
              id="portal.auth.resetPassword.newPasswordLabel"
              defaultMessage="New password"
            />
          </label>
          <Input
            id="new-password"
            type="password"
            placeholder={intl.formatMessage({
              id: 'portal.auth.password.placeholderSignup',
              defaultMessage: 'At least 8 characters',
            })}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading || !token}
            autoComplete="new-password"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            <FormattedMessage
              id="portal.auth.resetPassword.confirmPasswordLabel"
              defaultMessage="Confirm password"
            />
          </label>
          <Input
            id="confirm-password"
            type="password"
            placeholder={intl.formatMessage({
              id: 'portal.auth.resetPassword.confirmPasswordPlaceholder',
              defaultMessage: 'Re-enter your password',
            })}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading || !token}
            autoComplete="new-password"
          />
        </div>

        <Button
          type="submit"
          disabled={loading || !token || newPassword.length < 8 || newPassword !== confirmPassword}
          className="w-full"
        >
          {loading ? (
            <>
              <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
              <FormattedMessage
                id="portal.auth.resetPassword.resetting"
                defaultMessage="Resetting password..."
              />
            </>
          ) : (
            <FormattedMessage
              id="portal.auth.resetPassword.submit"
              defaultMessage="Reset password"
            />
          )}
        </Button>
      </form>
    </PortalAuthShell>
  )
}
