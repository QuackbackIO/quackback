import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { FormattedMessage, useIntl, type MessageDescriptor } from 'react-intl'
import { CheckCircleIcon, XCircleIcon, EnvelopeIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { PortalIntlProvider } from '@/components/portal-intl-provider'
import { loadPortalIntl } from '@/lib/server/functions/locale'
import {
  peekUnsubscribeTokenFn,
  processUnsubscribeTokenFn,
  type UnsubscribePreview,
  type UnsubscribeResult,
} from '@/lib/server/functions/subscriptions'

const searchSchema = z.object({
  token: z.string().optional(),
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PageError = 'missing' | 'malformed' | 'invalid' | 'failed'

/**
 * GET only reads the token and asks the person to confirm. Mail scanners and
 * link previews open every link in an email, so opening one must not change
 * anything. The confirm button (or a mail client's one-click POST to
 * /api/unsubscribe) is what spends the token.
 */
export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({
    deps,
  }): Promise<
    Awaited<ReturnType<typeof loadPortalIntl>> & {
      token: string | null
      preview: UnsubscribePreview | { valid: false; error: PageError }
    }
  > => {
    const intl = await loadPortalIntl()
    if (!deps.token) return { ...intl, token: null, preview: { valid: false, error: 'missing' } }
    if (!UUID.test(deps.token)) {
      return { ...intl, token: null, preview: { valid: false, error: 'malformed' } }
    }
    const preview = await peekUnsubscribeTokenFn({ data: { token: deps.token } })
    return { ...intl, token: deps.token, preview }
  },
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
  component: UnsubscribeRoute,
})

function UnsubscribeRoute() {
  const { locale, messages, token, preview } = Route.useLoaderData()
  return (
    <PortalIntlProvider locale={locale} messages={messages}>
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          {preview.valid && token ? (
            <ConfirmFlow token={token} preview={preview} />
          ) : (
            <ErrorView error={preview.error ?? 'invalid'} />
          )}
        </div>
      </main>
    </PortalIntlProvider>
  )
}

function ConfirmFlow({ token, preview }: { token: string; preview: UnsubscribePreview }) {
  const intl = useIntl()
  const [state, setState] = useState<'confirm' | 'working' | 'failed'>('confirm')
  const [result, setResult] = useState<UnsubscribeResult | null>(null)
  const copy = actionCopy(preview.action)

  if (result?.success) return <DoneView result={result} />
  if (result) return <ErrorView error={result.error === 'failed' ? 'failed' : 'invalid'} />

  async function confirm() {
    setState('working')
    try {
      setResult(await processUnsubscribeTokenFn({ data: { token } }))
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <StatusIcon tone="neutral" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">
          {intl.formatMessage(copy.confirmTitle)}
        </h1>
        <p className="text-sm text-muted-foreground">{intl.formatMessage(copy.confirmBody)}</p>
        {preview.postTitle ? (
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.unsubscribe.postLabel"
              defaultMessage="Post: {title}"
              values={{ title: <span className="font-medium">{preview.postTitle}</span> }}
            />
          </p>
        ) : null}
      </div>
      {state === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {intl.formatMessage(ERROR_COPY.failed.body)}
        </p>
      ) : null}
      <div className="flex justify-center">
        <Button onClick={confirm} disabled={state === 'working'}>
          {intl.formatMessage(copy.button)}
        </Button>
      </div>
    </>
  )
}

function DoneView({ result }: { result: UnsubscribeResult }) {
  const intl = useIntl()
  const copy = actionCopy(result.action)
  return (
    <>
      <StatusIcon tone="success" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">
          <FormattedMessage id="portal.unsubscribe.doneTitle" defaultMessage="Done" />
        </h1>
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage(copy.doneBody)}
        </p>
        {result.action === 'unsubscribe_onboarding' ? (
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.unsubscribe.onboarding.turnBackOn"
              defaultMessage="Changed your mind? <link>Turn them back on</link> in your preferences."
              values={{
                link: (chunks) => (
                  <Link
                    to="/settings/preferences"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    {chunks}
                  </Link>
                ),
              }}
            />
          </p>
        ) : null}
      </div>
      <div className="flex justify-center">
        {result.boardSlug && result.postId ? (
          <Button asChild>
            <Link
              to="/b/$slug/posts/$postId"
              params={{ slug: result.boardSlug, postId: result.postId }}
            >
              <FormattedMessage id="portal.unsubscribe.viewPost" defaultMessage="View post" />
            </Link>
          </Button>
        ) : (
          <HomeButton />
        )}
      </div>
    </>
  )
}

