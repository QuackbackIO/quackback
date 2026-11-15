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
  createRequestBodySchema,
  asSchema,
} from '../openapi'
import {
  TimestampSchema,
  UnauthorizedErrorSchema,
  NotFoundErrorSchema,
  ValidationErrorSchema,
} from './common'

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
          'Restrict to companies with at least one member carrying this user tag. Unknown or malformed IDs return an empty list.',
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

// Write bodies (POST /companies, PATCH /companies/{companyId})
const companyWriteFields = {
  domain: z.string().max(255).nullable().optional().meta({ example: 'acme.example' }),
  externalId: z
    .string()
    .max(255)
    .nullable()
    .optional()
    .meta({ description: 'External system identifier; unique', example: 'cust-123' }),
  plan: z.string().max(255).nullable().optional(),
  mrrCents: z.number().int().nullable().optional(),
  size: z.string().max(255).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  industry: z.string().max(255).nullable().optional(),
  customAttributes: z.record(z.string(), z.unknown()).optional(),
}
const CreateCompanyBodySchema = createRequestBodySchema(
  { name: z.string().min(1).max(200).meta({ example: 'Acme Corp' }), ...companyWriteFields },
  'Company to create (source is set to api)'
)
const UpdateCompanyBodySchema = createRequestBodySchema(
  { name: z.string().min(1).max(200).optional(), ...companyWriteFields },
  'Fields to update; at least one'
)
const companyIdParam = {
  name: 'companyId',
  in: 'path' as const,
  required: true,
  schema: { type: 'string' as const },
  description: 'Company ID',
}
const conflict = {
  description: 'externalId or domain already in use',
  content: { 'application/json': { schema: ValidationErrorSchema } },
}
const unauthorized = {
  description: 'Unauthorized',
  content: { 'application/json': { schema: UnauthorizedErrorSchema } },
}
const invalid = {
  description: 'Invalid request',
  content: { 'application/json': { schema: ValidationErrorSchema } },
}
const notFound = {
  description: 'Company not found',
  content: { 'application/json': { schema: NotFoundErrorSchema } },
}

registerPath('/companies', {
  post: {
    tags: ['Companies'],
    summary: 'Create a company',
    description: 'Creates a company with source "api". Requires company.manage.',
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(CreateCompanyBodySchema) } },
    },
    responses: {
      201: {
        description: 'Company created',
        content: {
          'application/json': { schema: createItemResponseSchema(CompanySchema, 'Company') },
        },
      },
      400: invalid,
      401: unauthorized,
      409: conflict,
    },
  },
})

registerPath('/companies/{companyId}', {
  patch: {
    tags: ['Companies'],
    summary: 'Update a company',
    description: 'Updates the provided fields of a company. Requires company.manage.',
    parameters: [companyIdParam],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: asSchema(UpdateCompanyBodySchema) } },
    },
    responses: {
      200: {
        description: 'Updated company',
        content: {
          'application/json': { schema: createItemResponseSchema(CompanySchema, 'Company') },
        },
      },
      400: invalid,
      401: unauthorized,
      404: notFound,
      409: conflict,
    },
  },
})

registerPath('/companies/{companyId}/members/{principalId}', {
  put: {
    tags: ['Companies'],
    summary: 'Link a person to a company',
    description:
      'Links the person to the company (a person belongs to one company). Idempotent. Requires company.manage.',
    parameters: [
      companyIdParam,
      {
        name: 'principalId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: 'Principal ID of the person',
      },
    ],
    responses: {
      204: { description: 'Linked' },
      400: invalid,
      401: unauthorized,
      404: notFound,
    },
  },
})
