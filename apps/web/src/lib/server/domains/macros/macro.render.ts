/**
 * Macro variable rendering. Pure and dependency-free so it can be unit-tested
 * and reused wherever a macro body needs to be resolved against a conversation.
 *
 * Syntax is a single `{token}` placeholder. Only the four known tokens resolve;
 * every other `{...}` — and any known token whose value is missing — renders as
 * the empty string, so a macro never leaks a raw placeholder to a customer.
 */
import { MACRO_VARIABLES } from '@/lib/shared/conversation/macros'

/**
 * Values a macro body can interpolate. Pulled from the conversation's visitor
 * principal, email-sanitized upstream (realEmail) so a synthetic anonymous
 * address never surfaces.
 */
export interface MacroRenderContext {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  conversationTitle?: string | null
}

/** Interpolate `{token}` placeholders in `body` against `context`. */
export function renderMacro(body: string, context: MacroRenderContext): string {
  return body.replace(/\{(\w+)\}/g, (_match, token: string) => {
    if (!(MACRO_VARIABLES as readonly string[]).includes(token)) return ''
    const value = context[token as keyof MacroRenderContext]
    return value == null ? '' : String(value)
  })
}
