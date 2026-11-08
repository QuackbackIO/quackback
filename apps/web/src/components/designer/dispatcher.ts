/**
 * How the builder's panels change Home's blocks and the pages' parts: by
 * dispatching the design's operations (lib/shared/design/dispatch.ts), the
 * same ones Quackback AI's operations make, never by writing the draft. A
 * setting that would be refused is refused before the draft is touched, so
 * it never becomes an empty step; the panel says why.
 */
import {
  applyDesignOp,
  refusalOf,
  type DesignOp,
  type DispatchResult,
} from '@/lib/shared/design/dispatch'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** The draft's change, under a name for undo. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => unknown

/** Makes one operation on the draft as one step, under the label given. */
export type Dispatch = (op: DesignOp, label?: string) => DispatchResult

/** The dispatch for a draft: each operation checked against `design`, then made through `update`. */
export function dispatcher(design: PortalDesign, update: NamedUpdate): Dispatch {
  return (op, label) => {
    const refusal = refusalOf(design, op)
    if (refusal) return { ok: false, refusal }
    // A draft that holds the change for later still took it.
    let result: DispatchResult = { ok: true }
    update((draft) => {
      result = applyDesignOp(draft, op)
    }, label)
    return result
  }
}
