#!/usr/bin/env bun
/**
 * Quackback Data Import CLI
 *
 * Import data from various sources into Quackback via the REST API.
 *
 * Usage:
 *   bun scripts/import/cli.ts canny --api-key KEY --quackback-url URL --quackback-key KEY
 *   bun scripts/import/cli.ts uservoice --suggestions export.csv --quackback-url URL --quackback-key KEY
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
import { convertUserVoice, printStats as printUserVoiceStats } from './adapters/uservoice'
import { convertCanny, printStats as printCannyStats } from './adapters/canny'

// CLI argument parsing
interface CliArgs {
  command: 'intermediate' | 'uservoice' | 'canny' | 'help'
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
  // UserVoice files
  suggestions?: string
  users?: string
  // Canny options
  apiKey?: string
  // Quackback API options (required for all modes)
  quackbackUrl?: string
  quackbackKey?: string
}

function printUsage(): void {
  console.log(`
Quackback Data Import CLI

All imports use the Quackback REST API — no direct database access needed.

Usage:
  bun scripts/import/cli.ts <command> [options]

Commands:
  canny           Import from Canny via API
  uservoice       Import from UserVoice export files
  intermediate    Import from intermediate CSV format
  help            Show this help message

Required Options (all commands):
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

Canny Options:
  --api-key <key>         Canny API key (or set CANNY_API_KEY env var)

UserVoice Options:
  --suggestions <file>    Full suggestions export CSV (denormalized, required)
  --comments <file>       Comments CSV (optional)
  --notes <file>          Internal notes CSV (optional)
  --users <file>          Subdomain users CSV (optional)

Intermediate Format Options:
  --board <slug>        Target board slug
  --posts <file>        Posts CSV file
  --comments <file>     Comments CSV file
  --votes <file>        Votes CSV file
  --notes <file>        Internal notes CSV file

Examples:
  # Import from Canny
  bun scripts/import/cli.ts canny \\
    --api-key YOUR_CANNY_API_KEY \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx \\
    --verbose

  # Import from UserVoice
  bun scripts/import/cli.ts uservoice \\
    --suggestions ~/Downloads/suggestions-full.csv \\
    --comments ~/Downloads/comments.csv \\
    --notes ~/Downloads/notes.csv \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx \\
    --verbose

  # Import from intermediate CSV format
  bun scripts/import/cli.ts intermediate \\
    --posts data/posts.csv \\
    --comments data/comments.csv \\
    --board features \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx

  # Dry run (validate without importing)
  bun scripts/import/cli.ts canny \\
    --api-key YOUR_CANNY_API_KEY \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx \\
    --dry-run --verbose

  # Incremental top-up of a previously-imported UserVoice export
  bun scripts/import/cli.ts uservoice \\
    --suggestions ~/uv/suggestions.csv \\
    --comments ~/uv/comments.csv \\
    --notes ~/uv/notes.csv \\
    --users ~/uv/users.csv \\
    --quackback-url https://feedback.yourapp.com \\
    --quackback-key qb_xxx \\
    --incremental --verbose

Environment Variables:
  QUACKBACK_URL         Quackback instance URL (alternative to --quackback-url)
  QUACKBACK_API_KEY     Quackback admin API key (alternative to --quackback-key)
  CANNY_API_KEY         Canny API key (alternative to --api-key)
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
  if (cmd === 'intermediate' || cmd === 'uservoice' || cmd === 'canny' || cmd === 'help') {
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
      case '--suggestions':
        result.suggestions = getNextArg(i++, '--suggestions')
        break
      case '--users':
        result.users = getNextArg(i++, '--users')
        break
      case '--api-key':
        result.apiKey = getNextArg(i++, '--api-key')
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

  await executeImport(data, url, key, args)
}

async function runUserVoiceImport(args: CliArgs): Promise<void> {
  const { url, key } = resolveQuackbackConfig(args)

  const suggestionsFile = validateFile(args.suggestions, 'suggestions', true)!
  const commentsFile = validateFile(args.comments, 'comments', false)
  const notesFile = validateFile(args.notes, 'notes', false)
  const usersFile = validateFile(args.users, 'users', false)

  console.log('🔄 Converting UserVoice export...')

  const result = convertUserVoice({
    suggestionsFile,
    commentsFile,
    notesFile,
    usersFile,
    verbose: args.verbose,
  })

  if (args.verbose) {
    printUserVoiceStats(result.stats)
  }

  await executeImport(result.data, url, key, args)
}

async function runCannyImport(args: CliArgs): Promise<void> {
  const apiKey = args.apiKey ?? process.env.CANNY_API_KEY
  if (!apiKey) {
    console.error('Error: Canny API key is required (--api-key or CANNY_API_KEY env var)')
    process.exit(1)
  }

  const { url, key } = resolveQuackbackConfig(args)

  console.log('🔄 Fetching data from Canny API...')

  const result = await convertCanny({
    apiKey,
    verbose: args.verbose,
  })

  if (args.verbose) {
    printCannyStats(result.stats)
  }

  console.log(
    `\n📊 Fetched: ${result.stats.posts} posts, ${result.stats.comments} comments, ` +
      `${result.stats.votes} votes, ${result.stats.notes} notes, ` +
      `${result.stats.changelogs} changelog entries`
  )

  await executeImport(result.data, url, key, args)
}

async function executeImport(
  data: IntermediateData,
  quackbackUrl: string,
  quackbackKey: string,
  args: CliArgs
): Promise<void> {
  if (args.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No data will be inserted\n')
  }

  console.log(`\n🚀 Importing via Quackback API: ${quackbackUrl}`)

  try {
    const result = await runApiImport({
      quackbackUrl,
      quackbackKey,
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

    case 'uservoice':
      await runUserVoiceImport(args)
      break

    case 'canny':
      await runCannyImport(args)
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
