/**
 * The retired detail URLs redirect with their id and query. A route file named
 * `automation.connectors.$connectorId.tsx` nests under `automation.connectors.tsx`,
 * and the parent's redirect runs first, so the id would be lost. The detail
 * routes escape the parent with a trailing underscore on the segment they share.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'

const SRC = path.resolve(__dirname, '../../..')
const ADMIN = path.join(SRC, 'routes/admin')
const TREE = path.join(SRC, 'routeTree.gen.ts')

describe('retired automation detail routes', () => {
  it('are not flat-dotted children of a redirecting list route', () => {
    const files = new Set(readdirSync(ADMIN))
    const nested = [...files].filter((file) => {
      if (!file.startsWith('automation.') || !file.endsWith('.tsx')) return false
      const segments = file.slice(0, -'.tsx'.length).split('.')
      // `automation.connectors.$connectorId` has the parent file `automation.connectors.tsx`.
      return segments.length > 2 && files.has(`${segments.slice(0, -1).join('.')}.tsx`)
    })
    expect(nested).toEqual([])
  })

  it.skipIf(!existsSync(TREE))(
    'render directly under the admin layout in the generated tree',
    () => {
      const source = readFileSync(TREE, 'utf8')
      const parentOf = (specifier: string) => {
        const ident = source.match(
          new RegExp(`import \\{ Route as (\\w+) \\} from './routes/admin/${specifier}'`)
        )?.[1]
        expect(ident, specifier).toBeDefined()
        const parent = source.match(
          new RegExp(
            `const \\w+ =\\s*${ident}\\.update\\(\\{[^}]*?getParentRoute: \\(\\) => (\\w+),`
          )
        )?.[1]
        return parent
      }
      expect(parentOf('automation\\.connectors_\\.\\$connectorId')).toBe('AdminRoute')
      expect(parentOf('automation_\\.workflows\\.\\$workflowId')).toBe('AdminRoute')
    }
  )
})
