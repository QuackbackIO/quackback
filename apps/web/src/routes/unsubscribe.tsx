import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { XCircleIcon } from '@heroicons/react/24/solid'

const searchSchema = z.object({
  token: z.string().optional(),
})

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { title, message } = getErrorContent('missing')

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

function getErrorContent(error: string): { title: string; message: string } {
  switch (error) {
    case 'missing':
      return {
        title: 'Missing Token',
        message: 'No unsubscribe token was provided. Please use the link from your email.',
      }
    case 'invalid':
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
