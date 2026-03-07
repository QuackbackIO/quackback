# Plan: Proxy Voting & Automated Vote Suggestions

## Context

GitHub issue #87 requests admin "vote on behalf of user" — capturing demand from sales calls, support chats, and offline conversations where feedback never reaches the board. Currently, if a Slack message (or any external feedback) matches an existing post, the pipeline silently drops it. That's a missed opportunity: we know who said it and what they want, but we don't record their interest.

### What we already have

- **`addVoteOnBehalf(postId, principalId, source?)`** in `post.voting.ts` — insert-only proxy vote with source attribution (`sourceType`, `sourceExternalUrl`). Used by integration apps (Zendesk sidebar). Atomic CTE, idempotent, auto-subscribes.
- **`resolveAuthorPrincipal(author, sourceType)`** in `author-resolver.ts` — resolves email/externalUserId to a principal, creating user+principal on demand. Already handles Slack users without email via `externalUserMappings`.
- **`findSimilarPosts(embedding, opts)`** in `embedding.service.ts` — cosine similarity search against post embeddings. Used during interpretation to decide create vs. skip.
- **`feedbackSuggestions` table** — has `suggestionType` varchar(20), currently only `'create_post'`. Has `resultPostId` for linking to the target post.
- **Votes table** — already has `source_type` and `source_external_url` columns for attribution.

### The gap

In the interpretation service (`interpretation.service.ts` lines 73-96), when `similarPosts.length > 0` (i.e. a similar post already exists), the pipeline does **nothing** — no suggestion, no vote, no record. The feedback author's interest is lost.

## Design

### Every suggestion has both options

The AI picks a **primary action** based on similarity, but the admin always sees both options:

- **Primary: create post** (low similarity) → secondary: "Or vote on similar post X" if any similar posts exist
- **Primary: vote on post** (high similarity) → secondary: "Or create new post instead"

The similarity threshold determines which action is the default — not which is available. The admin makes the final call. This means:

- No feedback silently dropped — similar posts always surface as vote candidates
- No forced binary — admin can override the AI's suggestion in either direction
- The Incoming tab becomes a triage interface where every suggestion has a primary + secondary action

### Data model changes

**`feedbackSuggestions` table** — no schema changes needed:

- `suggestionType` stays `'create_post'` or new `'vote_on_post'` — this is the **primary** suggestion
- `resultPostId` — for `vote_on_post`: the post to vote on. For `create_post`: null (as today)
- `rawFeedbackItemId` — the feedback that triggered this
- `suggestedTitle` / `suggestedBody` — AI-generated post content (used for both types — `vote_on_post` still generates these in case admin chooses "create instead")
- `reasoning` — why we think it matches / should be created

**New: `similarPosts` JSONB column** on `feedbackSuggestions`:

- Stores the top similar post matches found during interpretation
- `Array<{ postId, title, similarity, voteCount }>` (up to 3)
- For `create_post` suggestions: these are the "or vote on X instead" candidates
- For `vote_on_post` suggestions: the primary match is `resultPostId`, extras shown as alternatives
- Avoids re-querying similarity at render time

**`SuggestionType` union** in `feedback/types.ts`:

```typescript
export type SuggestionType = 'create_post' | 'vote_on_post'
```

### Pipeline changes

**`interpretation.service.ts`** — the core change:

```
Current flow:
  similarPosts.length > 0  → do nothing
  similarPosts.length == 0 → create_post suggestion

New flow (always creates a suggestion):
  → run findSimilarPosts (already happens)
  → always generate title/body via LLM (for both paths)
  → store top similar matches in suggestion.similarPosts JSONB
  → if best match >= 0.80: primary = vote_on_post (resultPostId = best match)
  → if best match < 0.80 or no matches: primary = create_post (as today)
```

The interpretation service always creates a suggestion now — the only difference is whether `suggestionType` is `vote_on_post` or `create_post`. Both types store similar post matches and AI-generated title/body, so the admin can flip between actions.

### Accepting a vote_on_post suggestion

**`suggestion.service.ts`** — new `acceptVoteSuggestion()`:

