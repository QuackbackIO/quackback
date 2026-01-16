import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid'
import {
  processUnsubscribeTokenFn,
  type UnsubscribeResult,
} from '@/lib/server-functions/subscriptions'

const searchSchema = z.object({
  token: z.string().optional(),
})

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }): Promise<UnsubscribeResult | { success: false; error: 'missing' }> => {
    if (!deps.token) {
      return { success: false, error: 'missing' }
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(deps.token)) {
      return { success: false, error: 'invalid' }
    }

    return processUnsubscribeTokenFn({ data: { token: deps.token } })
  },
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const result = Route.useLoaderData()

  if (result.success) {
    return <SuccessView result={result} />
  }

  return <ErrorView error={result.error || 'invalid'} />
}

function SuccessView({ result }: { result: UnsubscribeResult }) {
  const actionText = getActionText(result.action)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircleIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{actionText.title}</h1>
          <p className="text-sm text-muted-foreground">{actionText.message}</p>
          {result.postTitle && (
            <p className="text-sm text-muted-foreground mt-2">
              Post: <span className="font-medium">{result.postTitle}</span>
            </p>
          )}
        </div>

        <div className="flex justify-center pt-4">
          {result.boardSlug && result.postId ? (
            <Link
              to="/b/$slug/posts/$postId"
              params={{ slug: result.boardSlug, postId: result.postId }}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              View Post
            </Link>
          ) : (
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Go to Home
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorView({ error }: { error: string }) {
  const { title, message } = getErrorContent(error)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircleIcon className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>

        <div className="flex justify-center pt-4">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Go to Home
          </Link>
        </div>
      </div>
    </div>
  )
}

function getActionText(action?: string): { title: string; message: string } {
  switch (action) {
    case 'unsubscribe_post':
      return {
        title: 'Unsubscribed',
        message:
          "You've been unsubscribed from this post. You won't receive any more email updates about it.",
      }
    case 'mute_post':
      return {
        title: 'Notifications Muted',
        message:
          "You've muted notifications for this post. You can unmute anytime from the post page.",
      }
    case 'unsubscribe_all':
      return {
        title: 'All Emails Disabled',
        message:
          "You've disabled all email notifications. You can re-enable them from your settings.",
      }
    default:
      return {
        title: 'Success',
        message: 'Your preferences have been updated.',
      }
  }
}

function getErrorContent(error: string): { title: string; message: string } {
  switch (error) {
    case 'missing':
      return {
        title: 'Missing Token',
        message: 'No unsubscribe token was provided. Please use the link from your email.',
      }
    case 'invalid':
    case 'expired':
    case 'used':
      return {
        title: 'Link Expired',
        message: 'This unsubscribe link has already been used or has expired.',
      }
    case 'failed':
      return {
        title: 'Something Went Wrong',
        message: "We couldn't process your request. Please try again later.",
      }
    default:
      return {
        title: 'Invalid Link',
        message: 'This unsubscribe link is not valid. Please use the link from your email.',
      }
  }
}
