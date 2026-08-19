/**
 * Macro template variables — the tokens the editor's "insert variable" row
 * offers and the server renderer resolves. Client-safe (no db imports) so the
 * admin editor and the render pass draw from one list: a new token added here
 * appears in both places at once.
 */
export const MACRO_VARIABLES = ['firstName', 'lastName', 'email', 'conversationTitle'] as const
export type MacroVariable = (typeof MACRO_VARIABLES)[number]
