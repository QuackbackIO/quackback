import { MutationCache } from '@tanstack/react-query'
import { toastError, toastErrorLine } from '@/lib/client/error-notice'
import { errorAudience } from '@/lib/client/error-text'
import { describeError } from '@/lib/shared/describe-error'

/**
 * `meta` for a mutation that saves on change, with no Save button. The save
 * status in the page header tracks these, and a failure shows one toast.
 */
export const AUTOSAVE = { autosave: true } as const

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      autosave?: boolean
      /**
       * The server's error messages for this mutation are written for the
       * person saving (a rule they can act on), so the toast names the reason
       * instead of asking them to try again.
       */
      showServerMessage?: boolean
      /**
       * True for an error the page reports itself (an upgrade prompt, a
       * revision conflict notice).
       */
      ownsError?: (error: unknown) => boolean
    }
  }
}

const TRY_AGAIN = "Couldn't save. Try again."

/**
 * One toast for a failed autosave. A failure with wording of its own (the
 * server hid it, the connection dropped, the session ended) gets that wording;
 * a server message written for the person saving is shown when the mutation
 * asks for it; anything else asks them to try again.
 */
function toastFailedSave(error: unknown, showServerMessage: boolean | undefined): void {
  const notice = describeError(error, '', errorAudience())
  if (notice.description || notice.action) {
    toastError(error, "Couldn't save")
    return
  }
  toastErrorLine(showServerMessage && notice.title ? `Couldn't save. ${notice.title}` : TRY_AGAIN)
}

/**
 * True when a save was rejected because the settings changed in another
 * session (an optimistic-revision mismatch). A server function failure reaches
 * the client as a plain Error carrying only the server's message, so the
 * message is the signal that survives; the typed fields cover other callers.
 */
export function isRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; statusCode?: unknown; message?: unknown }
  return (
    value.code === 'ASSISTANT_CONFIG_REVISION_CONFLICT' ||
    value.statusCode === 409 ||
    (typeof value.message === 'string' &&
      /changed in another session|revision conflict/i.test(value.message))
  )
}

/**
 * The mutation cache for the app's QueryClient: autosave failures are never silent.
 * The toast library loads on first failure (see error-notice.tsx) so it stays
 * out of the entry chunk.
 */
export function createAutosaveMutationCache() {
  return new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.meta
      if (meta?.autosave !== true) return
      if (meta.ownsError?.(error)) return
      toastFailedSave(error, meta.showServerMessage)
    },
  })
}
