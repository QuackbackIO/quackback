import type { Channel } from '@/lib/shared/channels'
import type { ChannelAdapter } from './types'

const ADAPTERS = new Map<Channel, ChannelAdapter>()

export function registerChannelAdapter(adapter: ChannelAdapter): void {
  ADAPTERS.set(adapter.id, adapter)
}

export function unregisterChannelAdapter(id: string): void {
  ADAPTERS.delete(id as Channel)
}

export function getChannelAdapter(id: string): ChannelAdapter | undefined {
  return ADAPTERS.get(id as Channel)
}

export function requireChannelAdapter(id: string): ChannelAdapter {
  const adapter = getChannelAdapter(id)
  if (!adapter) {
    throw new Error(`Unknown conversation channel adapter: ${id}`)
  }
  return adapter
}

export function listChannelAdapters(): ChannelAdapter[] {
  return [...ADAPTERS.values()]
}
