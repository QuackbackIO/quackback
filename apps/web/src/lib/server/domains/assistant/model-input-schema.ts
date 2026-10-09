import type { z } from 'zod'

function compatibleSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const adapt = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(adapt)
    if (value !== null && typeof value === 'object')
      return compatibleSchema(value as Record<string, unknown>)
    return value
  }
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key, value]) => key !== 'pattern' || typeof value !== 'string' || !/\\[pP]\{/.test(value)
      )
      .map(([key, value]) => [key, adapt(value)])
  )
}

/** Keep validation exact while exporting regexes supported by model providers. */
export function modelInputSchema<T extends z.ZodType>(schema: T) {
  const standard = schema['~standard']
  return {
    '~standard': {
      ...standard,
      jsonSchema: {
        input: (...args: Parameters<typeof standard.jsonSchema.input>) =>
          compatibleSchema(standard.jsonSchema.input(...args)),
        output: (...args: Parameters<typeof standard.jsonSchema.output>) =>
          compatibleSchema(standard.jsonSchema.output(...args)),
      },
    },
  }
}
