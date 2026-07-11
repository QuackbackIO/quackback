import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid'
import { recordCsatViaTokenFn, type CsatEmailResult } from '@/lib/server/functions/csat-email'

const searchSchema = z.object({
  token: z.string().optional(),
  // Kept as a raw string (not z.coerce.number()) so a malformed value fails
  // gracefully into the same friendly error state below, instead of throwing
  // out of search validation itself — mirrors unsubscribe.tsx's own
  // validate-then-degrade-to-an-error-view pattern for its token param.
  rating: z.string().optional(),
})

type CsatLoaderResult = CsatEmailResult | { success: false; error: 'missing' | 'invalid' }

export const Route = createFileRoute('/csat')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ token: search.token, rating: search.rating }),
  loader: async ({ deps }): Promise<CsatLoaderResult> => {
    if (!deps.token || !deps.rating) return { success: false, error: 'missing' }
    const rating = Number(deps.rating)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { success: false, error: 'invalid' }
    }
    return recordCsatViaTokenFn({ data: { token: deps.token, rating } })
  },
  component: CsatPage,
})

function CsatPage() {
  const result = Route.useLoaderData()
  const { token, rating } = Route.useSearch()

  if (result.success) {
    return <ThanksView token={token} rating={rating ? Number(rating) : undefined} />
  }
  return <ErrorView error={result.error} />
}

/** The thanks state, with an optional follow-up comment box — submits through
 *  the SAME token-validated fn (recordCsat's latest-wins path already covers
 *  a rating-then-comment follow-up, same as the widget's own two-POST CSAT
 *  flow). */
function ThanksView({ token, rating }: { token?: string; rating?: number }) {
  const [comment, setComment] = useState('')
  const [commentSaved, setCommentSaved] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  const canComment = Boolean(token && rating)

  const submitComment = async () => {
    if (!token || !rating || !comment.trim() || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      const result = await recordCsatViaTokenFn({
        data: { token, rating, comment: comment.trim() },
      })
      if (result.success) {
        setCommentSaved(true)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircleIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Thanks for the feedback</h1>
          <p className="text-sm text-muted-foreground">Your rating has been recorded.</p>
        </div>

        {canComment && !commentSaved && (
          <div className="space-y-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              placeholder="Anything you'd like to add? (optional)"
              className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
            {error && (
              <p className="text-center text-sm text-red-600 dark:text-red-400">
                Something went wrong — please try again.
              </p>
            )}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={submitComment}
                disabled={!comment.trim() || submitting}
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send comment'}
              </button>
            </div>
          </div>
        )}

        {commentSaved && (
          <p className="text-center text-sm text-muted-foreground">
            Thanks — your comment has been added.
          </p>
        )}
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
      </div>
    </div>
  )
}

function getErrorContent(error: string): { title: string; message: string } {
  switch (error) {
    case 'missing':
      return {
        title: 'Missing Link',
        message: 'This link is missing some information. Please use the link from your email.',
      }
    case 'invalid':
    default:
      return {
        title: 'Link Expired',
        message: 'This rating link has expired or is no longer valid.',
      }
  }
}
