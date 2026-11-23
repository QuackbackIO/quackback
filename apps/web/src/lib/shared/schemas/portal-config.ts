import { z } from 'zod'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'

/**
 * What a save of the portal's config may carry. Its own module, apart from the
 * theme schemas in `schemas/settings.ts`: the settings server functions
 * validate with it, and a validator ships in every page's script.
 */
export const updatePortalConfigSchema = z.object({
  features: z
    .object({
      allowAnonymous: z.boolean().optional(),
    })
    .optional(),
  // May a member of the public open an account on the portal? The portal's own
  // answer, distinct from `authConfig.openSignup`, which answers for the team.
  // A `z.object` strips what it does not name, so the key has to be here or the
  // save is accepted and discarded — and the portal has no other writer.
  openSignup: z.boolean().optional(),
  welcomeCard: z
    .object({
      // Body is re-sanitized server-side by normalizeWelcomeCardInput;
      // tiptapContentSchema gates the shape at the boundary.
      body: tiptapContentSchema.optional(),
    })
    .optional(),
  support: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  nav: z
    .object({
      items: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            type: z.enum(['feedback', 'roadmap', 'changelog', 'help', 'support', 'status', 'link']),
            enabled: z.boolean().optional(),
            label: z.string().trim().max(30).optional(),
            // http(s) only — blocks javascript:/data: URLs at the boundary.
            url: z
              .string()
              .url()
              .max(2048)
              .refine((u) => /^https?:\/\//i.test(u), 'URL must be http(s)')
              .optional(),
            newTab: z.boolean().optional(),
          })
        )
        .max(20)
        .optional(),
    })
    .optional(),
})
