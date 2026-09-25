/**
 * The MCP manage_category tool takes exactly the icons CategoryIcon draws.
 * An icon the tool accepted but the renderer does not know is drawn as the
 * default folder (an emoji, say); one the renderer knows but the tool refused
 * could not be set through MCP. Either kind of drift fails here.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { McpAuthContext } from '@/lib/server/mcp/types'
import { ICON_MAP } from '../category-icon-map'

vi.mock('@/lib/server/domains/help-center/help-center.service', () => ({
  getArticleById: vi.fn(),
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  publishArticle: vi.fn(),
  unpublishArticle: vi.fn(),
  deleteArticle: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
}))

import { registerHelpCenterTools } from '@/lib/server/mcp/tools/help-center'
import { CATEGORY_ICON_NAMES } from '@/lib/server/domains/help-center/category-icons'

interface RegisteredTool {
  description: string
  schema: Record<string, z.ZodType>
}

function manageCategoryTool(): RegisteredTool {
  const tools = new Map<string, RegisteredTool>()
  const fakeServer = {
    tool: (name: string, description: string, schema: Record<string, z.ZodType>) => {
      tools.set(name, { description, schema })
    },
  }
  registerHelpCenterTools(fakeServer as never, {} as McpAuthContext)
  const tool = tools.get('manage_category')
  if (!tool) throw new Error('manage_category is not registered')
  return tool
}

const drawn = Object.keys(ICON_MAP)

describe('manage_category icons', () => {
  const { description, schema } = manageCategoryTool()
  const input = z.object(schema)
  const accepts = (icon: unknown) =>
    input.safeParse({ action: 'create', name: 'Getting started', icon }).success

  it('accepts every icon the renderer draws, and clearing it', () => {
    expect(drawn.filter((icon) => !accepts(icon))).toEqual([])
    expect(accepts(null)).toBe(true)
  })

  it('accepts nothing else', () => {
    expect([...CATEGORY_ICON_NAMES].sort()).toEqual([...drawn].sort())
    for (const icon of ['🚀', 'rocket', 'RocketLaunch', 'constructor', 'NotARealIcon']) {
      expect(accepts(icon), icon).toBe(false)
    }
  })

  it('describes icons by names the renderer draws', () => {
    const text = `${description}\n${schema.icon.description ?? ''}`
    const named = [...text.matchAll(/"([A-Za-z0-9]+Icon)"/g)].map((m) => m[1])
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((icon) => !(icon in ICON_MAP))).toEqual([])
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
