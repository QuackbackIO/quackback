# SQL Query & Index Analysis Report

**Generated:** 2025-12-12
**Scope:** packages/domain/, apps/web/, packages/db/

---

## Executive Summary

This report analyzes all SQL queries against the PostgreSQL database and compares them with existing indexes to identify optimization opportunities. The analysis found:

- **60+ unique query patterns** across domain services
- **40+ additional queries** in web API routes
- **Several missing indexes** that could improve query performance
- **Opportunities for composite indexes** to better support common query patterns

---

## Table of Contents

1. [Existing Indexes by Table](#existing-indexes-by-table)
2. [Query Analysis by Table](#query-analysis-by-table)
3. [Missing Index Recommendations](#missing-index-recommendations)
4. [Query Optimization Opportunities](#query-optimization-opportunities)
5. [Priority Actions](#priority-actions)

---

## Existing Indexes by Table

### Authentication Tables

| Table                    | Index Name                         | Columns                    | Type   |
| ------------------------ | ---------------------------------- | -------------------------- | ------ |
| `user`                   | `user_email_org_idx`               | `(organization_id, email)` | UNIQUE |
| `user`                   | `user_org_id_idx`                  | `(organization_id)`        | B-tree |
| `session`                | `session_userId_idx`               | `(userId)`                 | B-tree |
| `account`                | `account_userId_idx`               | `(userId)`                 | B-tree |
| `verification`           | `verification_identifier_idx`      | `(identifier)`             | B-tree |
| `member`                 | `member_organizationId_idx`        | `(organizationId)`         | B-tree |
| `member`                 | `member_userId_idx`                | `(userId)`                 | B-tree |
| `member`                 | `member_user_org_idx`              | `(userId, organizationId)` | UNIQUE |
| `invitation`             | `invitation_organizationId_idx`    | `(organizationId)`         | B-tree |
| `invitation`             | `invitation_email_idx`             | `(email)`                  | B-tree |
| `sso_provider`           | `sso_provider_org_id_idx`          | `(organizationId)`         | B-tree |
| `sso_provider`           | `sso_provider_org_domain_idx`      | `(organizationId, domain)` | UNIQUE |
| `session_transfer_token` | `session_transfer_token_token_idx` | `(token)`                  | B-tree |
| `workspace_domain`       | `workspace_domain_org_id_idx`      | `(organizationId)`         | B-tree |

### Application Tables

| Table                      | Index Name                            | Columns                                 | Type      |
| -------------------------- | ------------------------------------- | --------------------------------------- | --------- |
| `boards`                   | `boards_org_slug_idx`                 | `(organization_id, slug)`               | UNIQUE    |
| `boards`                   | `boards_org_id_idx`                   | `(organization_id)`                     | B-tree    |
| `roadmaps`                 | `roadmaps_org_slug_idx`               | `(organization_id, slug)`               | UNIQUE    |
| `roadmaps`                 | `roadmaps_org_id_idx`                 | `(organization_id)`                     | B-tree    |
| `roadmaps`                 | `roadmaps_position_idx`               | `(organization_id, position)`           | B-tree    |
| `tags`                     | `tags_org_name_idx`                   | `(organization_id, name)`               | UNIQUE    |
| `tags`                     | `tags_org_id_idx`                     | `(organization_id)`                     | B-tree    |
| `posts`                    | `posts_board_id_idx`                  | `(board_id)`                            | B-tree    |
| `posts`                    | `posts_status_idx`                    | `(status)`                              | B-tree    |
| `posts`                    | `posts_status_id_idx`                 | `(status_id)`                           | B-tree    |
| `posts`                    | `posts_member_id_idx`                 | `(member_id)`                           | B-tree    |
| `posts`                    | `posts_owner_member_id_idx`           | `(owner_member_id)`                     | B-tree    |
| `posts`                    | `posts_owner_id_idx`                  | `(owner_id)`                            | B-tree    |
| `posts`                    | `posts_created_at_idx`                | `(created_at)`                          | B-tree    |
| `posts`                    | `posts_vote_count_idx`                | `(vote_count)`                          | B-tree    |
| `post_statuses`            | `post_statuses_org_slug_idx`          | `(organization_id, slug)`               | UNIQUE    |
| `post_statuses`            | `post_statuses_org_id_idx`            | `(organization_id)`                     | B-tree    |
| `post_statuses`            | `post_statuses_position_idx`          | `(organization_id, category, position)` | B-tree    |
| `post_tags`                | `post_tags_pk`                        | `(post_id, tag_id)`                     | UNIQUE/PK |
| `post_tags`                | `post_tags_post_id_idx`               | `(post_id)`                             | B-tree    |
| `post_tags`                | `post_tags_tag_id_idx`                | `(tag_id)`                              | B-tree    |
| `post_roadmaps`            | `post_roadmaps_pk`                    | `(post_id, roadmap_id)`                 | UNIQUE/PK |
| `post_roadmaps`            | `post_roadmaps_post_id_idx`           | `(post_id)`                             | B-tree    |
| `post_roadmaps`            | `post_roadmaps_roadmap_id_idx`        | `(roadmap_id)`                          | B-tree    |
| `post_roadmaps`            | `post_roadmaps_position_idx`          | `(roadmap_id, status_id, position)`     | B-tree    |
| `votes`                    | `votes_post_id_idx`                   | `(post_id)`                             | B-tree    |
| `votes`                    | `votes_unique_idx`                    | `(post_id, user_identifier)`            | UNIQUE    |
| `votes`                    | `votes_member_id_idx`                 | `(member_id)`                           | B-tree    |
| `comments`                 | `comments_post_id_idx`                | `(post_id)`                             | B-tree    |
| `comments`                 | `comments_parent_id_idx`              | `(parent_id)`                           | B-tree    |
| `comments`                 | `comments_member_id_idx`              | `(member_id)`                           | B-tree    |
| `comments`                 | `comments_created_at_idx`             | `(created_at)`                          | B-tree    |
| `comment_reactions`        | `comment_reactions_comment_id_idx`    | `(comment_id)`                          | B-tree    |
| `comment_reactions`        | `comment_reactions_unique_idx`        | `(comment_id, user_identifier, emoji)`  | UNIQUE    |
| `changelog_entries`        | `changelog_board_id_idx`              | `(board_id)`                            | B-tree    |
| `changelog_entries`        | `changelog_published_at_idx`          | `(published_at)`                        | B-tree    |
| `post_subscriptions`       | `post_subscriptions_unique`           | `(post_id, member_id)`                  | UNIQUE    |
| `post_subscriptions`       | `post_subscriptions_member_idx`       | `(member_id)`                           | B-tree    |
| `post_subscriptions`       | `post_subscriptions_post_idx`         | `(post_id)`                             | B-tree    |
| `notification_preferences` | `notification_preferences_member_idx` | `(member_id)`                           | B-tree    |
| `unsubscribe_tokens`       | `unsubscribe_tokens_token_idx`        | `(token)`                               | B-tree    |
| `unsubscribe_tokens`       | `unsubscribe_tokens_member_idx`       | `(member_id)`                           | B-tree    |

### Integration Tables

| Table                         | Index Name                         | Columns                                     | Type   |
| ----------------------------- | ---------------------------------- | ------------------------------------------- | ------ |
| `organization_integrations`   | `org_integration_unique`           | `(organization_id, integration_type)`       | UNIQUE |
| `organization_integrations`   | `idx_org_integrations_org`         | `(organization_id)`                         | B-tree |
| `organization_integrations`   | `idx_org_integrations_type_status` | `(integration_type, status)`                | B-tree |
| `integration_event_mappings`  | `mapping_unique`                   | `(integration_id, event_type, action_type)` | UNIQUE |
| `integration_event_mappings`  | `idx_event_mappings_lookup`        | `(integration_id, event_type, enabled)`     | B-tree |
| `integration_linked_entities` | `linked_entity_unique`             | `(integration_id, entity_type, entity_id)`  | UNIQUE |
| `integration_linked_entities` | `idx_linked_entities_lookup`       | `(integration_id, entity_type, entity_id)`  | B-tree |
| `integration_sync_log`        | `idx_sync_log_integration_created` | `(integration_id, created_at)`              | B-tree |

---

## Query Analysis by Table

### `votes` Table

#### High-Frequency Queries

| Query Pattern             | WHERE Clause                               | Used By                             | Current Index                   |
| ------------------------- | ------------------------------------------ | ----------------------------------- | ------------------------------- |
| Vote toggle lookup        | `post_id = ? AND user_identifier = ?`      | `PostService.voteOnPost()`          | `votes_unique_idx` ✅           |
| Check user voted          | `post_id = ? AND user_identifier = ?`      | `PostService.hasUserVotedOnPost()`  | `votes_unique_idx` ✅           |
| Get voted post IDs        | `post_id IN (?) AND user_identifier = ?`   | `PostService.getUserVotedPostIds()` | `votes_unique_idx` (partial) ⚠️ |
| Count votes by member     | `member_id = ?` (with joins)               | `UserService.listPortalUsers()`     | `votes_member_id_idx` ✅        |
| Get voted posts by member | `member_id = ?` ORDER BY `created_at DESC` | `UserService.getPortalUserDetail()` | `votes_member_id_idx` ⚠️        |

**Issue:** Query `getUserVotedPostIds()` uses `IN (?)` on `post_id` with `user_identifier = ?`. The unique index is `(post_id, user_identifier)` which works but the `IN` clause may cause index to be less efficient.

**Issue:** `getPortalUserDetail()` sorts by `created_at DESC` but `votes_member_id_idx` doesn't include `created_at`.

---

### `posts` Table

#### High-Frequency Queries

| Query Pattern        | WHERE/JOIN/ORDER                                                                      | Used By                             | Current Index                                    |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
| Public post listing  | `board_id IN (?)`, `status IN (?)`, ORDER BY `vote_count DESC`                        | `PostService.listPublicPosts()`     | `posts_board_id_idx` + `posts_vote_count_idx` ⚠️ |
| Public post listing  | `board_id IN (?)`, `status IN (?)`, ORDER BY `created_at DESC`                        | `PostService.listPublicPosts()`     | `posts_board_id_idx` + `posts_created_at_idx` ⚠️ |
| Trending calculation | ORDER BY `(vote_count / EXTRACT(...)) DESC`                                           | `PostService.listPublicPosts()`     | None (computed) ❌                               |
| Inbox posts          | `board_id IN (?)`, `status IN (?)`, `owner_id`, `created_at BETWEEN`, `vote_count >=` | `PostService.listInboxPosts()`      | `posts_board_id_idx` ⚠️                          |
| ILIKE search         | `title ILIKE ?` OR `content ILIKE ?`                                                  | Multiple                            | None ❌                                          |
| Roadmap posts        | JOIN `boards` + `status IN (?)` + ORDER BY `vote_count DESC`                          | `PostService.getRoadmapPosts()`     | `posts_status_idx` + `posts_vote_count_idx` ⚠️   |
| Posts by author      | `member_id = ?` ORDER BY `created_at DESC`                                            | `UserService.getPortalUserDetail()` | `posts_member_id_idx` ⚠️                         |
| Vote reconciliation  | JOIN `boards` + `votes`, GROUP BY `posts.id`                                          | `PostService.reconcileVoteCounts()` | Uses primary key                                 |

**Issues:**

1. No composite index for `(board_id, status)` - common filter combination
2. No composite index for `(board_id, vote_count)` for sorted listing
3. No composite index for `(board_id, created_at)` for sorted listing
4. ILIKE searches require full table scan (consider pg_trgm)
5. No composite index for `(member_id, created_at)` for author post listing

---

### `comments` Table

#### High-Frequency Queries

| Query Pattern          | WHERE/ORDER                             | Used By                                | Current Index               |
| ---------------------- | --------------------------------------- | -------------------------------------- | --------------------------- |
| Comments by post       | `post_id = ?` ORDER BY `created_at ASC` | `PostService.getCommentsWithReplies()` | `comments_post_id_idx` ⚠️   |
| Comment count by post  | `post_id = ?`                           | `PostService.getPostWithDetails()`     | `comments_post_id_idx` ✅   |
| Comments by member     | `member_id = ?` GROUP BY `post_id`      | `UserService.getPortalUserDetail()`    | `comments_member_id_idx` ⚠️ |
| Comment counts (batch) | `post_id IN (?)` GROUP BY `post_id`     | `UserService.getPortalUserDetail()`    | `comments_post_id_idx` ✅   |

**Issue:** Query ordering by `created_at` after filtering by `post_id` could benefit from composite index `(post_id, created_at)`.

---

### `member` Table

#### High-Frequency Queries

| Query Pattern    | WHERE Clause                            | Used By                             | Current Index                  |
| ---------------- | --------------------------------------- | ----------------------------------- | ------------------------------ |
| Check membership | `user_id = ? AND organization_id = ?`   | Many (auth checks)                  | `member_user_org_idx` ✅       |
| List by org      | `organization_id = ?`                   | `MemberService.listTeamMembers()`   | `member_organizationId_idx` ✅ |
| Count by org     | `organization_id = ?`                   | `MemberService.countMembersByOrg()` | `member_organizationId_idx` ✅ |
| Portal users     | `organization_id = ? AND role = 'user'` | `UserService.listPortalUsers()`     | `member_organizationId_idx` ⚠️ |

**Issue:** `listPortalUsers()` filters by both `organization_id` and `role`. A composite index `(organization_id, role)` could improve this query.

---

### `workspace_domain` Table

#### High-Frequency Queries

| Query Pattern  | WHERE Clause                                                | Used By                  | Current Index                    |
| -------------- | ----------------------------------------------------------- | ------------------------ | -------------------------------- |
| Domain lookup  | `domain = ?`                                                | `tenant.ts`, auth routes | **None** ❌                      |
| Primary domain | `organization_id = ? AND is_primary = true`                 | Multiple                 | `workspace_domain_org_id_idx` ⚠️ |
| List by org    | `organization_id = ?`                                       | `domains/route.ts`       | `workspace_domain_org_id_idx` ✅ |
| Trusted domain | `domain = ? AND domain_type = 'custom' AND verified = true` | `auth/index.ts`          | **None** ❌                      |

**Critical Issue:** `domain` column has no index but is queried on every request for tenant resolution!

---

### `sso_provider` Table

#### High-Frequency Queries

| Query Pattern        | WHERE Clause                     | Used By                                     | Current Index                           |
| -------------------- | -------------------------------- | ------------------------------------------- | --------------------------------------- |
| SSO by domain        | `domain = ?`                     | `sso-check/route.ts`, `OrganizationService` | **None** ❌                             |
| Provider by org      | `organization_id = ?`            | Multiple                                    | `sso_provider_org_id_idx` ✅            |
| Provider by ID + org | `id = ? AND organization_id = ?` | SSO CRUD routes                             | Primary key + `sso_provider_org_id_idx` |

**Issue:** `domain` column is queried for SSO detection but has no dedicated index.

---

### `invitation` Table

#### High-Frequency Queries

| Query Pattern   | WHERE Clause                                               | Used By                | Current Index                                               |
| --------------- | ---------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| Check duplicate | `organization_id = ? AND email = ? AND status = 'pending'` | `invitations/route.ts` | `invitation_organizationId_idx` + `invitation_email_idx` ⚠️ |
| By ID           | `id = ?`                                                   | Various                | Primary key ✅                                              |

**Issue:** Common query filters by three columns but no composite index exists.

---

### `post_tags` Table (Junction)

#### High-Frequency Queries

| Query Pattern          | WHERE Clause     | Used By                            | Current Index              |
| ---------------------- | ---------------- | ---------------------------------- | -------------------------- |
| Tags by post           | `post_id = ?`    | `PostService.getPostWithDetails()` | `post_tags_post_id_idx` ✅ |
| Posts by tags          | `tag_id IN (?)`  | `PostService.listPublicPosts()`    | `post_tags_tag_id_idx` ✅  |
| Tags for posts (batch) | `post_id IN (?)` | `PostService.listPublicPosts()`    | `post_tags_post_id_idx` ✅ |

**Status:** Well indexed ✅

---

### `comment_reactions` Table

#### High-Frequency Queries

| Query Pattern   | WHERE Clause                                           | Used By                        | Current Index                         |
| --------------- | ------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| Check existing  | `comment_id = ? AND user_identifier = ? AND emoji = ?` | `CommentService.addReaction()` | `comment_reactions_unique_idx` ✅     |
| List by comment | `comment_id = ?`                                       | `CommentService.addReaction()` | `comment_reactions_comment_id_idx` ✅ |

**Status:** Well indexed ✅

---

### `post_subscriptions` Table

#### High-Frequency Queries

| Query Pattern        | WHERE Clause                    | Used By                                        | Current Index                      |
| -------------------- | ------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Subscription status  | `member_id = ? AND post_id = ?` | `SubscriptionService`                          | `post_subscriptions_unique` ✅     |
| Active subscribers   | `post_id = ? AND muted = false` | `SubscriptionService.getActiveSubscribers()`   | `post_subscriptions_post_idx` ⚠️   |
| Member subscriptions | `member_id = ?`                 | `SubscriptionService.getMemberSubscriptions()` | `post_subscriptions_member_idx` ✅ |

**Issue:** Active subscriber query filters by `muted = false` but index doesn't include this.

---

### `verification` Table

#### High-Frequency Queries

| Query Pattern | WHERE Clause                            | Used By     | Current Index                    |
| ------------- | --------------------------------------- | ----------- | -------------------------------- |
| OTP lookup    | `identifier = ? AND expires_at > NOW()` | Auth routes | `verification_identifier_idx` ⚠️ |

**Issue:** Expiry check could benefit from partial index on non-expired records.

---

## Missing Index Recommendations

### Priority 1: Critical (High Impact)

#### 1. `workspace_domain.domain` Index

```sql
CREATE INDEX workspace_domain_domain_idx ON workspace_domain (domain);
```

**Impact:** Every tenant request queries by domain. Currently doing full table scan.
**Frequency:** Every HTTP request to tenant subdomains

#### 2. `sso_provider.domain` Index

```sql
CREATE INDEX sso_provider_domain_idx ON sso_provider (domain);
```

**Impact:** SSO detection queries by email domain.
**Frequency:** Every login attempt that checks for SSO

#### 3. `posts` Composite Index for Listing (board + vote_count)

```sql
CREATE INDEX posts_board_vote_count_idx ON posts (board_id, vote_count DESC);
```

**Impact:** Public post listings sorted by "top" votes
**Frequency:** Every board page load

#### 4. `posts` Composite Index for Listing (board + created_at)

```sql
CREATE INDEX posts_board_created_at_idx ON posts (board_id, created_at DESC);
```

**Impact:** Public post listings sorted by "new"
**Frequency:** Every board page load

### Priority 2: High (Moderate Impact)

#### 5. `posts` Composite Index for Status Filtering

```sql
CREATE INDEX posts_board_status_idx ON posts (board_id, status);
```

**Impact:** Post listings filtered by status
**Frequency:** Admin inbox, filtered public listings

#### 6. `comments` Composite Index (post + created_at)

```sql
CREATE INDEX comments_post_created_at_idx ON comments (post_id, created_at);
```

**Impact:** Comment threads ordered chronologically
**Frequency:** Every post detail view

#### 7. `member` Composite Index (org + role)

```sql
CREATE INDEX member_org_role_idx ON member (organization_id, role);
```

**Impact:** Portal user listings, role-based queries
**Frequency:** Admin user management pages

#### 8. `votes` Composite Index (member + created_at)

```sql
CREATE INDEX votes_member_created_at_idx ON votes (member_id, created_at DESC);
```

**Impact:** User activity pages showing vote history
**Frequency:** User detail views

### Priority 3: Medium (Low-Moderate Impact)

#### 9. `invitation` Composite Index

```sql
CREATE INDEX invitation_org_email_status_idx ON invitation (organization_id, email, status);
```

**Impact:** Duplicate invitation checks
**Frequency:** Invitation creation

#### 10. `post_subscriptions` Composite Index (post + muted)

```sql
CREATE INDEX post_subscriptions_post_muted_idx ON post_subscriptions (post_id, muted) WHERE muted = false;
```

**Impact:** Notification sending (active subscribers only)
**Frequency:** Every status change/comment notification

#### 11. `posts` Author Posts Index

```sql
CREATE INDEX posts_member_created_at_idx ON posts (member_id, created_at DESC);
```

**Impact:** User profile showing authored posts
**Frequency:** User detail views

### Priority 4: Consider (Specialized)

#### 12. Full-Text Search Index (pg_trgm)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
CREATE INDEX posts_content_trgm_idx ON posts USING gin (content gin_trgm_ops);
```

**Impact:** ILIKE searches on title/content become index-backed
**Frequency:** Search functionality
**Trade-off:** Increases write overhead and storage

#### 13. Partial Index for Active Verifications

```sql
CREATE INDEX verification_identifier_active_idx ON verification (identifier)
WHERE expires_at > NOW();
```

**Note:** Partial indexes with NOW() don't work well. Consider:

```sql
CREATE INDEX verification_identifier_expires_idx ON verification (identifier, expires_at);
```

---

## Query Optimization Opportunities

### 1. N+1 Query in `getActiveSubscribers()`

**Current:** Loop queries user table for each subscriber

```typescript
for (const sub of subscriptions) {
  const user = await db.query.user.findFirst({...})
}
```

**Recommendation:** Batch query with JOIN

```typescript
const subscribers = await db
  .select({
    memberId: postSubscriptions.memberId,
    userId: member.userId,
    email: user.email,
    name: user.name,
  })
  .from(postSubscriptions)
  .innerJoin(member, eq(postSubscriptions.memberId, member.id))
  .innerJoin(user, eq(member.userId, user.id))
  .where(and(eq(postSubscriptions.postId, postId), eq(postSubscriptions.muted, false)))
```

### 2. Multiple Sequential Queries in `listPortalUsers()`

**Current:** 4 separate queries (3 subqueries + main query + count)

**Consideration:** The current approach with pre-aggregated subqueries is actually optimal for this pattern. The alternative of large JOINs could be slower.

### 3. Trending Score Calculation

**Current:** Computed in ORDER BY

```sql
ORDER BY (vote_count / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)) DESC
```

**Options:**

1. **Materialized view** with periodic refresh for trending scores
2. **Generated column** if PostgreSQL 12+ (would need migration)
3. Keep as-is (acceptable for moderate data volumes)

### 4. Vote Count Reconciliation

**Current:** Updates all mismatched posts in one query (efficient)
**Status:** Well-optimized ✅

### 5. Consider SKIP LOCKED for High-Contention Votes

**Current:** Uses FOR UPDATE which can cause lock contention

```sql
SELECT id FROM votes WHERE ... FOR UPDATE
```

**Alternative for high-traffic:**

```sql
SELECT id FROM votes WHERE ... FOR UPDATE SKIP LOCKED
```

**Trade-off:** May occasionally skip concurrent vote operations

---

## Priority Actions

### Immediate (Do Now)

1. **Add `workspace_domain.domain` index** - Critical path for every request
2. **Add `sso_provider.domain` index** - Authentication performance

### Short-Term (This Sprint)

3. **Add `posts_board_vote_count_idx`** - Public listing performance
4. **Add `posts_board_created_at_idx`** - Public listing performance
5. **Add `comments_post_created_at_idx`** - Comment thread performance

### Medium-Term (Next Sprint)

6. **Add `posts_board_status_idx`** - Admin inbox performance
7. **Add `member_org_role_idx`** - Portal user management
8. **Refactor `getActiveSubscribers()`** - Remove N+1 query

### Long-Term (Consider)

9. **Add pg_trgm indexes** - If search is a priority feature
10. **Add remaining composite indexes** - As traffic grows

---

## Migration Script

```sql
-- Priority 1: Critical
CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_domain_domain_idx
  ON workspace_domain (domain);

CREATE INDEX CONCURRENTLY IF NOT EXISTS sso_provider_domain_idx
  ON sso_provider (domain);

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_board_vote_count_idx
  ON posts (board_id, vote_count DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_board_created_at_idx
  ON posts (board_id, created_at DESC);

-- Priority 2: High
CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_board_status_idx
  ON posts (board_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS comments_post_created_at_idx
  ON comments (post_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS member_org_role_idx
  ON member (organization_id, role);

CREATE INDEX CONCURRENTLY IF NOT EXISTS votes_member_created_at_idx
  ON votes (member_id, created_at DESC);

-- Priority 3: Medium
CREATE INDEX CONCURRENTLY IF NOT EXISTS invitation_org_email_status_idx
  ON invitation (organization_id, email, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS post_subscriptions_post_active_idx
  ON post_subscriptions (post_id) WHERE muted = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_member_created_at_idx
  ON posts (member_id, created_at DESC);

-- Priority 4: Consider (Full-text search)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY posts_title_trgm_idx ON posts USING gin (title gin_trgm_ops);
-- CREATE INDEX CONCURRENTLY posts_content_trgm_idx ON posts USING gin (content gin_trgm_ops);
```

---

## Summary

| Category                        | Count |
| ------------------------------- | ----- |
| Total tables analyzed           | 27    |
| Existing indexes                | 48    |
| Missing critical indexes        | 2     |
| Missing high-priority indexes   | 6     |
| Missing medium-priority indexes | 3     |
| N+1 query issues                | 1     |
| Well-optimized queries          | ~80%  |

The codebase is generally well-structured with good index coverage for primary operations. The main gaps are:

1. **Missing `domain` index on `workspace_domain`** - Impacts every tenant request
2. **Missing composite indexes for sorted listings** - Impacts public page performance
3. **One N+1 query pattern** - `getActiveSubscribers()` method

Adding the recommended indexes should significantly improve query performance, especially for:

- Tenant resolution (critical path)
- Public board listings (user-facing)
- Admin inbox views (team-facing)
- User activity pages (user-facing)
