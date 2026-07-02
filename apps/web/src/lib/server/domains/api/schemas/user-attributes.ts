/**
 * User-attribute schema registrations: custom user-attribute definitions.
 *
 * Config-plane resource, scope-gated with the `user_attribute.*` permissions:
 * the API key must carry the scope AND the calling principal must hold the
 * permission.
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
  asSchema,
} from '../openapi'
import { TimestampSchema, UnauthorizedErrorSchema } from './common'

const USER_ATTRIBUTE_TYPES = ['string', 'number', 'boolean', 'date', 'currency'] as const
const CURRENCY_CODES = [
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

const UserAttributeSchema = z.object({
  id: TypeIdSchema.meta({ example: 'user_attr_01h455vb4pex5vsknk084sn02q' }),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.enum(USER_ATTRIBUTE_TYPES),
  currencyCode: z.enum(CURRENCY_CODES).nullable(),
  externalKey: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

registerPath('/user-attributes', {
  get: {
    tags: ['User Attributes'],
    summary: 'List custom user-attribute definitions',
    description: 'Requires the `user_attribute.view` scope/permission.',
    responses: {
      200: {
        description: 'User attributes',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(UserAttributeSchema, 'User attributes'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      403: { description: 'user_attribute.view permission required' },
    },
  },
  post: {
    tags: ['User Attributes'],
    summary: 'Create a custom user-attribute definition',
    description: 'Requires the `user_attribute.manage` scope/permission.',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              key: z.string().min(1).max(100),
              label: z.string().min(1).max(200),
              description: z.string().max(1000).nullable().optional(),
              type: z.enum(USER_ATTRIBUTE_TYPES),
              currencyCode: z.enum(CURRENCY_CODES).nullable().optional(),
              externalKey: z.string().max(200).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: {
      201: {
        description: 'User attribute created',
        content: {
          'application/json': {
            schema: createItemResponseSchema(UserAttributeSchema, 'User attribute'),
          },
        },
      },
      403: { description: 'user_attribute.manage permission required' },
    },
  },
})

registerPath('/user-attributes/{attributeId}', {
  get: {
    tags: ['User Attributes'],
    summary: 'Get a user-attribute definition',
    parameters: [
      { name: 'attributeId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: {
      200: {
        description: 'User attribute',
        content: {
          'application/json': {
            schema: createItemResponseSchema(UserAttributeSchema, 'User attribute'),
          },
        },
      },
      404: { description: 'User attribute not found' },
    },
  },
  patch: {
    tags: ['User Attributes'],
    summary: 'Update a user-attribute definition',
    description: 'Requires the `user_attribute.manage` scope/permission.',
    parameters: [
      { name: 'attributeId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              label: z.string().min(1).max(200).optional(),
              description: z.string().max(1000).nullable().optional(),
              type: z.enum(USER_ATTRIBUTE_TYPES).optional(),
              currencyCode: z.enum(CURRENCY_CODES).nullable().optional(),
              externalKey: z.string().max(200).nullable().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Updated' } },
  },
  delete: {
    tags: ['User Attributes'],
    summary: 'Delete a user-attribute definition',
    description: 'Requires the `user_attribute.manage` scope/permission.',
    parameters: [
      { name: 'attributeId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Deleted' } },
  },
})
