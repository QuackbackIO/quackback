/**
 * Companies API Schema Registrations
 */
import 'zod-openapi'
import { z } from 'zod'
import {
  registerPath,
  TypeIdSchema,
  createItemResponseSchema,
  createPaginatedResponseSchema,
} from '../openapi'
import { TimestampSchema, UnauthorizedErrorSchema, NotFoundErrorSchema } from './common'

// Company schema (GET /companies, GET /companies/{companyId})
const CompanySchema = z
  .object({
    id: TypeIdSchema.meta({ example: 'company_01h455vb4pex5vsknk084sn02q' }),
    name: z.string().meta({ example: 'Acme Corp' }),
    domain: z.string().nullable().meta({ example: 'acme.example' }),
    externalId: z
      .string()
      .nullable()
      .meta({ description: 'External system identifier, when linked' }),
    plan: z.string().nullable().meta({ example: 'pro' }),
    mrrCents: z
      .number()
      .nullable()
      .meta({ description: 'Monthly recurring revenue in minor currency units' }),
    size: z.string().nullable().meta({ description: 'Company size band', example: '11-50' }),
    website: z.string().nullable(),
    industry: z.string().nullable(),
    source: z.string().meta({ description: "Record origin: 'api' or 'manual'" }),
    customAttributes: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Custom attribute key/value pairs' }),
    memberCount: z.number().meta({ description: 'Number of people linked to this company' }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ description: 'Company with member count' })

// Register GET /companies
registerPath('/companies', {
  get: {
    tags: ['Companies'],
    summary: 'List companies',
    description: 'Returns a paginated list of companies with their member counts, ordered by name',
    parameters: [
      {
        name: 'search',
        in: 'query',
        schema: { type: 'string' },
        description: 'Search in name and domain',
      },
      {
        name: 'company_id',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Exact match on the external reference (external ID). Unknown references return an empty list.',
      },
      {
        name: 'tag_id',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Restrict to companies whose members authored posts carrying this post tag. Unknown or malformed IDs return an empty list.',
      },
      {
        name: 'segment_id',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Restrict to companies with at least one member in this segment. Unknown or malformed IDs return an empty list.',
      },
      {
        name: 'cursor',
        in: 'query',
        schema: { type: 'string' },
        description: 'Pagination cursor from previous response',
      },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', default: 20, maximum: 100 },
        description: 'Items per page (max 100)',
      },
    ],
    responses: {
      200: {
        description: 'List of companies',
        content: {
          'application/json': {
            schema: createPaginatedResponseSchema(CompanySchema, 'Paginated companies list'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
    },
  },
})

// Register GET /companies/{companyId}
registerPath('/companies/{companyId}', {
  get: {
    tags: ['Companies'],
    summary: 'Get a company',
    description: 'Returns a single company with its member count',
    parameters: [
      {
        name: 'companyId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Company ID',
      },
    ],
    responses: {
      200: {
        description: 'Company',
        content: {
          'application/json': {
            schema: createItemResponseSchema(CompanySchema, 'Company'),
          },
        },
      },
      401: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: UnauthorizedErrorSchema } },
      },
      404: {
        description: 'Company not found',
        content: { 'application/json': { schema: NotFoundErrorSchema } },
      },
    },
  },
})
