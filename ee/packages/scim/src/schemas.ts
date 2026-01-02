/**
 * SCIM 2.0 Schemas
 *
 * Based on RFC 7643 - SCIM Core Schema
 * https://datatracker.ietf.org/doc/html/rfc7643
 */

import { z } from 'zod'

/**
 * SCIM User Resource Schema
 */
export const SCIMUserSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:schemas:core:2.0:User']),
  id: z.string().optional(),
  externalId: z.string().optional(),
  userName: z.string(),
  name: z
    .object({
      formatted: z.string().optional(),
      familyName: z.string().optional(),
      givenName: z.string().optional(),
      middleName: z.string().optional(),
      honorificPrefix: z.string().optional(),
      honorificSuffix: z.string().optional(),
    })
    .optional(),
  displayName: z.string().optional(),
  emails: z
    .array(
      z.object({
        value: z.string().email(),
        type: z.enum(['work', 'home', 'other']).optional(),
        primary: z.boolean().optional(),
      })
    )
    .optional(),
  active: z.boolean().default(true),
  groups: z
    .array(
      z.object({
        value: z.string(),
        display: z.string().optional(),
      })
    )
    .optional(),
  meta: z
    .object({
      resourceType: z.literal('User').default('User'),
      created: z.string().optional(),
      lastModified: z.string().optional(),
      location: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
})

export type SCIMUser = z.infer<typeof SCIMUserSchema>

/**
 * SCIM Group Resource Schema
 */
export const SCIMGroupSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:schemas:core:2.0:Group']),
  id: z.string().optional(),
  externalId: z.string().optional(),
  displayName: z.string(),
  members: z
    .array(
      z.object({
        value: z.string(),
        display: z.string().optional(),
        type: z.enum(['User', 'Group']).optional(),
      })
    )
    .optional(),
  meta: z
    .object({
      resourceType: z.literal('Group').default('Group'),
      created: z.string().optional(),
      lastModified: z.string().optional(),
      location: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
})

export type SCIMGroup = z.infer<typeof SCIMGroupSchema>

/**
 * SCIM List Response Schema
 */
export const SCIMListResponseSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:api:messages:2.0:ListResponse']),
  totalResults: z.number(),
  startIndex: z.number().default(1),
  itemsPerPage: z.number(),
  Resources: z.array(z.union([SCIMUserSchema, SCIMGroupSchema])),
})

export type SCIMListResponse = z.infer<typeof SCIMListResponseSchema>

/**
 * SCIM Error Response Schema
 */
export const SCIMErrorSchema = z.object({
  schemas: z.array(z.string()).default(['urn:ietf:params:scim:api:messages:2.0:Error']),
  status: z.string(),
  scimType: z.string().optional(),
  detail: z.string().optional(),
})

export type SCIMError = z.infer<typeof SCIMErrorSchema>
