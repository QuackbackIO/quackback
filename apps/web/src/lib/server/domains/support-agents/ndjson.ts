/**
 * Read a newline-delimited JSON request body as a stream of text chunks.
 * Each line is `{"text": "..."}`. A line that is not that shape ends the
 * stream with a validation error, so a garbled body never reaches a customer.
 */
import { ValidationError } from '@/lib/shared/errors'

const MAX_LINE_BYTES = 16_384

function chunkOf(line: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new ValidationError('VALIDATION_ERROR', 'Each streamed line must be JSON')
  }
  const text = (parsed as { text?: unknown } | null)?.text
  if (typeof text !== 'string') {
    throw new ValidationError('VALIDATION_ERROR', 'Each streamed line must be {"text": "..."}')
  }
  return text
}

export async function* ndjsonTextChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ValidationError('STREAM_IDLE', 'The stream stopped sending text')),
            5000
          )
        }),
      ]).finally(() => clearTimeout(timer))
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const rawLine = buffer.slice(0, newline)
        const line = rawLine.trim()
        if (encoder.encode(rawLine).byteLength > MAX_LINE_BYTES) {
          throw new ValidationError('VALIDATION_ERROR', 'A streamed line is too long')
        }
        buffer = buffer.slice(newline + 1)
        if (line) yield chunkOf(line)
        newline = buffer.indexOf('\n')
      }
      if (encoder.encode(buffer).byteLength > MAX_LINE_BYTES) {
        throw new ValidationError('VALIDATION_ERROR', 'A streamed line is too long')
      }
    }
    const rest = (buffer + decoder.decode()).trim()
    if (encoder.encode(buffer).byteLength > MAX_LINE_BYTES)
      throw new ValidationError('VALIDATION_ERROR', 'A streamed line is too long')
    if (rest) yield chunkOf(rest)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
