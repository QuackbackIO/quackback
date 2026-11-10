/**
 * A setting's id: its dotted path in the design document, made only of the
 * keys the schema names. The keys of a map (such as a language) are dropped,
 * and a path stops at a list or at anything the schema does not name, so an
 * id never carries words, links or colours a person typed.
 */
import type { z } from 'zod'
import { portalDesignV2 } from './schema'

type Node = z.core.$ZodType

/**
 * The schema a wrapper stands for: optional, nullable, default, a
 * transform's input, or what a preprocess hands its value on to.
 */
function unwrap(node: Node): Node {
  for (;;) {
    const def = node._zod.def as z.core.$ZodTypeDef & Record<string, unknown>
    if ('innerType' in def) node = def.innerType as Node
    else if (def.type === 'pipe') {
      const into = def.in as Node
      node = (into._zod.def.type === 'transform' ? def.out : into) as Node
    } else if (def.type === 'lazy') node = (def.getter as () => Node)()
    else return node
  }
}

/** The fields one step down: an object's, or those of each object a union can be. */
function fieldsOf(node: Node): Array<Record<string, Node>> {
  const def = node._zod.def as z.core.$ZodTypeDef & Record<string, unknown>
  if (def.type === 'object') return [def.shape as Record<string, Node>]
  if (def.type === 'union')
    return (def.options as Node[]).map(unwrap).flatMap((option) => fieldsOf(option))
  return []
}

export function settingIdOf(path: string): string | null {
  const ids: string[] = []
  let node: Node = portalDesignV2
  for (const segment of path.split('.')) {
    node = unwrap(node)
    if (node._zod.def.type === 'record') {
      node = (node._zod.def as z.core.$ZodRecordDef).valueType
      continue
    }
    const next = fieldsOf(node).find((fields) => Object.hasOwn(fields, segment))?.[segment]
    if (!next) break
    ids.push(segment)
    node = next
  }
  return ids.length ? ids.join('.') : null
}

/** Whether a value is a setting id, and nothing more. */
export function isSettingId(value: string): boolean {
  return value !== '' && settingIdOf(value) === value
}
