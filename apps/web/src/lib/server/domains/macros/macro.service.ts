/**
 * Macros domain service: CRUD over the `macros` table plus the render-context
 * builder that resolves a conversation's visitor into {firstName}-style values.
 *
 * Macros supersede the old settings-JSON canned replies. Permission gating
 * lives at the server-function boundary (conversation.manage to author,
 * conversation.reply to read); everything below is data access apart from the
 * one plan gate documented on `requireMacroLibrary`, which has to sit here
 * because every macro surface reaches the library through this module.
 */
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  desc,
  macros,
  conversations,
  principal,
  user,
  type MacroScope,
  type MacroAction,
} from '@/lib/server/db'
import type { MacroId, PrincipalId, ConversationId } from '@quackback/ids'
import { realEmail } from '@/lib/shared/anonymous-email'
import { firstNameOf } from '@/lib/shared/conversation/personalize'
import { NotFoundError } from '@/lib/shared/errors'
import type { MacroRenderContext } from './macro.render'

/**
 * The columns every macro read and write projects. Kept as a plain object:
 * Drizzle's `SelectedFields` does not accept a readonly (`as const`) shape.
 */
const MACRO_COLUMNS = {
  id: macros.id,
  name: macros.name,
  body: macros.body,
  scope: macros.scope,
  actions: macros.actions,
}

export interface MacroDTO {
  id: MacroId
  name: string
  body: string
  scope: MacroScope
  actions: MacroAction[]
}

function toDTO(row: {
  id: MacroId
  name: string
  body: string
  scope: MacroScope
  actions: MacroAction[]
}): MacroDTO {
  return { id: row.id, name: row.name, body: row.body, scope: row.scope, actions: row.actions }
}

/**
 * The plan gate on the macro library. It sits on the two entry points that put
 * a macro in front of a teammate — discovering the library and adding to it —
 * rather than on every function here: editing and deleting stay open so a
 * workspace that drops below the plan including macros can still tidy up what
 * it already has, exactly as a downgraded workspace may still clear a custom
 * domain it can no longer set.
 *
 * No-op on any install without a plan, which is every self-hosted one — see
 * domains/settings/cloud/entitlements.ts.
 */
async function requireMacroLibrary(): Promise<void> {
  const { requireEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
  await requireEntitlement('aiDrafts')
}

/**
 * List live macros, newest first. `surface` narrows to the macros a given
 * surface offers: the support inbox sees `support` + `both`, the feedback
 * surfaces see `feedback` + `both`. Omitted returns every scope (the manager).
 */
export async function listMacros(surface?: 'support' | 'feedback'): Promise<MacroDTO[]> {
  await requireMacroLibrary()
  const scopes: MacroScope[] =
    surface === 'support'
      ? ['support', 'both']
      : surface === 'feedback'
        ? ['feedback', 'both']
        : ['support', 'feedback', 'both']
  const rows = await db
    .select(MACRO_COLUMNS)
    .from(macros)
    .where(and(isNull(macros.deletedAt), inArray(macros.scope, scopes)))
    .orderBy(desc(macros.createdAt))
  return rows.map(toDTO)
}

async function loadMacroOr404(id: MacroId) {
  const [row] = await db
    .select(MACRO_COLUMNS)
    .from(macros)
    .where(and(eq(macros.id, id), isNull(macros.deletedAt)))
    .limit(1)
  if (!row) throw new NotFoundError('NOT_FOUND', 'Macro not found')
  return row
}

export async function createMacro(input: {
  name: string
  body: string
  scope: MacroScope
  actions: MacroAction[]
  createdByPrincipalId: PrincipalId
}): Promise<MacroDTO> {
  await requireMacroLibrary()
  const [row] = await db
    .insert(macros)
    .values({
      name: input.name,
      body: input.body,
      scope: input.scope,
      actions: input.actions,
      createdByPrincipalId: input.createdByPrincipalId,
    })
    .returning(MACRO_COLUMNS)
  return toDTO(row)
}

export async function updateMacro(
  id: MacroId,
  input: Partial<{ name: string; body: string; scope: MacroScope; actions: MacroAction[] }>
): Promise<MacroDTO> {
  await loadMacroOr404(id)
  const [row] = await db
    .update(macros)
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.scope !== undefined && { scope: input.scope }),
      ...(input.actions !== undefined && { actions: input.actions }),
      updatedAt: new Date(),
    })
    .where(eq(macros.id, id))
    .returning(MACRO_COLUMNS)
  return toDTO(row)
}

/** Soft-delete: the row survives for attribution, hidden from every list. */
export async function deleteMacro(id: MacroId): Promise<void> {
  await loadMacroOr404(id)
  await db.update(macros).set({ deletedAt: new Date() }).where(eq(macros.id, id))
}

/** Fetch a live macro (for rendering + applying its actions). */
export async function getMacro(id: MacroId): Promise<MacroDTO> {
  return toDTO(await loadMacroOr404(id))
}

/**
 * Build the render context from a conversation's visitor principal. First/last
 * name are split from the best available display name (synced user name, else
 * the principal's display name); email is realEmail-sanitized so an anonymous
 * visitor's synthetic address never renders.
 */
export async function buildMacroContext(
  conversationId: ConversationId
): Promise<MacroRenderContext> {
  const [row] = await db
    .select({
      subject: conversations.subject,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      userName: user.name,
      userEmail: user.email,
    })
    .from(conversations)
    .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row) throw new NotFoundError('NOT_FOUND', 'Conversation not found')
  const fullName = (row.userName ?? row.displayName ?? '').trim()
  const rest = fullName.split(/\s+/).filter(Boolean).slice(1)
  return {
    firstName: firstNameOf(fullName) ?? null,
    lastName: rest.length > 0 ? rest.join(' ') : null,
    email: realEmail(row.userEmail) ?? realEmail(row.contactEmail),
    conversationTitle: row.subject ?? null,
  }
}
