/**
 * Workspace data export — shared types (Imports & exports hub).
 */

/** One exportable entity: a paged row source plus a line serializer. */
export interface EntityExporter<Row = unknown> {
  /** Manifest key, e.g. 'posts'. */
  key: string
  /** Archive file name, e.g. 'posts.csv'. */
  fileName: string
  /** Rows fetched per page. Smaller for row-fat entities (conversations). */
  pageSize: number
  /** Optional leading chunk (CSV header line, without trailing newline). */
  header?: string
  fetchPage(offset: number, limit: number): Promise<Row[]>
  /** Serialize one row to a single archive line (no trailing newline). */
  serialize(row: Row): string
}

/** manifest.json contents — format_version lets future readers gate parsing. */
export interface WorkspaceExportManifest {
  format_version: 1
  generator: 'quackback'
  workspace_slug: string
  exported_at: string
  entities: Record<string, number>
}

export interface WorkspaceExportResult {
  s3Key: string
  sizeBytes: number
  entityCounts: Record<string, number>
}
