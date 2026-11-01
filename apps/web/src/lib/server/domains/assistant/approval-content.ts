/**
 * What a request changes, written by the server from its stored content: the
 * diff the approvals page shows, and the title, summary and changes a
 * follower reads. Settings requests and design publishes list their changes;
 * an assistant action shows its arguments on the page and nothing to
 * followers.
 */
import type { JsonValue } from '@/lib/shared/json'
import {
  settingsProposalSchema,
  type MessengerEffect,
} from '@/lib/shared/assistant/settings-proposals'
import {
  DESIGN_PUBLISH_TOOL,
  SETTINGS_PROPOSAL_TOOL,
  designPublishArgsSchema,
  summarizeDesignPublish,
  summarizeSettingsProposal,
} from './approval-policy'

interface ContentRow {
  toolName: string
  args: unknown
}

/** What changes, as the person deciding reads it. */
export type ApprovalDiff =
  | {
      kind: 'settings'
      changes: Array<{
        id: string
        area: string
        path: string[]
        before: JsonValue
        after: JsonValue
        /** An image the value stands for, such as a logo. */
        beforePreview?: string | null
        afterPreview?: string | null
        /** What else the change turns on or off. */
        effects?: MessengerEffect[]
      }>
    }
  | {
      kind: 'design'
      /** The portal design draft's changes, each named as Appearance names it. */
      changes: Array<{
        path: string
        label: string
        before: string | number | boolean | null
        after: string | number | boolean | null
      }>
    }
  | { kind: 'action'; args: JsonValue }

export function approvalDiffOf(row: ContentRow): ApprovalDiff {
  if (row.toolName === SETTINGS_PROPOSAL_TOOL) {
    const parsed = settingsProposalSchema.safeParse(row.args)
    if (parsed.success)
      return {
        kind: 'settings',
        changes: parsed.data.changes.map((change) => ({
          id: change.id,
          area: change.area,
          path: change.path,
          before: change.before as JsonValue,
          after: change.after as JsonValue,
          ...(change.beforePreview !== undefined ? { beforePreview: change.beforePreview } : {}),
          ...(change.afterPreview !== undefined ? { afterPreview: change.afterPreview } : {}),
          ...(change.effects ? { effects: change.effects } : {}),
        })),
      }
  }
  if (row.toolName === DESIGN_PUBLISH_TOOL) {
    const parsed = designPublishArgsSchema.safeParse(row.args)
    if (parsed.success) return { kind: 'design', changes: parsed.data.changes }
  }
  return { kind: 'action', args: row.args as JsonValue }
}

export interface ListedChanges {
  title: string
  summary: string
  changes: Array<{ field: string; from: JsonValue; to: JsonValue }>
}

/** The title, summary and changes of a request that lists its changes, else null. */
export function listedChanges(row: ContentRow): ListedChanges | null {
  if (row.toolName === SETTINGS_PROPOSAL_TOOL) {
    const parsed = settingsProposalSchema.safeParse(row.args)
    if (parsed.success)
      return {
        title: 'Settings change',
        summary: summarizeSettingsProposal(parsed.data),
        changes: parsed.data.changes.map((change) => ({
          field: change.id,
          from: change.before as JsonValue,
          to: change.after as JsonValue,
        })),
      }
  }
  if (row.toolName === DESIGN_PUBLISH_TOOL) {
    const parsed = designPublishArgsSchema.safeParse(row.args)
    if (parsed.success)
      return {
        title: 'Portal design publish',
        summary: summarizeDesignPublish(parsed.data),
        changes: parsed.data.changes.map((change) => ({
          field: change.path,
          from: change.before,
          to: change.after,
        })),
      }
  }
  return null
}
