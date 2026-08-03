/**
 * Shared validation schemas for custom user-attribute definitions.
 *
 * Mirrors CreateUserAttributeInput / UpdateUserAttributeInput
 * (domains/user-attributes/user-attribute.types.ts). Consumed by the REST
 * routes under /api/v1/user-attributes and the MCP user-attribute tools.
 */
import { z } from 'zod'

export const USER_ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'date', 'currency'] as const

export const CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'INR',
  'BRL',
] as const

export const createUserAttributeSchema = z.object({
  key: z.string().min(1, 'Key is required').max(100),
  label: z.string().min(1, 'Label is required').max(200),
  description: z.string().max(1000).nullable().optional(),
  type: z.enum(USER_ATTRIBUTE_TYPES),
  currencyCode: z.enum(CURRENCY_CODES).nullable().optional(),
  externalKey: z.string().max(200).nullable().optional(),
})

export const updateUserAttributeSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  type: z.enum(USER_ATTRIBUTE_TYPES).optional(),
  currencyCode: z.enum(CURRENCY_CODES).nullable().optional(),
  externalKey: z.string().max(200).nullable().optional(),
})

export type CreateUserAttributeSchemaInput = z.infer<typeof createUserAttributeSchema>
export type UpdateUserAttributeSchemaInput = z.infer<typeof updateUserAttributeSchema>
