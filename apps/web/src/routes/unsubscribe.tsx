import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { XCircle } from 'lucide-react'
// import { processUnsubscribeToken } from '@/lib/subscriptions'

const searchSchema = z.object({
  token: z.string().optional(),
})

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: searchSchema,
  // loaderDeps: ({ search }) => ({ token: search.token }),
  // loader: async ({ deps }) => {
  //   const { token } = deps

  //   if (!token) {
  //     return { error: 'missing' }
  //   }

  //   try {
  //     const result = await processUnsubscribeToken(token)

  //     if (!result) {
  //       return { error: 'invalid' }
  //     }

  //     // Redirect to the post (single workspace mode - no domain lookup needed)
  //     if (result.postId && result.post) {
  //       const postUrl = `/b/${result.post.boardSlug}/posts/${result.postId}?unsubscribed=true`
  //       throw redirect({ to: postUrl as any })
  //     }

  //     // Fallback to home if no post info
  //     throw redirect({ to: '/' })
  //   } catch (error) {
  //     // Check if it's a redirect (which is expected)
  //     if (error && typeof error === 'object' && 'isRedirect' in error) {
  //       throw error
  //     }

  //     console.error('Error processing unsubscribe:', error)
  //     return { error: 'failed' }
  //   }
  // },
  component: UnsubscribePage,
})

function UnsubscribePage() {
  // const { error } = Route.useLoaderData()
  const { title, message } = getErrorContent('missing')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
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
