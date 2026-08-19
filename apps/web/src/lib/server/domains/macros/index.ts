/** Macros domain: canned replies with variables + bundled actions (§4.6). */
export { renderMacro, type MacroRenderContext } from './macro.render'
export {
  listMacros,
  getMacro,
  createMacro,
  updateMacro,
  deleteMacro,
  buildMacroContext,
  type MacroDTO,
} from './macro.service'
export { applyMacroActions } from './macro.actions'