1. Load suggestion + raw item
2. Resolve author to principalId (may already exist from ingestion)
3. Call `addVoteOnBehalf(resultPostId, principalId, { type: sourceType })`
4. Mark suggestion accepted

### Incoming tab UI

**Suggestion triage row** — unified for both types:

For `create_post` (primary):

- Show AI-generated title/body and source snippet (as today)
- Primary action: "Create post" button
- Secondary: if `similarPosts` exists, show "Similar: Post Title (87%)" links — clicking one switches to voting on that post instead

For `vote_on_post` (primary):

- Show the matched post title, similarity %, vote count, and the original feedback snippet
- Show who the vote would be attributed to (resolved author from raw item)
- Primary action: "Vote" button — casts proxy vote on the matched post
- Secondary: "Create new post instead" — opens the create-from-suggestion dialog (title/body already generated)

Both types show "Dismiss" to skip entirely.

### Admin proxy voting (manual)

Beyond the automated pipeline, admins need to manually vote on behalf of users from the UI (the core ask in #87):

**Post detail voter list:**

- "Add vote" button opens a member/email search
- Can select existing user or enter an email to create one on demand
- Calls `addVoteOnBehalf` with source attribution `{ type: 'admin_proxy' }`

**API endpoint:**

- `POST /api/v1/posts/:postId/votes` with `{ email, name? }` body
- Resolves or creates user, calls `addVoteOnBehalf`
- Returns vote result

**MCP tool:**

- `proxy_vote` tool: `{ postId, email, name? }` — for CRM/support tool integrations

## Implementation order

### Phase 1: Pipeline + suggestion infrastructure

1. Add `similarPosts` JSONB column to `feedbackSuggestions` (migration)
2. Add `'vote_on_post'` to `SuggestionType`
3. Update interpretation service: always create a suggestion, store similar matches, pick primary type
4. Update `createPostSuggestion` to accept `similarPosts` and `resultPostId` params
5. Add `acceptVoteSuggestion()` to suggestion service
6. Wire into `acceptSuggestionFn` dispatch in `feedback.ts`
7. Update Incoming tab UI: render both suggestion types with primary/secondary actions

### Phase 2: Admin proxy voting (addresses #87 directly)

6. Add proxy vote UI to post detail voter list
7. Add `POST /api/v1/posts/:postId/votes` endpoint
8. Add `proxy_vote` MCP tool

### Phase 3: Polish

9. Activity log entry for proxy votes ("X voted on behalf of Y via Slack")
10. Notification to the user that their feedback was heard (optional, via email)
11. Voter list UI: show source attribution badge (Slack, Zendesk, admin, etc.)

## Key reuse

| Existing                                    | Used for                                                  |
| ------------------------------------------- | --------------------------------------------------------- |
| `addVoteOnBehalf()`                         | Suggestion accept, manual proxy vote, API                 |
| `resolveAuthorPrincipal()`                  | Create user on demand from email/externalUserId           |
| `findSimilarPosts()`                        | Already runs during interpretation — just use the results |
| `feedbackSuggestions` table                 | New `vote_on_post` type + `similarPosts` JSONB column     |
| `votes.source_type` / `source_external_url` | Attribution already in schema                             |
| `SuggestionTriageRow` component             | Extend with primary/secondary action pattern              |
| `CreateFromSuggestionDialog`                | Reuse for "create new post instead" secondary action      |

## Thresholds

| Best match similarity | Primary suggestion                    | Secondary option                            |
| --------------------- | ------------------------------------- | ------------------------------------------- |
| >= 0.80               | `vote_on_post` (vote on matched post) | "Create new post instead"                   |
| < 0.80 or no matches  | `create_post` (as today)              | "Vote on similar: X" (if any matches exist) |

The 0.80 boundary matches the existing `CREATE_POST_SIMILARITY_THRESHOLD`. All suggestions require admin approval. An automatic mode (auto-accept above a configurable threshold) can be added later as an opt-in setting.

## Future: automatic mode

When enabled, suggestions above a high similarity threshold (e.g. 0.92) would be auto-accepted — immediately casting the proxy vote and marking the suggestion as accepted for audit. This is deferred to keep V1 simple and human-in-the-loop.
