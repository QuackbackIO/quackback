/**
 * Display metadata for conversation priority — label + dot/badge color — shared
 * by the inbox badge, the priority picker, and the list filter so the colors
 * and ordering stay in one place. Client-safe (no server imports).
 */
import type { ConversationPriority } from './types'

export interface PriorityMeta {
  value: ConversationPriority
  label: string
  /** Hex color for an inline dot/badge (matches the status-badge dot idiom). */
  color: string
}

const META: Record<ConversationPriority, PriorityMeta> = {
  none: { value: 'none', label: 'None', color: '#9ca3af' },
  low: { value: 'low', label: 'Low', color: '#60a5fa' },
  medium: { value: 'medium', label: 'Medium', color: '#f59e0b' },
  high: { value: 'high', label: 'High', color: '#f97316' },
  urgent: { value: 'urgent', label: 'Urgent', color: '#ef4444' },
}

export function priorityMeta(p: ConversationPriority): PriorityMeta {
  return META[p] ?? META.none
}

/** Pickable priorities in display order (most urgent first). */
export const PRIORITY_OPTIONS: PriorityMeta[] = [
  META.urgent,
  META.high,
  META.medium,
  META.low,
  META.none,
]
