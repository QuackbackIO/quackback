/**
 * The emailed unsubscribe link, and the RFC 8058 one-click endpoint behind the
 * `List-Unsubscribe` header on the same URL.
 *
 * Opening the link never writes: mail scanners prefetch every link in a
 * message, so the page only looks the token up and asks first. The unsubscribe
 * happens on the confirm button, or on a mail provider's one-click `POST` to
 * this URL (see one-click-unsubscribe.ts). A malformed token is an invalid
 * link to show, never an error.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { FormattedMessage, useIntl, type IntlShape } from 'react-intl'
import { z } from 'zod'
import { CheckCircleIcon, EnvelopeIcon, XCircleIcon } from '@heroicons/react/24/solid'
import {
  previewUnsubscribeTokenFn,
  processUnsubscribeTokenFn,
  type UnsubscribePreview,
  type UnsubscribeResult,
} from '@/lib/server/functions/subscriptions'
import { loadPortalIntl } from '@/lib/server/functions/locale'
import { isUnsubscribeToken } from '@/lib/shared/unsubscribe-token'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { Button } from '@/components/ui/button'

const searchSchema = z.object({
  token: z.string().optional(),
})

type ErrorKind = 'missing' | 'invalid' | 'expired' | 'used' | 'failed'
type UnsubscribeView = UnsubscribePreview | { status: 'error'; error: 'missing' }

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }) => {
    const [intl, view] = await Promise.all([loadPortalIntl(), lookUp(deps.token)])
    return { ...intl, ...view }
  },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleOneClickUnsubscribe } =
          await import('@/lib/server/functions/one-click-unsubscribe')
        return handleOneClickUnsubscribe(request)
      },
    },
  },
  component: UnsubscribePage,
})

/** Read-only: the token is looked up, never spent. */
async function lookUp(token: string | undefined): Promise<UnsubscribeView> {
  if (!token) return { status: 'error', error: 'missing' }
  if (!isUnsubscribeToken(token)) return { status: 'error', error: 'invalid' }
  return previewUnsubscribeTokenFn({ data: { token } })
}

function UnsubscribePage() {
  const data = Route.useLoaderData()
  const { token } = Route.useSearch()

  return (
    <PortalIntlProvider locale={data.locale} messages={data.messages}>
      {data.status === 'confirm' && token ? (
        <ConfirmFlow token={token} action={data.action} postTitle={data.postTitle} />
      ) : (
        <ErrorView error={data.status === 'error' ? data.error : 'invalid'} />
      )}
    </PortalIntlProvider>
  )
}

function ConfirmFlow({
  token,
  action,
  postTitle,
}: {
  token: string
  action: string
  postTitle?: string
}) {
  const intl = useIntl()
  const [result, setResult] = useState<UnsubscribeResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const confirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      setResult(await processUnsubscribeTokenFn({ data: { token } }))
    } catch {
      setResult({ success: false, error: 'failed' })
    } finally {
      setSubmitting(false)
    }
  }

  if (result?.success) return <SuccessView result={result} />
  if (result) return <ErrorView error={result.error ?? 'invalid'} />

  const { title, message } = confirmText(intl, action)
  return (
    <Shell
      icon={
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <EnvelopeIcon className="h-8 w-8 text-muted-foreground" />
        </div>
      }
      title={title}
      message={message}
      postTitle={postTitle}
    >
      <Button onClick={confirm} disabled={submitting}>
        {submitting ? (
          <FormattedMessage
            id="portal.unsubscribe.confirm.pending"
            defaultMessage="Unsubscribing…"
          />
        ) : (
          <FormattedMessage id="portal.unsubscribe.confirm.button" defaultMessage="Unsubscribe" />
        )}
      </Button>
    </Shell>
  )
}

function SuccessView({ result }: { result: UnsubscribeResult }) {
  const intl = useIntl()
  const { title, message } = successText(intl, result.action)

  return (
    <Shell
      icon={
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <CheckCircleIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
        </div>
      }
      title={title}
      message={message}
      postTitle={result.postTitle}
    >
      {result.boardSlug && result.postId ? (
        <Link
          to="/b/$slug/posts/$postId"
          params={{ slug: result.boardSlug, postId: result.postId }}
          className={LINK_BUTTON}
        >
          <FormattedMessage id="portal.unsubscribe.viewPost" defaultMessage="View Post" />
        </Link>
      ) : (
        <HomeLink />
      )}
    </Shell>
  )
}

function ErrorView({ error }: { error: ErrorKind }) {
  const intl = useIntl()
  const { title, message } = errorText(intl, error)

  return (
    <Shell
      icon={
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
          <XCircleIcon className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
      }
      title={title}
      message={message}
    >
      <HomeLink />
    </Shell>
  )
}

