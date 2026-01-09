#!/usr/bin/env bun
/**
 * Quackback Data Import CLI
 *
 * Import data from various sources into Quackback.
 *
 * Usage:
 *   bun scripts/import/cli.ts intermediate --posts posts.csv --board features
 *   bun scripts/import/cli.ts uservoice --suggestions export.csv --board features
 *
 * Run with --help for full options.
 */

import { config } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../../.env'), override: false })

import { parseCSV } from './core/csv-parser'
import { runImport } from './core/importer'
import {
  intermediatePostSchema,
  intermediateCommentSchema,
  intermediateVoteSchema,
  intermediateNoteSchema,
} from './schema/validators'
import type {
  IntermediateData,
  IntermediatePost,
  IntermediateComment,
  ImportOptions,
} from './schema/types'
import { convertUserVoice, printStats as printUserVoiceStats } from './adapters/uservoice'

// CLI argument parsing
interface CliArgs {
  command: 'intermediate' | 'uservoice' | 'help'
  // Common options
  board?: string
  dryRun: boolean
  verbose: boolean
  createTags: boolean
  createUsers: boolean
  batchSize: number
  // Intermediate format files
  posts?: string
  comments?: string
  votes?: string
  notes?: string
  // UserVoice files
  suggestions?: string
}

function printUsage(): void {
  console.log(`
Quackback Data Import CLI

Usage:
  bun scripts/import/cli.ts <command> [options]

Commands:
  intermediate    Import from intermediate CSV format
  uservoice       Import from UserVoice export files
  help            Show this help message

Common Options:
  --board <slug>      Target board slug (required)
  --dry-run           Validate only, don't insert data
  --verbose           Show detailed progress
  --create-tags       Auto-create missing tags (default: true)
  --no-create-tags    Don't create missing tags
  --create-users      Create members for unknown emails
  --batch-size <n>    Batch size for inserts (default: 100)

Intermediate Format Options:
  --posts <file>      Posts CSV file
  --comments <file>   Comments CSV file
  --votes <file>      Votes CSV file
  --notes <file>      Internal notes CSV file

UserVoice Options:
  --suggestions <file>    Full suggestions export CSV (required)
  --comments <file>       Comments CSV (optional)
  --notes <file>          Internal notes CSV (optional)

Examples:
  # Import from intermediate format
  bun scripts/import/cli.ts intermediate \\
    --posts data/posts.csv \\
    --comments data/comments.csv \\
    --board features

  # Import from UserVoice with dry run
  bun scripts/import/cli.ts uservoice \\
    --suggestions ~/Downloads/full-export.csv \\
    --comments ~/Downloads/comments.csv \\
    --board features \\
    --dry-run --verbose

  # Import with verbose output
  bun scripts/import/cli.ts intermediate \\
    --posts data/posts.csv \\
    --board features \\
    --verbose

Environment:
  DATABASE_URL    PostgreSQL connection string (required)
`)
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    command: 'help',
    dryRun: false,
    verbose: false,
    createTags: true,
    createUsers: false,
    batchSize: 100,
  }

  if (args.length === 0) {
    return result
  }

  // First positional arg is command
  const cmd = args[0]
  if (cmd === 'intermediate' || cmd === 'uservoice' || cmd === 'help') {
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
      case '--verbose':
      case '-v':
        result.verbose = true
        break
      case '--create-tags':
        result.createTags = true
        break
      case '--no-create-tags':
        result.createTags = false
        break
      case '--create-users':
        result.createUsers = true
        break
      case '--batch-size':
        result.batchSize = parseInt(getNextArg(i++, '--batch-size'), 10) || 100
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
  if (!args.board) {
    console.error('Error: --board is required')
    process.exit(1)
  }

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

  await executeImport(data, args)
}

async function runUserVoiceImport(args: CliArgs): Promise<void> {
  if (!args.board) {
    console.error('Error: --board is required')
    process.exit(1)
  }

  const suggestionsFile = validateFile(args.suggestions, 'suggestions', true)!
  const commentsFile = validateFile(args.comments, 'comments', false)
  const notesFile = validateFile(args.notes, 'notes', false)

  console.log('🔄 Converting UserVoice export...')

  const result = convertUserVoice({
    suggestionsFile,
    commentsFile,
    notesFile,
    verbose: args.verbose,
  })

  if (args.verbose) {
    printUserVoiceStats(result.stats)
  }

  await executeImport(result.data, args)
}

async function executeImport(data: IntermediateData, args: CliArgs): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('Error: DATABASE_URL environment variable is required')
    process.exit(1)
  }

  const options: ImportOptions = {
    board: args.board!,
    createTags: args.createTags,
    createUsers: args.createUsers,
    dryRun: args.dryRun,
    verbose: args.verbose,
    batchSize: args.batchSize,
  }

  if (args.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No data will be inserted\n')
  }

  try {
    const result = await runImport(connectionString, data, options)

    // Exit with error code if there were errors
    const totalErrors =
      result.posts.errors + result.comments.errors + result.votes.errors + result.notes.errors

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

    default:
      printUsage()
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
