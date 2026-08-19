# Quackback Data Import

Import posts, comments, votes, and notes from CSV files into Quackback via the REST API.

## Architecture

All imports go through the Quackback REST API — no direct database access needed.

```
Generic CSV files (posts, comments, votes, notes)
         │
         ▼
┌──────────────────┐
│ Intermediate     │  ← Standardized in-memory format
│ Format (zod)     │
└──────────────────┘
         │
         ▼
┌──────────────────┐
│ API Importer     │  ← Generic: pushes to Quackback REST API
└──────────────────┘
         │
         ▼
    Quackback API
```

To migrate from another tool (Canny, UserVoice, ...), export your data there and
map it onto the intermediate CSV columns below. If you only need posts, the
in-app CSV import under **Admin → Settings → Imports & exports** is simpler.

## Quick Start

```bash
bun scripts/import/cli.ts intermediate \
  --posts data/posts.csv \
  --comments data/comments.csv \
  --board features \
  --quackback-url https://feedback.yourapp.com \
  --quackback-key qb_xxx
```

## Prerequisites

1. **Quackback API key**: Create one in **Admin → Settings → API Keys**
2. **Quackback URL**: Your instance URL (e.g., `https://feedback.yourapp.com`)
3. **Boards**: Create target boards in the admin UI before importing

You can set these as environment variables instead of CLI flags:

```bash
export QUACKBACK_URL=https://feedback.yourapp.com
export QUACKBACK_API_KEY=qb_xxx
```

## CLI Reference

### Commands

| Command        | Description                   |
| -------------- | ----------------------------- |
| `intermediate` | Import from generic CSV files |
| `help`         | Show help message             |

### Required Options

| Option            | Description             | Env var             |
| ----------------- | ----------------------- | ------------------- |
| `--quackback-url` | Quackback instance URL  | `QUACKBACK_URL`     |
| `--quackback-key` | Quackback admin API key | `QUACKBACK_API_KEY` |

### Common Options

| Option      | Description                      | Default |
| ----------- | -------------------------------- | ------- |
| `--dry-run` | Validate only, don't insert data | false   |
| `--verbose` | Show detailed progress           | false   |

### Intermediate Format Options

| Option              | Description             |
| ------------------- | ----------------------- |
| `--board <slug>`    | Target board slug       |
| `--posts <file>`    | Posts CSV file          |
| `--comments <file>` | Comments CSV file       |
| `--votes <file>`    | Votes CSV file          |
| `--notes <file>`    | Internal notes CSV file |

## Intermediate CSV Format

Import from any source by converting to these CSV files first.

### posts.csv

| Column         | Required | Description                              |
| -------------- | -------- | ---------------------------------------- |
| `id`           | ✓        | External ID (for linking comments/votes) |
| `title`        | ✓        | Post title                               |
| `body`         | ✓        | Content (plain text or HTML)             |
| `author_email` |          | Author email address                     |
| `author_name`  |          | Author display name                      |
| `board`        |          | Board slug (or use `--board` flag)       |
| `status`       |          | Status slug (open, planned, etc.)        |
| `moderation`   |          | published/pending/spam/archived          |
| `tags`         |          | Comma-separated tag names                |
| `vote_count`   |          | Fallback vote count                      |
| `created_at`   |          | ISO 8601 timestamp                       |

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

| Column         | Required | Description        |
| -------------- | -------- | ------------------ |
| `post_id`      | ✓        | External post ID   |
| `body`         | ✓        | Note content       |
| `author_email` |          | Staff email        |
| `author_name`  |          | Staff name         |
| `created_at`   |          | ISO 8601 timestamp |

## Troubleshooting

### "Board not found" / posts skipped

The target board must exist before importing. Create boards in the admin UI first, then ensure the board names or slugs in your source data match.

### Vote counts don't match source

Votes are imported as individual proxy votes per user email. If the source has more votes than voter emails in the export, the count will differ.

### Dry run first

Always validate before importing:

```bash
bun scripts/import/cli.ts intermediate --posts data/posts.csv \
  --quackback-url URL --quackback-key KEY \
  --dry-run --verbose
```

## Data Safety

- Always run with `--dry-run` first to validate
- Imports are additive — existing posts are not deleted
- Duplicate votes (same user + post) are skipped
- Posts keep their original timestamps when provided
- The API importer retries on rate limits and server errors with exponential backoff
