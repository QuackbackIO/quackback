/**
 * Progress reporting utilities
 *
 * Provides consistent progress output for import operations.
 */

interface ImportStats {
  imported: number
  skipped: number
  errors: number
}

export class Progress {
  private startTime = 0

  constructor(private verbose: boolean) {}

  start(message: string): void {
    this.startTime = Date.now()
    console.log(`\n🚀 ${message}`)
  }

  step(message: string): void {
    if (this.verbose) {
      console.log(`   ${message}`)
    }
  }

  progress(current: number, total: number, label: string): void {
    if (this.verbose) {
      const percent = total > 0 ? Math.round((current / total) * 100) : 0
      console.log(`   ${label}: ${current}/${total} (${percent}%)`)
    }
  }

  success(message: string): void {
    console.log(`✅ ${message} (${formatDuration(Date.now() - this.startTime)})`)
  }

  info(message: string): void {
    console.log(`ℹ️  ${message}`)
  }

  warn(message: string): void {
    console.warn(`⚠️  ${message}`)
  }

  error(message: string): void {
    console.error(`❌ ${message}`)
  }

  summary(result: {
    posts: ImportStats
    comments: ImportStats
    votes: ImportStats
    notes: ImportStats
    duration: number
  }): void {
    console.log(`\n━━━ Import Summary ━━━`)
    this.logStats('Posts', result.posts)
    this.logStats('Comments', result.comments)
    this.logStats('Votes', result.votes)
    this.logStats('Notes', result.notes)
    console.log(`\n⏱️  Total time: ${formatDuration(result.duration)}`)

    const totalErrors =
      result.posts.errors + result.comments.errors + result.votes.errors + result.notes.errors

    if (totalErrors > 0) {
      console.log(`\n⚠️  Completed with ${totalErrors} error(s)`)
    } else {
      console.log(`\n🎉 Import completed successfully!`)
    }
  }

  private logStats(label: string, stats: ImportStats): void {
    const parts = []
    if (stats.imported > 0) parts.push(`${stats.imported} imported`)
    if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
    if (stats.errors > 0) parts.push(`${stats.errors} errors`)

    let status: string
    if (stats.errors > 0) {
      status = '⚠️'
    } else if (stats.imported > 0) {
      status = '✅'
    } else {
      status = '➖'
    }
    console.log(`${status} ${label}: ${parts.join(', ') || 'none'}`)
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}
