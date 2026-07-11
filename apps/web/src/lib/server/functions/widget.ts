import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'

const createWidgetIdentifyTokenSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
})

export const createWidgetIdentifyTokenFn = createServerFn({ method: 'POST' })
  .inputValidator(createWidgetIdentifyTokenSchema)
  .handler(() => {
    throw new Error('Inline widget email capture must use /api/widget/identify directly')
  })
