import { writeFileSync } from 'node:fs'
import { generateOpenAPISpec } from '../src/lib/server/domains/api/openapi'
import '../src/lib/server/domains/api/schemas'

const spec = generateOpenAPISpec()
// Avoid absolute path to website since that requires workspace access out of quackback context
// if bun is running in quackback workspace. We'll dump it locally then copy it over in bash.
writeFileSync('./openapi.json', JSON.stringify(spec, null, 2))
console.log('OpenAPI spec generated successfully')
