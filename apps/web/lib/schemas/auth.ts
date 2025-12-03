import { z } from 'zod'

/**
 * Password validation with complexity requirements
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
  orgName: z.string().min(2, 'Organization name must be at least 2 characters'),
})

export const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['member', 'admin']),
})

export const createOrgSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  slug: z.string().min(3, 'URL slug must be at least 3 characters'),
})

/**
 * Schema for creating a new workspace (org + user)
 * Used on the main domain /create-workspace flow
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
  password: passwordSchema,
})

/**
 * Schema for joining an existing tenant (subdomain signup)
 */
export const tenantSignupSchema = z.object({
  name: z.string().min(2, 'Your name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
})

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type InviteInput = z.infer<typeof inviteSchema>
export type CreateOrgInput = z.infer<typeof createOrgSchema>
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type TenantSignupInput = z.infer<typeof tenantSignupSchema>
