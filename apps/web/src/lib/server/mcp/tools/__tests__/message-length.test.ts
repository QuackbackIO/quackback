/**
 * Every MCP tool that writes a conversation or ticket message must accept
 * exactly what the message write accepts: validateContent (messages/
 * message-core.ts) refuses anything over MAX_CONVERSATION_MESSAGE_LENGTH. A
 * tool schema that allows more lets the caller send text the write then
 * refuses, after the call has already been accepted.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { MAX_CONVERSATION_MESSAGE_LENGTH } from '@/lib/shared/conversation/types'
import { validateContent } from '@/lib/server/messages/message-core'
import { registerTicketTools } from '../tickets'
import { registerConversationTools } from '../conversations'
import { createTicketTool } from '@/lib/server/domains/assistant/assistant.toolspec'
import type { McpAuthContext } from '../../types'

type Shape = Record<string, z.ZodType>

/** Register tools against a fake server and capture each tool's input shape. */
function schemas(register: (server: never, auth: McpAuthContext) => void): Map<string, Shape> {
  const out = new Map<string, Shape>()
  const fakeServer = {
    registerTool: (name: string, config: { inputSchema: z.ZodObject<Shape> }) => {
      out.set(name, config.inputSchema.shape)
    },
  }
  register(fakeServer as never, { role: 'admin', scopes: [] } as unknown as McpAuthContext)
  return out
}

const tickets = schemas(registerTicketTools)
const conversations = schemas(registerConversationTools)

const atLimit = 'a'.repeat(MAX_CONVERSATION_MESSAGE_LENGTH)
const overLimit = 'a'.repeat(MAX_CONVERSATION_MESSAGE_LENGTH + 1)

describe('message length limits on MCP write tools', () => {
  it('the message write itself refuses one character over the limit', () => {
    expect(validateContent(atLimit)).toBe(atLimit)
    expect(() => validateContent(overLimit)).toThrow()
  })

  it.each([
    ['reply_to_ticket', tickets, 'content'],
    ['add_ticket_note', tickets, 'content'],
    ['create_ticket', tickets, 'description'],
    ['reply_to_conversation', conversations, 'content'],
  ])('%s accepts the limit and refuses one character more', (name, registry, field) => {
    const shape = registry.get(name)
    expect(shape, `${name} is registered`).toBeDefined()
    const fieldSchema = shape![field]
    expect(fieldSchema.safeParse(atLimit).success).toBe(true)
    expect(fieldSchema.safeParse(overLimit).success).toBe(false)
  })

  it("the AI agent's create_ticket description has the same limit", () => {
    const description = (createTicketTool.inputSchema as z.ZodObject<Shape>).shape.description
    expect(description.safeParse(atLimit).success).toBe(true)
    expect(description.safeParse(overLimit).success).toBe(false)
  })
})
