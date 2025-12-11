import { redirect } from 'next/navigation'
import { XCircle } from 'lucide-react'
import Link from 'next/link'
import { SubscriptionService } from '@quackback/domain/subscriptions'
import { db, eq, and, workspaceDomain } from '@quackback/db'

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams

  if (!token) {
    return <ErrorPage error="missing" />
  }

  try {
    const subscriptionService = new SubscriptionService()
    const result = await subscriptionService.processUnsubscribeToken(token)

    if (!result) {
      return <ErrorPage error="invalid" />
    }

    // Get the primary workspace domain for redirect
    const tenantUrl = await getTenantUrl(result.organizationId)

    // Redirect to the post
    if (result.postId && result.post) {
      const postUrl = `${tenantUrl}/b/${result.post.boardSlug}/posts/${result.postId}?unsubscribed=true`
      redirect(postUrl)
    }

    // Fallback to tenant home if no post info
    redirect(tenantUrl)
  } catch (error) {
    console.error('Error processing unsubscribe:', error)
    return <ErrorPage error="failed" />
  }
}

function ErrorPage({ error }: { error: string }) {
  const { title, message } = getErrorContent(error)

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
            href="/"
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

async function getTenantUrl(organizationId: string): Promise<string> {
  const domain = await db.query.workspaceDomain.findFirst({
    where: and(
      eq(workspaceDomain.organizationId, organizationId),
      eq(workspaceDomain.isPrimary, true)
    ),
  })

  if (domain) {
    const isLocalhost = domain.domain.includes('localhost')
    const protocol = isLocalhost ? 'http' : 'https'
    return `${protocol}://${domain.domain}`
  }

  const appDomain = process.env.APP_DOMAIN || 'localhost:3000'
  const isLocalhost = appDomain.includes('localhost')
  const protocol = isLocalhost ? 'http' : 'https'
  return `${protocol}://${appDomain}`
}
