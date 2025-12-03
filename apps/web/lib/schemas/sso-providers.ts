import { z } from 'zod'

/**
 * OIDC provider configuration
 */
export const oidcConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client Secret is required'),
  discoveryUrl: z.string().url('Must be a valid URL').optional(),
  authorizationUrl: z.string().url('Must be a valid URL').optional(),
  tokenUrl: z.string().url('Must be a valid URL').optional(),
  userinfoUrl: z.string().url('Must be a valid URL').optional(),
})

/**
 * SAML provider configuration
 */
export const samlConfigSchema = z.object({
  ssoUrl: z.string().url('SSO URL must be a valid URL'),
  certificate: z.string().min(1, 'Certificate is required'),
  signRequest: z.boolean(),
})

/**
 * Create SSO provider schema
 */
export const createSsoProviderSchema = z
  .object({
    type: z.enum(['oidc', 'saml']),
    issuer: z.string().min(1, 'Issuer is required'),
    domain: z
      .string()
      .min(1, 'Domain is required')
      .regex(/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/, 'Invalid domain format'),
    oidcConfig: oidcConfigSchema.optional(),
    samlConfig: samlConfigSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'oidc') return !!data.oidcConfig
      if (data.type === 'saml') return !!data.samlConfig
      return false
    },
    { message: 'Configuration must match provider type' }
  )

/**
 * Update SSO provider schema (partial, type cannot be changed)
 */
export const updateSsoProviderSchema = z.object({
  issuer: z.string().min(1, 'Issuer is required').optional(),
  domain: z
    .string()
    .min(1, 'Domain is required')
    .regex(/^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/, 'Invalid domain format')
    .optional(),
  oidcConfig: oidcConfigSchema.optional(),
  samlConfig: samlConfigSchema.optional(),
})

export type OidcConfig = z.infer<typeof oidcConfigSchema>
export type SamlConfig = z.infer<typeof samlConfigSchema>
export type CreateSsoProviderInput = z.infer<typeof createSsoProviderSchema>
export type UpdateSsoProviderInput = z.infer<typeof updateSsoProviderSchema>
