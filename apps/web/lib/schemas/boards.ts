import { z } from 'zod'

export const createBoardSchema = z.object({
  name: z.string().min(1, 'Board name is required').max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(true),
})

export const updateBoardSchema = z.object({
  name: z.string().min(1, 'Board name is required').max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean(),
})

export const boardPublicSettingsSchema = z.object({
  allowUserSubmissions: z.boolean(),
})

export const deleteBoardSchema = z.object({
  confirmName: z.string(),
})

export type CreateBoardInput = z.input<typeof createBoardSchema>
export type CreateBoardOutput = z.infer<typeof createBoardSchema>
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>
export type BoardPublicSettingsInput = z.infer<typeof boardPublicSettingsSchema>
export type DeleteBoardInput = z.infer<typeof deleteBoardSchema>
