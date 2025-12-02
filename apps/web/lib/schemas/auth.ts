import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const signupSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
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

export type LoginInput = z.infer<typeof loginSchema>
export type SignupInput = z.infer<typeof signupSchema>
export type InviteInput = z.infer<typeof inviteSchema>
export type CreateOrgInput = z.infer<typeof createOrgSchema>
