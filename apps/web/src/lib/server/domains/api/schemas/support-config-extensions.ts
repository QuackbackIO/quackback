/**
 * Support config extension schema registrations for nested membership,
 * channel, and SLA-target operations.
 */
import 'zod-openapi'
import { z } from 'zod'
import { asSchema, registerPath, TypeIdSchema } from '../openapi'
import { ValidationErrorSchema } from './common'

const InboxMembershipRoleSchema = z.enum(['owner', 'agent', 'viewer'])
const SlaTargetKindSchema = z.enum(['first_response', 'next_response', 'resolution'])

registerPath('/inboxes/{inboxId}/memberships', {
  get: {
    tags: ['Support Config'],
    summary: 'List inbox memberships',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    responses: { 200: { description: 'Inbox memberships' } },
  },
  post: {
    tags: ['Support Config'],
    summary: 'Add an inbox membership',
    parameters: [{ name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({ principalId: TypeIdSchema, role: InboxMembershipRoleSchema })
          ),
        },
      },
    },
    responses: {
      201: { description: 'Membership created' },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})

registerPath('/inboxes/{inboxId}/memberships/{membershipId}', {
  patch: {
    tags: ['Support Config'],
    summary: 'Update an inbox membership role',
    parameters: [
      { name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'membershipId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(z.object({ role: InboxMembershipRoleSchema })),
        },
      },
    },
    responses: { 200: { description: 'Membership updated' } },
  },
  delete: {
    tags: ['Support Config'],
    summary: 'Remove an inbox membership',
    parameters: [
      { name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'membershipId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Membership removed' } },
  },
})

registerPath('/inboxes/{inboxId}/channels/{channelId}', {
  patch: {
    tags: ['Support Config'],
    summary: 'Update an inbox channel',
    parameters: [
      { name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'channelId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              label: z.string().min(1).max(200).optional(),
              config: z.record(z.string(), z.unknown()).optional(),
              externalId: z.string().max(200).nullable().optional(),
              enabled: z.boolean().optional(),
            })
          ),
        },
      },
    },
    responses: { 200: { description: 'Channel updated' } },
  },
  delete: {
    tags: ['Support Config'],
    summary: 'Archive an inbox channel',
    parameters: [
      { name: 'inboxId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
      { name: 'channelId', in: 'path', required: true, schema: asSchema(TypeIdSchema) },
    ],
    responses: { 204: { description: 'Channel archived' } },
  },
})

registerPath('/sla-policies/{policyId}/targets', {
  put: {
    tags: ['SLA'],
    summary: 'Replace target set',
    parameters: [{ name: 'policyId', in: 'path', required: true, schema: asSchema(TypeIdSchema) }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: asSchema(
            z.object({
              targets: z.array(
                z.object({ kind: SlaTargetKindSchema, minutes: z.number().int().positive() })
              ),
            })
          ),
        },
      },
    },
    responses: {
      200: { description: 'Targets replaced' },
      400: {
        description: 'Validation error',
        content: { 'application/json': { schema: ValidationErrorSchema } },
      },
    },
  },
})
