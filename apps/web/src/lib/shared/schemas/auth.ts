import { z } from 'zod'

export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.enum(['member', 'admin']),
})

export type InviteInput = z.infer<typeof inviteSchema>

/**
 * HTTPS-only URL refinement. `z.string().url()` accepts http://, but
 * SSO discovery URLs and OAuth-related endpoints reject plaintext.
 * Used by the in-app identity-provider validators (e.g. the server fns
 * in `sso.ts`) so they reject misconfigurations at parse time instead
 * of at sign-in time.
 */
export const httpsUrl = z
  .string()
  .url()
  .refine(
    (v) => {
      try {
        return new URL(v).protocol === 'https:'
      } catch {
        return false
      }
    },
    { message: 'must be an https:// URL' }
  )
