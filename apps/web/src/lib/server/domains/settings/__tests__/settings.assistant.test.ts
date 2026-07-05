/**
 * Assistant customization settings: tool-execution controls and per-surface
 * instructions. Both ride in the generic `settings.metadata` bag, so
 * `settings.helpers` is mocked directly (mirrors managed-guard-mutators.test)
 * rather than standing up a full DB double — `writeMetadataKey` itself already
 * guarantees sibling-key preservation and cache invalidation elsewhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockWriteMetadataKey: vi.fn(),
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  writeMetadataKey: hoisted.mockWriteMetadataKey,
  parseJsonOrNull: <T>(json: string | null): T | null => {
    if (!json) return null
    try {
      return JSON.parse(json) as T
    } catch {
      return null
    }
  },
  wrapDbError: (_operation: string, error: unknown) => {
    throw error
  },
}))

import {
  getAssistantToolControls,
  updateAssistantToolControls,
  getAssistantSurfaces,
  updateAssistantSurfaces,
} from '../settings.assistant'

function settingsRow(metadata: Record<string, unknown> | null = null) {
  return { id: 'settings_1', metadata: metadata ? JSON.stringify(metadata) : null }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireSettings.mockResolvedValue(settingsRow())
  hoisted.mockWriteMetadataKey.mockResolvedValue(undefined)
})

describe('assistant tool controls', () => {
  it('returns {} when unset', async () => {
    expect(await getAssistantToolControls()).toEqual({})
  })

  it('resolves a previously saved map', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(
      settingsRow({ assistantToolControls: { end_conversation: 'approval' } })
    )
    expect(await getAssistantToolControls()).toEqual({ end_conversation: 'approval' })
  })

  it('roundtrips a write through writeMetadataKey', async () => {
    const result = await updateAssistantToolControls({ end_conversation: 'approval' })
    expect(result).toEqual({ end_conversation: 'approval' })
    expect(hoisted.mockWriteMetadataKey).toHaveBeenCalledWith('assistantToolControls', {
      end_conversation: 'approval',
    })
  })

  it('rejects an invalid mode value', async () => {
    await expect(
      updateAssistantToolControls({ end_conversation: 'bogus' } as never)
    ).rejects.toThrow()
    expect(hoisted.mockWriteMetadataKey).not.toHaveBeenCalled()
  })

  it('accepts a control for a tool name the registry does not know about yet', async () => {
    // The registry (assistant domain) validates real tool names; settings must
    // tolerate a control saved ahead of a connector tool that ships later.
    const result = await updateAssistantToolControls({ future_connector_tool: 'autonomous' })
    expect(result).toEqual({ future_connector_tool: 'autonomous' })
  })

  it('rejects non-record shapes', async () => {
    await expect(updateAssistantToolControls(['approval'] as never)).rejects.toThrow()
    await expect(updateAssistantToolControls('approval' as never)).rejects.toThrow()
    await expect(updateAssistantToolControls(null as never)).rejects.toThrow()
  })

  it('leaves sibling metadata keys untouched (writeMetadataKey owns the merge)', async () => {
    await updateAssistantToolControls({ end_conversation: 'disabled' })
    // Only the tool-controls key is written; writeMetadataKey itself preserves
    // whatever else lives in the bag (officeHours, ticketForms, ...).
    expect(hoisted.mockWriteMetadataKey).toHaveBeenCalledTimes(1)
    expect(hoisted.mockWriteMetadataKey).toHaveBeenCalledWith('assistantToolControls', {
      end_conversation: 'disabled',
    })
  })
})

describe('assistant surfaces', () => {
  it('returns {} when unset', async () => {
    expect(await getAssistantSurfaces()).toEqual({})
  })

  it('roundtrips a partial surface map', async () => {
    const result = await updateAssistantSurfaces({ widget: { instructions: 'Be concise.' } })
    expect(result).toEqual({ widget: { instructions: 'Be concise.' } })
    expect(hoisted.mockWriteMetadataKey).toHaveBeenCalledWith('assistantSurfaces', {
      widget: { instructions: 'Be concise.' },
    })
  })

  it('resolves a previously saved map', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(
      settingsRow({ assistantSurfaces: { email: { instructions: 'Sign off warmly.' } } })
    )
    expect(await getAssistantSurfaces()).toEqual({ email: { instructions: 'Sign off warmly.' } })
  })

  it('rejects an unknown surface key', async () => {
    await expect(
      updateAssistantSurfaces({ sms: { instructions: 'Be concise.' } } as never)
    ).rejects.toThrow()
    expect(hoisted.mockWriteMetadataKey).not.toHaveBeenCalled()
  })

  it('enforces the instructions max length', async () => {
    await expect(
      updateAssistantSurfaces({ widget: { instructions: 'x'.repeat(2001) } })
    ).rejects.toThrow()
    await expect(
      updateAssistantSurfaces({ widget: { instructions: 'x'.repeat(2000) } })
    ).resolves.toBeDefined()
  })

  it('normalizes empty-string instructions to the key being dropped', async () => {
    const result = await updateAssistantSurfaces({ widget: { instructions: '' } })
    expect(result).toEqual({})
    expect(hoisted.mockWriteMetadataKey).toHaveBeenCalledWith('assistantSurfaces', {})
  })

  it('normalizes whitespace-only instructions to the key being dropped', async () => {
    const result = await updateAssistantSurfaces({ widget: { instructions: '   ' } })
    expect(result).toEqual({})
  })
})
