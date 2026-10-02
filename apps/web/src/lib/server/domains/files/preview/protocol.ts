/**
 * What the preview job and its worker (`preview-worker.ts`) say to each other.
 *
 * An error crosses as its name, plus what the job acts on: the module behind
 * a missing-parser fault (the queue retries those) or a refusal's code.
 * Messages stay behind, since a parser's message can quote the file.
 */
import type { ByteKind } from './kind'
import {
  PreviewDependencyError,
  PreviewRefusedError,
  PreviewTimeoutError,
  type PreviewResult,
} from './result'

export interface DeriveRequest {
  kind: ByteKind
  bytes: Uint8Array
  contentType: string
  /** When the derivation must be done by, in epoch milliseconds. */
  deadlineAt: number
}

export interface WireError {
  name: string
  /** A missing parser: which one, and why it would not load. */
  dependency?: string
  detail?: string
  /** A refusal's code. */
  reason?: string
}

export type WorkerMessage =
  /** The worker loaded its code and waits for the file. */
  | { type: 'ready' }
  | { type: 'done'; ok: true; result: PreviewResult }
  | { type: 'done'; ok: false; error: WireError }

export function toWire(err: unknown): WireError {
  if (err instanceof PreviewDependencyError) {
    const cause = (err as { cause?: unknown }).cause
    return {
      name: err.name,
      dependency: err.dependency,
      ...(cause instanceof Error ? { detail: cause.message } : {}),
    }
  }
  if (err instanceof PreviewRefusedError) return { name: err.name, reason: err.reason }
  return { name: err instanceof Error ? err.name : 'Error' }
}

export function fromWire(wire: WireError): Error {
  if (wire.dependency !== undefined) {
    return new PreviewDependencyError(wire.dependency, {
      cause: wire.detail ? new Error(wire.detail) : undefined,
    })
  }
  if (wire.reason !== undefined) return new PreviewRefusedError(wire.reason)
  if (wire.name === 'PreviewTimeoutError') return new PreviewTimeoutError()
  const err = new Error('The file could not be read')
  err.name = wire.name
  return err
}

/** The buffers a value's byte arrays own outright, which can move rather than be copied. */
export function ownedBuffers(arrays: Uint8Array[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>()
  for (const a of arrays) {
    if (
      a.buffer instanceof ArrayBuffer &&
      a.byteOffset === 0 &&
      a.byteLength === a.buffer.byteLength
    ) {
      buffers.add(a.buffer)
    }
  }
  return [...buffers]
}