function ErrorView({ error }: { error: PageError }) {
  const intl = useIntl()
  const copy = ERROR_COPY[error]
  return (
    <>
      <StatusIcon tone="error" />
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-foreground">{intl.formatMessage(copy.title)}</h1>
        <p className="text-sm text-muted-foreground">{intl.formatMessage(copy.body)}</p>
      </div>
      <div className="flex justify-center">
        <HomeButton />
      </div>
    </>
  )
}

function HomeButton() {
  return (
    <Button asChild variant="outline">
      <Link to="/">
        <FormattedMessage id="portal.unsubscribe.goHome" defaultMessage="Go to home" />
      </Link>
    </Button>
  )
}

function StatusIcon({ tone }: { tone: 'neutral' | 'success' | 'error' }) {
  const Icon = tone === 'success' ? CheckCircleIcon : tone === 'error' ? XCircleIcon : EnvelopeIcon
  const toneClass =
    tone === 'success'
      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
      : tone === 'error'
        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        : 'bg-muted text-muted-foreground'
  return (
    <div className="flex justify-center" aria-hidden="true">
      <div className={`flex h-16 w-16 items-center justify-center rounded-full ${toneClass}`}>
        <Icon className="h-8 w-8" />
      </div>
    </div>
  )
}

interface ActionCopy {
  confirmTitle: MessageDescriptor
  confirmBody: MessageDescriptor
  button: MessageDescriptor
  doneBody: MessageDescriptor
}

const UNSUBSCRIBE_BUTTON: MessageDescriptor = {
  id: 'portal.unsubscribe.button',
  defaultMessage: 'Unsubscribe',
}

