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
  constructor(private verbose: boolean) {}

  start(message: string): void {
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
    console.log(`✅ ${message}`)
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
    changelogs?: ImportStats
    duration: number
  }): void {
    console.log(`\n━━━ Import Summary ━━━`)
    this.logStats('Posts', result.posts)
    this.logStats('Comments', result.comments)
    this.logStats('Votes', result.votes)
    this.logStats('Notes', result.notes)
    if (result.changelogs) {
      this.logStats('Changelogs', result.changelogs)
    }

    const totalErrors =
      result.posts.errors +
      result.comments.errors +
      result.votes.errors +
      result.notes.errors +
      (result.changelogs?.errors ?? 0)

    if (totalErrors > 0) {
      console.log(`\n⚠️  Completed with ${totalErrors} error(s)`)
    } else {
      console.log(`\n🎉 Import completed successfully!`)
    }
  }

  private logStats(label: string, stats: ImportStats): void {
    const parts: string[] = []
    if (stats.imported > 0) parts.push(`${stats.imported} imported`)
    if (stats.skipped > 0) parts.push(`${stats.skipped} skipped`)
    if (stats.errors > 0) parts.push(`${stats.errors} errors`)

    const status = this.getStatusIcon(stats)
    console.log(`${status} ${label}: ${parts.join(', ') || 'none'}`)
  }

  private getStatusIcon(stats: ImportStats): string {
    if (stats.errors > 0) return '⚠️'
    if (stats.imported > 0) return '✅'
    return '➖'
  }
}
