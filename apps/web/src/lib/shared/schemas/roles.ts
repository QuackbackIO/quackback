/**
 * Shared validation schemas for RBAC roles & assignments (REST + MCP).
 * Mirrors the role.service input types. permissionKeys are validated against the
 * live catalogue inside the service, so a loose string array is sufficient here.
 */
import { z } from 'zod'

export const createRoleSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  permissionKeys: z.array(z.string()).max(200).default([]),
})

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
})

export const setRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string()).max(200),
})

export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
  teamId: z.string().nullable().optional(),
})

export type CreateRoleSchemaInput = z.infer<typeof createRoleSchema>
export type UpdateRoleSchemaInput = z.infer<typeof updateRoleSchema>
