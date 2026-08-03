/**
 * Team principal schema registrations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath, TypeIdSchema } from '../openapi'
import { TimestampSchema, ValidationErrorSchema } from './common'

const TeamPrincipalSchema = z.object({
  id: TypeIdSchema,
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().email().nullable(),
  image: z.string().nullable(),
  role: z.enum(['admin', 'member']),
  createdAt: TimestampSchema,
})

registerPath('/principals', {
  get: {
    tags: ['Principals'],
    summary: 'List team principals',
    description: 'Lists human team members with admin or member roles.',
    responses: {
      200: {
        description: 'Team principals',
        content: {
          'application/json': {
            schema: asSchema(z.object({ data: z.array(TeamPrincipalSchema) })),
          },
        },
      },
    },
  },
})

registerPath('/principals/{principalId}', {
  get: {
    tags: ['Principals'],
    summary: 'Get a team principal',
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 200: { description: 'Team principal' } },
  },
  patch: {
    tags: ['Principals'],
    summary: 'Update a team principal role',
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ role: z.enum(['admin', 'member']) })),
        },
      },
    },
    responses: {
      200: { description: 'Updated team principal' },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
  delete: {
    tags: ['Principals'],
    summary: 'Remove a team principal',
    description: 'Converts the team member to a portal user.',
    parameters: [
      { name: 'principalId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Removed' } },
  },
})
