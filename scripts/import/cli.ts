#!/usr/bin/env bun
/**
 * Quackback Data Import CLI
 *
 * Import posts, comments, votes, and notes from CSV files into Quackback via
 * the REST API — no direct database access needed.
 *
 * Usage:
 *   bun scripts/import/cli.ts intermediate --posts posts.csv --quackback-url URL --quackback-key KEY
 *
 * Run with --help for full options.
 */

import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../../.env'), override: false })

import { parseCSV } from './core/csv-parser'
import { runApiImport } from './core/api-importer'
import {
  intermediatePostSchema,
  intermediateCommentSchema,
  intermediateVoteSchema,
  intermediateNoteSchema,
} from './schema/validators'
import type { IntermediateData, IntermediatePost, IntermediateComment } from './schema/types'

// CLI argument parsing
interface CliArgs {
  command: 'intermediate' | 'help'
  // Common options
  board?: string
  dryRun: boolean
  verbose: boolean
  incremental: boolean
  // Intermediate format files
  posts?: string
  comments?: string
  votes?: string
  notes?: string
  // Quackback API options (required)
  quackbackUrl?: string
  quackbackKey?: string
}

function printUsage(): void {
  console.log(`
Quackback Data Import CLI

Imports CSV data via the Quackback REST API — no direct database access
needed. To migrate from another tool (Canny, UserVoice, ...), export your
data there and map it onto the intermediate CSV columns.

Usage:
  bun scripts/import/cli.ts <command> [options]

Commands:
  intermediate    Import from intermediate CSV format
  help            Show this help message

Required Options:
  --quackback-url <url>   Quackback instance URL (or set QUACKBACK_URL env var)
  --quackback-key <key>   Quackback admin API key (or set QUACKBACK_API_KEY env var)

Common Options:
  --dry-run           Validate and show summary, don't insert data
  --verbose           Show detailed progress
  --incremental       Skip rows that already exist on the target instance.
                      Dedup posts by normalised title + createdAt date,
                      comments by normalised content + createdAt minute.
                      Use when topping up an instance that has been imported
                      before — votes and user identify are already idempotent.

Intermediate Format Options:
  --board <slug>        Target board slug
  --posts <file>        Posts CSV file
  --comments <file>     Comments CSV file
  --votes <file>        Votes CSV file
  --notes <file>        Internal notes CSV file

Examples:
  # Import from intermediate CSV format
  bun scripts/import/cli.ts intermediate \\
    --posts data/posts.csv \\
    --comments data/comments.csv \\
    --board features \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx

  # Dry run (validate without importing)
  bun scripts/import/cli.ts intermediate \\
    --posts data/posts.csv \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx \\
    --dry-run --verbose

Environment Variables:
  QUACKBACK_URL         Quackback instance URL (alternative to --quackback-url)
  QUACKBACK_API_KEY     Quackback admin API key (alternative to --quackback-key)
`)
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: 'help',
    dryRun: false,
    verbose: false,
    incremental: false,
  }

  if (args.length === 0) {
    return result
  }

  // First positional arg is command
  const cmd = args[0]
  if (cmd === 'intermediate' || cmd === 'help') {
    result.command = cmd
  } else if (cmd === '--help' || cmd === '-h') {
    result.command = 'help'
    return result
  } else {
    console.error(`Unknown command: ${cmd}`)
    result.command = 'help'
    return result
  }

  // Helper to get next arg value safely
  const getNextArg = (index: number, optionName: string): string => {
    const value = args[index + 1]
    if (!value || value.startsWith('-')) {
      console.error(`Error: ${optionName} requires a value`)
      process.exit(1)
    }
    return value
  }

  // Parse remaining args
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]

    switch (arg) {
      case '--board':
        result.board = getNextArg(i++, '--board')
        break
      case '--dry-run':
        result.dryRun = true
        break
      case '--incremental':
        result.incremental = true
        break
      case '--verbose':
      case '-v':
        result.verbose = true
        break
      case '--posts':
        result.posts = getNextArg(i++, '--posts')
        break
      case '--comments':
        result.comments = getNextArg(i++, '--comments')
        break
      case '--votes':
        result.votes = getNextArg(i++, '--votes')
        break
      case '--notes':
        result.notes = getNextArg(i++, '--notes')
        break
      case '--quackback-url':
        result.quackbackUrl = getNextArg(i++, '--quackback-url')
        break
      case '--quackback-key':
        result.quackbackKey = getNextArg(i++, '--quackback-key')
        break
      case '--help':
      case '-h':
        result.command = 'help'
        break
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`)
        }
    }
  }

  return result
}

function resolveQuackbackConfig(args: CliArgs): { url: string; key: string } {
  const url = args.quackbackUrl ?? process.env.QUACKBACK_URL
  const key = args.quackbackKey ?? process.env.QUACKBACK_API_KEY

  if (!url) {
    console.error('Error: --quackback-url is required (or set QUACKBACK_URL env var)')
    process.exit(1)
  }
  if (!key) {
    console.error('Error: --quackback-key is required (or set QUACKBACK_API_KEY env var)')
    process.exit(1)
  }

  return { url, key }
}

function validateFile(
  path: string | undefined,
  name: string,
  required: boolean
): string | undefined {
  if (!path) {
    if (required) {
      console.error(`Error: --${name} is required`)
      process.exit(1)
    }
    return undefined
  }

  const resolved = resolve(path)
  if (!existsSync(resolved)) {
    console.error(`Error: File not found: ${resolved}`)
    process.exit(1)
  }

  return resolved
}

async function runIntermediateImport(args: CliArgs): Promise<void> {
  const { url, key } = resolveQuackbackConfig(args)

  const postsFile = validateFile(args.posts, 'posts', false)
  const commentsFile = validateFile(args.comments, 'comments', false)
  const votesFile = validateFile(args.votes, 'votes', false)
  const notesFile = validateFile(args.notes, 'notes', false)

  if (!postsFile && !commentsFile && !votesFile && !notesFile) {
    console.error('Error: At least one data file is required')
    process.exit(1)
  }

  const data: IntermediateData = {
    posts: [],
    comments: [],
    votes: [],
    notes: [],
    users: [],
    changelogs: [],
  }

  // Helper to parse and log a file
  function parseFile<T>(
    file: string | undefined,
    label: string,
    schema: Parameters<typeof parseCSV<T>>[1]
  ): T[] {
    if (!file) return []

    console.log(`📄 Parsing ${label} from: ${file}`)
    const result = parseCSV(file, schema)

    if (result.errors.length > 0) {
      console.warn(`   ⚠️  ${result.errors.length} validation errors`)
      if (args.verbose) {
        for (const err of result.errors.slice(0, 5)) {
          console.warn(`      Row ${err.row}: ${err.message}`)
        }
        if (result.errors.length > 5) {
          console.warn(`      ... and ${result.errors.length - 5} more`)
        }
      }
    }
    console.log(`   ✓ ${result.data.length} ${label} parsed`)
    return result.data
  }

  data.posts = parseFile(
    postsFile,
    'posts',
    intermediatePostSchema as Parameters<typeof parseCSV<IntermediatePost>>[1]
  )
  data.comments = parseFile(
    commentsFile,
    'comments',
    intermediateCommentSchema as Parameters<typeof parseCSV<IntermediateComment>>[1]
  )
  data.votes = parseFile(votesFile, 'votes', intermediateVoteSchema)
  data.notes = parseFile(notesFile, 'notes', intermediateNoteSchema)

  // If a board was specified, set it on all posts that don't have one
  if (args.board) {
    for (const post of data.posts) {
      if (!post.board) post.board = args.board
    }
  }

  if (args.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No data will be inserted\n')
  }

  console.log(`\n🚀 Importing via Quackback API: ${url}`)

  try {
    const result = await runApiImport({
      quackbackUrl: url,
      quackbackKey: key,
      data,
      dryRun: args.dryRun,
      verbose: args.verbose,
      incremental: args.incremental,
    })

    const totalErrors =
      result.posts.errors +
      result.comments.errors +
      result.votes.errors +
      result.notes.errors +
      result.changelogs.errors

    if (totalErrors > 0) {
      process.exit(1)
    }
  } catch (error) {
    console.error('\n❌ Import failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// Main
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  switch (args.command) {
    case 'help':
      printUsage()
      break

    case 'intermediate':
      await runIntermediateImport(args)
      break

    default:
      printUsage()
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
