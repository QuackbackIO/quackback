import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

const testDir = dirname(fileURLToPath(import.meta.url))
const routesRoot = join(testDir, '../../../../../routes/api/v1')
const checkedInSpecPath = join(testDir, '../../../../../../openapi.json')
const httpMethodPattern = /\b(GET|POST|PATCH|PUT|DELETE):\s*(?:async\s*)?(?:\(|[A-Za-z_$])/g

interface ExpectedRoute {
  file: string
  methods: string[]
  path: string
}

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      return entry === '__tests__' ? [] : collectFiles(fullPath)
    }

    return fullPath.endsWith('.ts') ? [fullPath] : []
  })
}

function isApiRouteFile(file: string): boolean {
  const basename = file.split(sep).at(-1) ?? ''
  return (
    !basename.startsWith('-') &&
    !basename.endsWith('.test.ts') &&
    basename !== 'docs.ts' &&
    basename !== 'openapi.json.ts'
  )
}

function routeFileToOpenApiPath(file: string): string {
  let route = relative(routesRoot, file).split(sep).join('/').replace(/\.ts$/, '')
  if (route.endsWith('/index')) {
    route = route.slice(0, -'/index'.length)
  }

  const segments = route
    .split('/')
    .flatMap((part) => part.split('.'))
    .filter(Boolean)
    .map((segment) => (segment.startsWith('$') ? `{${segment.slice(1)}}` : segment))

  return `/${segments.join('/')}`.replace(/\/$/, '') || '/'
}

function routeFileToMethods(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [
    ...new Set([...source.matchAll(httpMethodPattern)].map((match) => match[1].toLowerCase())),
  ].sort()
}

function collectExpectedRoutes(): ExpectedRoute[] {
  return collectFiles(routesRoot)
    .filter(isApiRouteFile)
    .map((file) => ({
      file,
      methods: routeFileToMethods(file),
      path: routeFileToOpenApiPath(file),
    }))
    .filter((route) => route.methods.length > 0)
}

describe('OpenAPI route coverage', () => {
  it('documents every concrete /api/v1 route path and method', () => {
    const spec = generateOpenAPISpec()
    const failures = collectExpectedRoutes().flatMap((route) => {
      const pathItem = spec.paths?.[route.path]
      if (!pathItem) {
        return [`missing path ${route.path} (${relative(routesRoot, route.file)})`]
      }

      return route.methods
        .filter((method) => !pathItem[method as keyof typeof pathItem])
        .map((method) => `missing method ${method.toUpperCase()} ${route.path}`)
    })

    expect(failures).toEqual([])
  })

  it('keeps the checked-in openapi.json artifact in sync with the generated spec', () => {
    expect(existsSync(checkedInSpecPath), 'checked-in apps/web/openapi.json is missing').toBe(true)

    const generatedSpec = JSON.parse(JSON.stringify(generateOpenAPISpec()))
    const checkedInSpec = JSON.parse(readFileSync(checkedInSpecPath, 'utf8'))

    expect(checkedInSpec).toEqual(generatedSpec)
  })
})
