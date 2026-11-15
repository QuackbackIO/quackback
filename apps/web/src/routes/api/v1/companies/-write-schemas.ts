import { z } from 'zod'

const optionalText = z.string().trim().max(255).nullable().optional()

/** Body of POST /api/v1/companies — mirrors CreateCompanyInput (source is forced to 'api'). */
export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: optionalText,
  externalId: optionalText,
  plan: optionalText,
  mrrCents: z.number().int().nonnegative().nullable().optional(),
  size: optionalText,
  website: optionalText,
  industry: optionalText,
  customAttributes: z.record(z.string(), z.unknown()).optional(),
})

/** Body of PATCH /api/v1/companies/:companyId — every field optional, at least one required. */
export const updateCompanySchema = createCompanySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field' })
