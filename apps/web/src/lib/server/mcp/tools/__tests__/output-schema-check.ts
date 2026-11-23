/**
 * Test helper for the fake MCP servers in this folder: wraps a registered
 * handler so every successful result of a tool with an `outputSchema` is
 * checked against it, the way the SDK checks it before answering. Each read
 * tool's existing tests then prove its real results fit its schema.
 */
import { expect } from 'vitest'
import type { z } from 'zod'

type ToolConfig = { outputSchema?: z.ZodType }

export function checkedAgainstOutputSchema<H extends (...args: never[]) => Promise<unknown>>(
  config: unknown,
  handler: H
): H {
  const schema = (config as ToolConfig | undefined)?.outputSchema
  if (!schema) return handler
  return (async (...args: Parameters<H>) => {
    const result = (await handler(...args)) as {
      isError?: boolean
      structuredContent?: unknown
      content?: { type: string; text?: string }[]
    }
    if (!result.isError) {
      expect(
        result.structuredContent,
        'a tool with an outputSchema returns structuredContent'
      ).toBeDefined()
      const parsed = schema.safeParse(result.structuredContent)
      expect(parsed.success ? null : parsed.error.message).toBeNull()
      // Text and structured copies agree, untrusted marker included.
      expect(result.structuredContent).toEqual(JSON.parse(result.content?.[0]?.text ?? 'null'))
    }
    return result
  }) as H
}
