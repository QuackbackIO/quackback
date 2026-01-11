/**
 * CSV parsing utilities
 *
 * Wraps PapaParse for consistent CSV handling across all adapters.
 */

import Papa from 'papaparse'
import { readFileSync } from 'fs'
import type { z } from 'zod'

export interface ParseResult<T> {
  data: T[]
  errors: Array<{ row: number; message: string }>
}

/**
 * Parse a CSV file and validate each row against a Zod schema
 */
export function parseCSV<T>(filePath: string, schema: z.ZodSchema<T>): ParseResult<T> {
  const fileContent = readFileSync(filePath, 'utf-8')

  const parseResult = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    transform: (value) => value.trim(),
  })

  const data: T[] = []
  const errors: Array<{ row: number; message: string }> = []

  for (const error of parseResult.errors) {
    errors.push({ row: error.row ?? 0, message: error.message })
  }

  for (let i = 0; i < parseResult.data.length; i++) {
    const row = parseResult.data[i] as Record<string, unknown>
    const result = schema.safeParse(row)

    if (result.success) {
      data.push(result.data)
    } else {
      const message = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      errors.push({ row: i + 2, message })
    }
  }

  return { data, errors }
}

/**
 * Parse a CSV file without validation (raw data)
 */
export function parseCSVRaw(filePath: string): {
  data: Record<string, string>[]
  fields: string[]
} {
  const fileContent = readFileSync(filePath, 'utf-8')

  const parseResult = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    transform: (value) => value.trim(),
  })

  return {
    data: parseResult.data as Record<string, string>[],
    fields: parseResult.meta.fields ?? [],
  }
}

/**
 * Normalize a header name to camelCase.
 * Handles various formats: "Idea Title", "idea_title", "IDEA-TITLE" -> "ideaTitle"
 *
 * Note: Papaparse may call transformHeader multiple times on the same header,
 * so we detect already-normalized headers by checking if they're already lowercase alphanumeric.
 */
function normalizeHeader(header: string): string {
  // If header is already lowercase alphanumeric, it's normalized (skip re-processing)
  // This handles Papaparse calling transformHeader twice
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(header) || /^[a-z0-9]+$/.test(header)) {
    return header
  }

  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('')
}
