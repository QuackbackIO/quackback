/**
 * API Schema Index
 *
 * This file imports all schema modules to register their OpenAPI paths.
 * Import this file to populate the OpenAPI specification.
 */

// Common schemas (no paths)
export * from './common'

// Resource schemas (register paths on import)
import './posts'
import './posts.votes'
import './boards'
import './comments'
import './tags'
import './statuses'
import './members'
import './users'
import './roadmaps'
import './changelog'
