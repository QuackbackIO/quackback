import type { Channel } from '@/lib/shared/conversation/types'
import type { ChannelDescriptor } from './types'

const DESCRIPTORS = new Map<Channel, ChannelDescriptor>()

export function registerChannelDescriptor(descriptor: ChannelDescriptor): void {
  DESCRIPTORS.set(descriptor.id, descriptor)
}

export function unregisterChannelDescriptor(id: string): void {
  DESCRIPTORS.delete(id as Channel)
}

export function getChannelDescriptor(id: string): ChannelDescriptor | undefined {
  return DESCRIPTORS.get(id as Channel)
}

export function requireChannelDescriptor(id: string): ChannelDescriptor {
  const descriptor = getChannelDescriptor(id)
  if (!descriptor) {
    throw new Error(`Unknown conversation channel: ${id}`)
  }
  return descriptor
}

export function listChannelDescriptors(): ChannelDescriptor[] {
  return [...DESCRIPTORS.values()]
}

/** Display labels for every registered channel, keyed by id. */
export function channelLabelMap(): Record<Channel, string> {
  return Object.fromEntries(listChannelDescriptors().map((d) => [d.id, d.label])) as Record<
    Channel,
    string
  >
}

export function isChannel(id: string): id is Channel {
  return DESCRIPTORS.has(id as Channel)
}

/** Inbox `?channel=` and list-filter values: a registered descriptor id, else drop. */
export function parseChannel(value: unknown): Channel | undefined {
  return typeof value === 'string' && isChannel(value) ? value : undefined
}

/** Last visitor transport wins: a registered channel id stays; anything else is messenger. */
export function channelFromVisitorTransport(source: string | undefined | null): Channel {
  if (source && isChannel(source)) return source
  return 'messenger'
}
