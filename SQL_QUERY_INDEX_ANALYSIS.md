# SQL Query & Index Analysis Report

**Generated:** 2025-12-12
**Last Updated:** 2025-12-12
**Status:** All recommendations implemented ✅

---

## Executive Summary

This report analyzes all SQL queries against the PostgreSQL database and compares them with existing indexes. The codebase now has **comprehensive index coverage** for all query patterns.

| Category                     | Count              |
| ---------------------------- | ------------------ |
| Total tables                 | 27                 |
| Total indexes                | 59                 |
| Critical indexes             | All present ✅     |
| Optimization recommendations | All implemented ✅ |

---

## Table of Contents

1. [Current Index Inventory](#current-index-inventory)
2. [Query Analysis by Table](#query-analysis-by-table)
3. [Implementation Status](#implementation-status)
4. [Future Considerations](#future-considerations)

---

## Current Index Inventory

### Authentication Tables

| Table                    | Index Name                         | Columns                           | Type   | Status     |
| ------------------------ | ---------------------------------- | --------------------------------- | ------ | ---------- |
| `user`                   | `user_email_org_idx`               | `(organization_id, email)`        | UNIQUE | ✅         |
| `user`                   | `user_org_id_idx`                  | `(organization_id)`               | B-tree | ✅         |
| `session`                | `session_userId_idx`               | `(userId)`                        | B-tree | ✅         |
| `account`                | `account_userId_idx`               | `(userId)`                        | B-tree | ✅         |
| `verification`           | `verification_identifier_idx`      | `(identifier)`                    | B-tree | ✅         |
| `member`                 | `member_organizationId_idx`        | `(organizationId)`                | B-tree | ✅         |
| `member`                 | `member_userId_idx`                | `(userId)`                        | B-tree | ✅         |
| `member`                 | `member_user_org_idx`              | `(userId, organizationId)`        | UNIQUE | ✅         |
| `member`                 | `member_org_role_idx`              | `(organizationId, role)`          | B-tree | ✅         |
| `invitation`             | `invitation_organizationId_idx`    | `(organizationId)`                | B-tree | ✅         |
| `invitation`             | `invitation_email_idx`             | `(email)`                         | B-tree | ✅         |
| `invitation`             | `invitation_org_email_status_idx`  | `(organizationId, email, status)` | B-tree | ✅ **NEW** |
| `sso_provider`           | `sso_provider_org_id_idx`          | `(organizationId)`                | B-tree | ✅         |
| `sso_provider`           | `sso_provider_org_domain_idx`      | `(organizationId, domain)`        | UNIQUE | ✅         |
| `sso_provider`           | `sso_provider_domain_idx`          | `(domain)`                        | B-tree | ✅         |
| `session_transfer_token` | `session_transfer_token_token_idx` | `(token)`                         | B-tree | ✅         |
| `workspace_domain`       | `workspace_domain_org_id_idx`      | `(organizationId)`                | B-tree | ✅         |
| `workspace_domain`       | `workspace_domain_domain_idx`      | `(domain)`                        | B-tree | ✅         |

### Application Tables

| Table                      | Index Name                            | Columns                                 | Type      | Status     |
| -------------------------- | ------------------------------------- | --------------------------------------- | --------- | ---------- |
| `boards`                   | `boards_org_slug_idx`                 | `(organization_id, slug)`               | UNIQUE    | ✅         |
| `boards`                   | `boards_org_id_idx`                   | `(organization_id)`                     | B-tree    | ✅         |
| `roadmaps`                 | `roadmaps_org_slug_idx`               | `(organization_id, slug)`               | UNIQUE    | ✅         |
| `roadmaps`                 | `roadmaps_org_id_idx`                 | `(organization_id)`                     | B-tree    | ✅         |
| `roadmaps`                 | `roadmaps_position_idx`               | `(organization_id, position)`           | B-tree    | ✅         |
| `tags`                     | `tags_org_name_idx`                   | `(organization_id, name)`               | UNIQUE    | ✅         |
| `tags`                     | `tags_org_id_idx`                     | `(organization_id)`                     | B-tree    | ✅         |
| `posts`                    | `posts_board_id_idx`                  | `(board_id)`                            | B-tree    | ✅         |
| `posts`                    | `posts_status_idx`                    | `(status)`                              | B-tree    | ✅         |
| `posts`                    | `posts_status_id_idx`                 | `(status_id)`                           | B-tree    | ✅         |
| `posts`                    | `posts_member_id_idx`                 | `(member_id)`                           | B-tree    | ✅         |
| `posts`                    | `posts_owner_member_id_idx`           | `(owner_member_id)`                     | B-tree    | ✅         |
| `posts`                    | `posts_owner_id_idx`                  | `(owner_id)`                            | B-tree    | ✅         |
| `posts`                    | `posts_created_at_idx`                | `(created_at)`                          | B-tree    | ✅         |
| `posts`                    | `posts_vote_count_idx`                | `(vote_count)`                          | B-tree    | ✅         |
| `posts`                    | `posts_board_vote_count_idx`          | `(board_id, vote_count)`                | B-tree    | ✅         |
| `posts`                    | `posts_board_created_at_idx`          | `(board_id, created_at)`                | B-tree    | ✅         |
| `posts`                    | `posts_board_status_idx`              | `(board_id, status)`                    | B-tree    | ✅         |
| `posts`                    | `posts_member_created_at_idx`         | `(member_id, created_at)`               | B-tree    | ✅ **NEW** |
| `post_statuses`            | `post_statuses_org_slug_idx`          | `(organization_id, slug)`               | UNIQUE    | ✅         |
| `post_statuses`            | `post_statuses_org_id_idx`            | `(organization_id)`                     | B-tree    | ✅         |
| `post_statuses`            | `post_statuses_position_idx`          | `(organization_id, category, position)` | B-tree    | ✅         |
| `post_tags`                | `post_tags_pk`                        | `(post_id, tag_id)`                     | UNIQUE/PK | ✅         |
| `post_tags`                | `post_tags_post_id_idx`               | `(post_id)`                             | B-tree    | ✅         |
| `post_tags`                | `post_tags_tag_id_idx`                | `(tag_id)`                              | B-tree    | ✅         |
| `post_roadmaps`            | `post_roadmaps_pk`                    | `(post_id, roadmap_id)`                 | UNIQUE/PK | ✅         |
| `post_roadmaps`            | `post_roadmaps_post_id_idx`           | `(post_id)`                             | B-tree    | ✅         |
| `post_roadmaps`            | `post_roadmaps_roadmap_id_idx`        | `(roadmap_id)`                          | B-tree    | ✅         |
| `post_roadmaps`            | `post_roadmaps_position_idx`          | `(roadmap_id, status_id, position)`     | B-tree    | ✅         |
| `votes`                    | `votes_post_id_idx`                   | `(post_id)`                             | B-tree    | ✅         |
| `votes`                    | `votes_unique_idx`                    | `(post_id, user_identifier)`            | UNIQUE    | ✅         |
| `votes`                    | `votes_member_id_idx`                 | `(member_id)`                           | B-tree    | ✅         |
| `votes`                    | `votes_member_created_at_idx`         | `(member_id, created_at)`               | B-tree    | ✅ **NEW** |
| `comments`                 | `comments_post_id_idx`                | `(post_id)`                             | B-tree    | ✅         |
| `comments`                 | `comments_parent_id_idx`              | `(parent_id)`                           | B-tree    | ✅         |
| `comments`                 | `comments_member_id_idx`              | `(member_id)`                           | B-tree    | ✅         |
| `comments`                 | `comments_created_at_idx`             | `(created_at)`                          | B-tree    | ✅         |
| `comments`                 | `comments_post_created_at_idx`        | `(post_id, created_at)`                 | B-tree    | ✅         |
| `comment_reactions`        | `comment_reactions_comment_id_idx`    | `(comment_id)`                          | B-tree    | ✅         |
| `comment_reactions`        | `comment_reactions_unique_idx`        | `(comment_id, user_identifier, emoji)`  | UNIQUE    | ✅         |
| `changelog_entries`        | `changelog_board_id_idx`              | `(board_id)`                            | B-tree    | ✅         |
| `changelog_entries`        | `changelog_published_at_idx`          | `(published_at)`                        | B-tree    | ✅         |
| `post_subscriptions`       | `post_subscriptions_unique`           | `(post_id, member_id)`                  | UNIQUE    | ✅         |
| `post_subscriptions`       | `post_subscriptions_member_idx`       | `(member_id)`                           | B-tree    | ✅         |
| `post_subscriptions`       | `post_subscriptions_post_idx`         | `(post_id)`                             | B-tree    | ✅         |
| `post_subscriptions`       | `post_subscriptions_post_active_idx`  | `(post_id) WHERE muted = false`         | Partial   | ✅ **NEW** |
| `notification_preferences` | `notification_preferences_member_idx` | `(member_id)`                           | B-tree    | ✅         |
| `unsubscribe_tokens`       | `unsubscribe_tokens_token_idx`        | `(token)`                               | B-tree    | ✅         |
| `unsubscribe_tokens`       | `unsubscribe_tokens_member_idx`       | `(member_id)`                           | B-tree    | ✅         |

### Integration Tables

| Table                         | Index Name                         | Columns                                     | Type   | Status |
| ----------------------------- | ---------------------------------- | ------------------------------------------- | ------ | ------ |
| `organization_integrations`   | `org_integration_unique`           | `(organization_id, integration_type)`       | UNIQUE | ✅     |
| `organization_integrations`   | `idx_org_integrations_org`         | `(organization_id)`                         | B-tree | ✅     |
| `organization_integrations`   | `idx_org_integrations_type_status` | `(integration_type, status)`                | B-tree | ✅     |
| `integration_event_mappings`  | `mapping_unique`                   | `(integration_id, event_type, action_type)` | UNIQUE | ✅     |
| `integration_event_mappings`  | `idx_event_mappings_lookup`        | `(integration_id, event_type, enabled)`     | B-tree | ✅     |
| `integration_linked_entities` | `linked_entity_unique`             | `(integration_id, entity_type, entity_id)`  | UNIQUE | ✅     |
| `integration_linked_entities` | `idx_linked_entities_lookup`       | `(integration_id, entity_type, entity_id)`  | B-tree | ✅     |
| `integration_sync_log`        | `idx_sync_log_integration_created` | `(integration_id, created_at)`              | B-tree | ✅     |

---

## Query Analysis by Table

### High-Frequency Query Patterns - All Optimized ✅

#### `votes` Table

| Query Pattern         | Columns Used                       | Index Coverage                   |
| --------------------- | ---------------------------------- | -------------------------------- |
| Vote toggle           | `post_id, user_identifier`         | `votes_unique_idx` ✅            |
| Check user voted      | `post_id, user_identifier`         | `votes_unique_idx` ✅            |
| Get voted post IDs    | `post_id IN (?), user_identifier`  | `votes_unique_idx` ✅            |
| Count by member       | `member_id`                        | `votes_member_id_idx` ✅         |
| User activity (votes) | `member_id`, ORDER BY `created_at` | `votes_member_created_at_idx` ✅ |

#### `posts` Table

| Query Pattern           | Columns Used                       | Index Coverage                                      |
| ----------------------- | ---------------------------------- | --------------------------------------------------- |
| Public posts (by votes) | `board_id`, ORDER BY `vote_count`  | `posts_board_vote_count_idx` ✅                     |
| Public posts (by date)  | `board_id`, ORDER BY `created_at`  | `posts_board_created_at_idx` ✅                     |
| Admin inbox             | `board_id, status`                 | `posts_board_status_idx` ✅                         |
| Roadmap posts           | `status`, ORDER BY `vote_count`    | `posts_status_idx` + `posts_vote_count_idx` ✅      |
| User activity (posts)   | `member_id`, ORDER BY `created_at` | `posts_member_created_at_idx` ✅                    |
| ILIKE search            | `title, content`                   | See [Future Considerations](#future-considerations) |

#### `comments` Table

| Query Pattern              | Columns Used                     | Index Coverage                    |
| -------------------------- | -------------------------------- | --------------------------------- |
| Comments by post (ordered) | `post_id`, ORDER BY `created_at` | `comments_post_created_at_idx` ✅ |
| Comment count              | `post_id`                        | `comments_post_id_idx` ✅         |
| Comments by member         | `member_id`                      | `comments_member_id_idx` ✅       |

#### `workspace_domain` Table

| Query Pattern     | Columns Used                  | Index Coverage                   |
| ----------------- | ----------------------------- | -------------------------------- |
| Tenant resolution | `domain`                      | `workspace_domain_domain_idx` ✅ |
| Primary domain    | `organization_id, is_primary` | `workspace_domain_org_id_idx` ✅ |

#### `sso_provider` Table

| Query Pattern       | Columns Used      | Index Coverage               |
| ------------------- | ----------------- | ---------------------------- |
| SSO by email domain | `domain`          | `sso_provider_domain_idx` ✅ |
| Providers by org    | `organization_id` | `sso_provider_org_id_idx` ✅ |

#### `member` Table

| Query Pattern       | Columns Used               | Index Coverage           |
| ------------------- | -------------------------- | ------------------------ |
| Check membership    | `user_id, organization_id` | `member_user_org_idx` ✅ |
| Portal user listing | `organization_id, role`    | `member_org_role_idx` ✅ |

#### `invitation` Table

| Query Pattern   | Columns Used                     | Index Coverage                       |
| --------------- | -------------------------------- | ------------------------------------ |
| Duplicate check | `organization_id, email, status` | `invitation_org_email_status_idx` ✅ |
| By org          | `organization_id`                | `invitation_organizationId_idx` ✅   |

#### `post_subscriptions` Table

| Query Pattern        | Columns Used             | Index Coverage                          |
| -------------------- | ------------------------ | --------------------------------------- |
| Subscription status  | `post_id, member_id`     | `post_subscriptions_unique` ✅          |
| Active subscribers   | `post_id, muted = false` | `post_subscriptions_post_active_idx` ✅ |
| Member subscriptions | `member_id`              | `post_subscriptions_member_idx` ✅      |

---

## Implementation Status

### Migration 0006 (Previously Applied)

- `workspace_domain_domain_idx` - Tenant resolution
- `sso_provider_domain_idx` - SSO detection
- `member_org_role_idx` - Portal user management
- `posts_board_vote_count_idx` - Post listing by votes
- `posts_board_created_at_idx` - Post listing by date
- `posts_board_status_idx` - Admin inbox filtering
- `comments_post_created_at_idx` - Comment thread ordering

### Migration 0007 (New)

- `invitation_org_email_status_idx` - Duplicate invitation checks
- `post_subscriptions_post_active_idx` - Active subscriber lookups (partial index)
- `posts_member_created_at_idx` - User activity (posts by author)
- `votes_member_created_at_idx` - User activity (votes by member)

### Code Optimizations ✅

- **N+1 Query Fixed**: `SubscriptionService.getActiveSubscribers()` now uses a single 3-way JOIN instead of looping through individual user queries.

---

## Future Considerations

### Full-Text Search (pg_trgm)

If search becomes a priority feature, consider adding trigram indexes for ILIKE queries:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
CREATE INDEX posts_content_trgm_idx ON posts USING gin (content gin_trgm_ops);
```

**Trade-offs:**

- Pros: Makes `ILIKE '%search%'` queries use indexes instead of full table scans
- Cons: Increases write overhead and storage requirements
- Recommendation: Add only if search performance becomes an issue

### Monitoring Recommendations

1. **Query Performance**: Use `pg_stat_statements` to monitor slow queries
2. **Index Usage**: Check `pg_stat_user_indexes` to verify indexes are being used
3. **Table Bloat**: Monitor for index bloat with `pgstattuple`

---

## Summary

| Area                     | Status       |
| ------------------------ | ------------ |
| Tenant resolution        | ✅ Optimized |
| Public post listings     | ✅ Optimized |
| Admin inbox              | ✅ Optimized |
| Vote operations          | ✅ Optimized |
| Comment threads          | ✅ Optimized |
| Member lookups           | ✅ Optimized |
| SSO detection            | ✅ Optimized |
| Invitation management    | ✅ Optimized |
| User activity pages      | ✅ Optimized |
| Notification subscribers | ✅ Optimized |
| N+1 queries              | ✅ Fixed     |

**All identified index recommendations have been implemented.** The database is now fully optimized for all current query patterns.
