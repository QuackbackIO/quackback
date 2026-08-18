import type { SealedEmail } from '../recipient'

/** Test-only brand. Production mints SealedEmail in the app recipient module. */
export const sealed = (address: string) => address as SealedEmail