const LINK_BUTTON =
  'inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors'

function HomeLink() {
  return (
    <Link to="/" className={LINK_BUTTON}>
      <FormattedMessage id="portal.unsubscribe.goHome" defaultMessage="Go to Home" />
    </Link>
  )
}

function Shell({
  icon,
  title,
  message,
  postTitle,
  children,
}: {
  icon: ReactNode
  title: string
  message: string
  postTitle?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">{icon}</div>

        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          {postTitle && (
            <p className="text-sm text-muted-foreground mt-2">
              <FormattedMessage
                id="portal.unsubscribe.postLabel"
                defaultMessage="Post: {title}"
                values={{ title: <span className="font-medium">{postTitle}</span> }}
              />
            </p>
          )}
        </div>

        <div className="flex justify-center pt-4">{children}</div>
      </div>
    </div>
  )
}

type Copy = { title: string; message: string }

function confirmText(intl: IntlShape, action: string): Copy {
  switch (action) {
    case 'unsubscribe_post':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.post.title',
          defaultMessage: 'Unsubscribe from this post?',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.post.message',
          defaultMessage: "You'll stop getting email updates about this post.",
        }),
      }
    case 'unsubscribe_all':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.all.title',
          defaultMessage: 'Turn off all emails?',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.all.message',
          defaultMessage:
            "You'll stop getting all email notifications. You can turn them back on in your settings.",
        }),
      }
    case 'unsubscribe_changelog':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.changelog.title',
          defaultMessage: 'Unsubscribe from changelog emails?',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.changelog.message',
          defaultMessage: "You'll stop getting changelog emails. You can resubscribe any time.",
        }),
      }
    case 'unsubscribe_status':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.status.title',
          defaultMessage: 'Unsubscribe from status page emails?',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.status.message',
          defaultMessage: "You'll stop getting status page emails. You can resubscribe any time.",
        }),
      }
    default:
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.default.title',
          defaultMessage: 'Unsubscribe from these emails?',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.confirm.default.message',
          defaultMessage: "You'll stop getting these emails.",
        }),
      }
  }
}

function successText(intl: IntlShape, action?: string): Copy {
  const unsubscribed = () =>
    intl.formatMessage({ id: 'portal.unsubscribe.success.title', defaultMessage: 'Unsubscribed' })
  switch (action) {
    case 'unsubscribe_post':
      return {
        title: unsubscribed(),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.post.message',
          defaultMessage:
            "You've been unsubscribed from this post. You won't receive any more email updates about it.",
        }),
      }
    case 'mute_post':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.success.mute.title',
          defaultMessage: 'Notifications Muted',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.mute.message',
          defaultMessage:
            "You've muted notifications for this post. You can unmute anytime from the post page.",
        }),
      }
    case 'unsubscribe_all':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.success.all.title',
          defaultMessage: 'All Emails Disabled',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.all.message',
          defaultMessage:
            "You've disabled all email notifications. You can re-enable them from your settings.",
        }),
      }
    case 'unsubscribe_changelog':
      return {
        title: unsubscribed(),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.changelog.message',
          defaultMessage:
            "You won't receive any more changelog emails. You can resubscribe any time.",
        }),
      }
    case 'unsubscribe_status':
      return {
        title: unsubscribed(),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.status.message',
          defaultMessage:
            "You won't receive any more status page emails. You can resubscribe any time.",
        }),
      }
    default:
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.success.default.title',
          defaultMessage: 'Success',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.success.default.message',
          defaultMessage: 'Your preferences have been updated.',
        }),
      }
  }
}

function errorText(intl: IntlShape, error: ErrorKind): Copy {
  switch (error) {
    case 'missing':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.error.missing.title',
          defaultMessage: 'Missing Token',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.error.missing.message',
          defaultMessage: 'No unsubscribe token was provided. Please use the link from your email.',
        }),
      }
    case 'failed':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.error.failed.title',
          defaultMessage: 'Something Went Wrong',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.error.failed.message',
          defaultMessage: "We couldn't process your request. Please try again later.",
        }),
      }
    case 'invalid':
    case 'expired':
    case 'used':
      return {
        title: intl.formatMessage({
          id: 'portal.unsubscribe.error.expired.title',
          defaultMessage: 'Link Expired',
        }),
        message: intl.formatMessage({
          id: 'portal.unsubscribe.error.expired.message',
          defaultMessage: 'This unsubscribe link has already been used or has expired.',
        }),
      }
  }
}
