# Quackback Data Import System

Import data from third-party feedback platforms (UserVoice, Canny, Featurebase, etc.) into Quackback.

## Architecture

The import system uses an intermediate format approach for maximum flexibility:

```
Source Export (UserVoice, Canny, etc.)
         │
         ▼
    ┌─────────────┐
    │   Adapter   │  ← Source-specific: parses native format
    └─────────────┘
         │
         ▼
    ┌─────────────┐
    │ Intermediate│  ← Standardized format
    │   Format    │     (posts, comments, votes, notes)
    └─────────────┘
         │
         ▼
    ┌─────────────┐
    │  Importer   │  ← Generic: writes to database
    └─────────────┘
         │
         ▼
      Quackback DB
```

## Quick Start

```bash
# Import from UserVoice
bun run import uservoice \
  --suggestions ~/Downloads/full-export.csv \
  --comments ~/Downloads/comments.csv \
  --board features

# Import from intermediate format
bun run import intermediate \
  --posts data/posts.csv \
  --comments data/comments.csv \
  --board features
```

## Prerequisites

1. **Database**: Ensure `DATABASE_URL` is set in your `.env` file
2. **Target Board**: The board must exist before importing (use the admin UI to create it)
3. **Source Files**: Export files from your source platform

## CLI Reference

### Commands

| Command        | Description                         |
| -------------- | ----------------------------------- |
| `intermediate` | Import from intermediate CSV format |
| `uservoice`    | Import from UserVoice export files  |
| `help`         | Show help message                   |

### Common Options

| Option             | Description                       | Default |
| ------------------ | --------------------------------- | ------- |
| `--board <slug>`   | Target board slug (required)      | -       |
| `--dry-run`        | Validate only, don't insert data  | false   |
| `--verbose`        | Show detailed progress            | false   |
| `--create-tags`    | Auto-create missing tags          | true    |
| `--no-create-tags` | Don't create missing tags         | -       |
| `--create-users`   | Create members for unknown emails | false   |
| `--batch-size <n>` | Batch size for inserts            | 100     |

### Intermediate Format Options

| Option              | Description             |
| ------------------- | ----------------------- |
| `--posts <file>`    | Posts CSV file          |
| `--comments <file>` | Comments CSV file       |
| `--votes <file>`    | Votes CSV file          |
| `--notes <file>`    | Internal notes CSV file |

### UserVoice Options

| Option                 | Description                            |
| ---------------------- | -------------------------------------- |
| `--suggestions <file>` | Full suggestions export CSV (required) |
| `--comments <file>`    | Comments CSV (optional)                |
| `--notes <file>`       | Internal notes CSV (optional)          |

## Intermediate Format

The intermediate format is a set of CSV files with standardized columns. This allows importing from any source by converting to this format first.

### posts.csv

| Column         | Required | Description                              |
| -------------- | -------- | ---------------------------------------- |
| `id`           | ✓        | External ID (for linking comments/votes) |
| `title`        | ✓        | Post title                               |
| `body`         | ✓        | Content (plain text or HTML)             |
| `author_email` |          | Author email address                     |
| `author_name`  |          | Author display name                      |
| `board`        |          | Board slug (ignored, uses --board)       |
| `status`       |          | Status slug (open, planned, etc.)        |
| `moderation`   |          | published/pending/spam/archived          |
| `tags`         |          | Comma-separated tag names                |
| `roadmap`      |          | Roadmap slug                             |
| `vote_count`   |          | Fallback vote count                      |
| `created_at`   |          | ISO 8601 timestamp                       |
| `response`     |          | Official response text                   |
| `response_at`  |          | Response timestamp                       |
| `response_by`  |          | Response author email                    |

### comments.csv

| Column         | Required | Description         |
| -------------- | -------- | ------------------- |
| `post_id`      | ✓        | External post ID    |
| `body`         | ✓        | Comment text        |
| `author_email` |          | Commenter email     |
| `author_name`  |          | Commenter name      |
| `is_staff`     |          | true if team member |
| `created_at`   |          | ISO 8601 timestamp  |

### votes.csv

| Column        | Required | Description         |
| ------------- | -------- | ------------------- |
| `post_id`     | ✓        | External post ID    |
| `voter_email` | ✓        | Voter email address |
| `created_at`  |          | ISO 8601 timestamp  |

### notes.csv

Internal staff notes (not visible to public users).

| Column         | Required | Description        |
| -------------- | -------- | ------------------ |
| `post_id`      | ✓        | External post ID   |
| `body`         | ✓        | Note content       |
| `author_email` |          | Staff email        |
| `author_name`  |          | Staff name         |
| `created_at`   |          | ISO 8601 timestamp |

## UserVoice Import

UserVoice provides a full denormalized export where each row represents an idea + voter relationship. The adapter handles deduplication automatically.

### Export Files

1. **Full Suggestions Export** (required): The denormalized CSV with 115 fields
2. **comments.csv** (optional): Public comments
3. **notes.csv** (optional): Internal staff notes

### Status Mapping

| UserVoice Status      | Quackback Status |
| --------------------- | ---------------- |
| active                | open             |
| under review          | under_review     |
| planned               | planned          |
| started / in progress | in_progress      |
| completed / shipped   | complete         |
| declined / closed     | closed           |

### Example

```bash
# Full import with all data
bun run import uservoice \
  --suggestions ~/Downloads/uservoice-full-export.csv \
  --comments ~/Downloads/comments.csv \
  --notes ~/Downloads/notes.csv \
  --board features \
  --verbose

# Dry run to validate first
bun run import uservoice \
  --suggestions ~/Downloads/uservoice-full-export.csv \
  --board features \
  --dry-run --verbose
```

## Adding New Adapters

To support a new source platform:

1. Create a new adapter directory: `scripts/import/adapters/canny/`
2. Implement the conversion to intermediate format
3. Export a `convert<Platform>()` function
4. Add a new command to `cli.ts`

### Adapter Structure

```
adapters/
└── newplatform/
    ├── index.ts        # Exports
    ├── adapter.ts      # Main conversion logic
    ├── field-map.ts    # Field mappings
    └── README.md       # Platform-specific docs
```

### Conversion Function

```typescript
import type { IntermediateData } from '../../schema/types'

interface NewPlatformOptions {
  exportFile: string
  verbose?: boolean
}

export function convertNewPlatform(options: NewPlatformOptions): {
  data: IntermediateData
  stats: {
    /* conversion stats */
  }
} {
  // 1. Parse the platform's export files
  // 2. Convert to intermediate format
  // 3. Return data and stats
}
```

## Troubleshooting

### "Board not found"

The target board must exist before importing. Create it in the admin UI first.

### "DATABASE_URL is required"

Ensure your `.env` file contains a valid `DATABASE_URL`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/quackback
```

### Vote counts don't match

Vote counts are reconciled after import based on actual vote records. If you have more votes in the original system than voter emails in the export, the count will differ.

### Missing tags

By default, missing tags are auto-created. Use `--no-create-tags` to skip unknown tags instead.

### Import is slow

Try adjusting `--batch-size`. Larger batches are faster but use more memory:

```bash
bun run import intermediate --posts posts.csv --board features --batch-size 500
```

## Data Safety

- Always run with `--dry-run` first to validate data
- The import is additive - it won't delete existing posts
- Duplicate votes (same user + post) are skipped automatically
- Posts are created with their original timestamps when provided
