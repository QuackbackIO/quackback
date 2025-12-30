import { z } from 'zod'

export const permissionLevelSchema = z.enum(['anyone', 'authenticated', 'disabled'])

export const createBoardSchema = z.object({
  name: z.string().min(1, 'Board name is required').max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
})

export const updateBoardSchema = z.object({
  name: z.string().min(1, 'Board name is required').max(100),
  description: z.string().max(500).optional(),
})

export const boardAccessSettingsSchema = z.object({
  isPublic: z.boolean(),
  // Permission levels: 'anyone', 'authenticated', 'disabled'
  // undefined means inherit from org settings
  voting: permissionLevelSchema.optional(),
  commenting: permissionLevelSchema.optional(),
  submissions: permissionLevelSchema.optional(),
})

export const deleteBoardSchema = z.object({
  confirmName: z.string(),
})

export type CreateBoardInput = z.input<typeof createBoardSchema>
export type CreateBoardOutput = z.infer<typeof createBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type BoardAccessSettingsInput = z.infer<typeof boardAccessSettingsSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>
