/**
 * ID mapping utilities
 *
 * Tracks the mapping from external IDs (e.g., UserVoice Idea ID)
 * to internal Quackback TypeIDs.
 */

import type { PostId } from '@quackback/ids'

/**
 * Simple ID map from external to internal IDs
 */
export class IdMap<T extends string> {
  private map = new Map<string, T>()

  set(externalId: string, internalId: T): void {
    this.map.set(externalId, internalId)
  }

  get(externalId: string): T | undefined {
    return this.map.get(externalId)
  }

  entries(): IterableIterator<[string, T]> {
    return this.map.entries()
  }
}

/**
 * ID maps for an import session
 */
export class ImportIdMaps {
  readonly posts = new IdMap<PostId>()
}
