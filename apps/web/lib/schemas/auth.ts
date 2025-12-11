import { z } from 'zod'

export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  role: z.enum(['member', 'admin']),
})

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().min(3, 'URL slug must be at least 3 characters'),
})

/**
 * Schema for creating a new workspace (org + user)
 * Used on the main domain /create-workspace flow
 * Note: No password - uses email OTP for authentication
 */
export const createWorkspaceSchema = z.object({
  workspaceName: z.string().min(2, 'Workspace name must be at least 2 characters'),
  workspaceSlug: z
    .string()
    .min(3, 'URL must be at least 3 characters')
    .max(32, 'URL must be at most 32 characters')
    .regex(/^[a-z0-9-]+$/, 'URL can only contain lowercase letters, numbers, and hyphens'),
  name: z.string().min(2, 'Your name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
})

/**
 * Schema for updating user profile
 */
export const updateProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
})

export type InviteInput = z.infer<typeof inviteSchema>
export type CreateOrgInput = z.infer<typeof createOrgSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