const ACTION_COPY: Record<string, ActionCopy> = {
  unsubscribe_post: {
    confirmTitle: {
      id: 'portal.unsubscribe.post.confirmTitle',
      defaultMessage: 'Unsubscribe from this post?',
    },
    confirmBody: {
      id: 'portal.unsubscribe.post.confirmBody',
      defaultMessage: 'You will stop getting email updates about it.',
    },
    button: UNSUBSCRIBE_BUTTON,
    doneBody: {
      id: 'portal.unsubscribe.post.doneBody',
      defaultMessage: 'You will not get more email updates about this post.',
    },
  },
  mute_post: {
    confirmTitle: { id: 'portal.unsubscribe.mute.confirmTitle', defaultMessage: 'Mute this post?' },
    confirmBody: {
      id: 'portal.unsubscribe.mute.confirmBody',
      defaultMessage: 'You will stop getting notifications about it.',
    },
    button: { id: 'portal.unsubscribe.mute.button', defaultMessage: 'Mute' },
    doneBody: {
      id: 'portal.unsubscribe.mute.doneBody',
      defaultMessage: 'This post is muted. You can unmute it from the post.',
    },
  },
  unsubscribe_all: {
    confirmTitle: {
      id: 'portal.unsubscribe.all.confirmTitle',
      defaultMessage: 'Turn off all email?',
    },
    confirmBody: {
      id: 'portal.unsubscribe.all.confirmBody',
      defaultMessage: 'You will stop getting every email notification.',
    },
    button: { id: 'portal.unsubscribe.all.button', defaultMessage: 'Turn off all email' },
    doneBody: {
      id: 'portal.unsubscribe.all.doneBody',
      defaultMessage: 'All email is off. You can turn it back on in your preferences.',
    },
  },
  unsubscribe_changelog: {
    confirmTitle: {
      id: 'portal.unsubscribe.changelog.confirmTitle',
      defaultMessage: 'Unsubscribe from changelog emails?',
    },
    confirmBody: {
      id: 'portal.unsubscribe.changelog.confirmBody',
      defaultMessage: 'You will stop getting an email when an update is published.',
    },
    button: UNSUBSCRIBE_BUTTON,
    doneBody: {
      id: 'portal.unsubscribe.changelog.doneBody',
      defaultMessage: 'You will not get more changelog emails. You can subscribe again any time.',
    },
  },
  unsubscribe_onboarding: {
    confirmTitle: {
      id: 'portal.unsubscribe.onboarding.confirmTitle',
      defaultMessage: 'Stop setup tips?',
    },
    confirmBody: {
      id: 'portal.unsubscribe.onboarding.confirmBody',
      defaultMessage: 'You will stop getting setup tips by email. Nothing else changes.',
    },
    button: { id: 'portal.unsubscribe.onboarding.button', defaultMessage: 'Stop setup tips' },
    doneBody: {
      id: 'portal.unsubscribe.onboarding.doneBody',
      defaultMessage: 'Setup tips are off.',
    },
  },
  unsubscribe_status: {
    confirmTitle: {
      id: 'portal.unsubscribe.status.confirmTitle',
      defaultMessage: 'Unsubscribe from status updates?',
    },
    confirmBody: {
      id: 'portal.unsubscribe.status.confirmBody',
      defaultMessage: 'You will stop getting status page emails.',
    },
    button: UNSUBSCRIBE_BUTTON,
    doneBody: {
      id: 'portal.unsubscribe.status.doneBody',
      defaultMessage: 'You will not get more status page emails. You can subscribe again any time.',
    },
  },
}

const GENERIC_COPY: ActionCopy = {
  confirmTitle: {
    id: 'portal.unsubscribe.generic.confirmTitle',
    defaultMessage: 'Stop these emails?',
  },
  confirmBody: {
    id: 'portal.unsubscribe.generic.confirmBody',
    defaultMessage: 'You will stop getting emails like this one.',
  },
  button: UNSUBSCRIBE_BUTTON,
  doneBody: {
    id: 'portal.unsubscribe.generic.doneBody',
    defaultMessage: 'Your preferences are updated.',
  },
}

function actionCopy(action: string | undefined): ActionCopy {
  return (action && ACTION_COPY[action]) || GENERIC_COPY
}

const ERROR_COPY: Record<PageError, { title: MessageDescriptor; body: MessageDescriptor }> = {
  missing: {
    title: {
      id: 'portal.unsubscribe.error.missing.title',
      defaultMessage: 'This link is incomplete',
    },
    body: {
      id: 'portal.unsubscribe.error.missing.body',
      defaultMessage: 'Use the link from your email.',
    },
  },
  malformed: {
    title: {
      id: 'portal.unsubscribe.error.malformed.title',
      defaultMessage: 'This link is not valid',
    },
    body: {
      id: 'portal.unsubscribe.error.missing.body',
      defaultMessage: 'Use the link from your email.',
    },
  },
  invalid: {
    title: {
      id: 'portal.unsubscribe.error.invalid.title',
      defaultMessage: 'This link has expired',
    },
    body: {
      id: 'portal.unsubscribe.error.invalid.body',
      defaultMessage: 'It was already used or is too old. Use the link in a newer email.',
    },
  },
  failed: {
    title: {
      id: 'portal.unsubscribe.error.failed.title',
      defaultMessage: 'Something went wrong',
    },
    body: {
      id: 'portal.unsubscribe.error.failed.body',
      defaultMessage: 'We could not update your preferences. Try again in a moment.',
    },
  },
}
