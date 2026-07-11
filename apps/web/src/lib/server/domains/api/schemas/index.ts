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
import './post-actions'
import './posts.votes'
import './boards'
import './comments'
import './tags'
import './statuses'
import './members'
import './users'
import './roadmaps'
import './changelog'
import './suggestions'
import './apps'
// Phase 3-7: ticketing + support config + admin/RBAC
import './tickets'
import './ticket-statuses'
import './support-config'
import './admin'
import './admin-extensions'
import './principals'
import './webhooks'
import './conversations'
import './conversation-actions'
import './chat-tags'
import './settings'
import './moderation'
import './mentions'
import './session-users'
import './internal'
// Authz + ticketing config-plane surface: audience targeting + portal config
import './help-center'
import './segments'
import './user-attributes'
import './changelog-visibility'
import './portal-tabs'
import './widget-profiles'
import './widget-profile-environments'
import './support-config-extensions'
import './teams'
import './roles'
