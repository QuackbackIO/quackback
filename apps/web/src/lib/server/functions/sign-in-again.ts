/**
 * Server function behind the sign-in-again dialog: how the signed-in person
 * signs in on this workspace, and whether they already did so recently. The
 * dialog reads it when it opens and again after a sign-in, to confirm the
 * sign-in was this person's and is fresh before the action resumes.
 */
import { createServerFn } from '@tanstack/react-start'
import type { SignInAgainOptions } from '@/lib/shared/sign-in-again'
import { requireAuth } from './auth-helpers'
import { logger } from '@/lib/server/logger'
import { UnauthorizedError } from '@/lib/shared/errors'

const log = logger.child({ component: 'sign-in-again' })

export const getSignInAgainOptionsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SignInAgainOptions> => {
    log.debug('get sign-in-again options')
    const auth = await requireAuth()
    // An anonymous visitor has no sign-in of their own to repeat.
    if (auth.principal.type === 'anonymous') throw new UnauthorizedError('Authentication required')
    const { signInAgainOptionsFor } = await import('@/lib/server/auth/sign-in-again')
    return signInAgainOptionsFor(auth)
  }
)
