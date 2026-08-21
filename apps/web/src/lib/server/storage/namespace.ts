/**
 * Composing a bucket object name for one workspace, then proving it landed
 * inside that workspace.
 *
 * SAAS-HOSTING-STACK.md §9 replaces one bucket per workspace with one bucket for
 * the fleet and a per-workspace key prefix. That moves the isolation boundary out
 * of the provider and into this file. A per-bucket credential could not name
 * another workspace's bucket whatever the application believed; a shared bucket has
 * no such backstop, so the failure shape is §3's exactly: **a key that escapes
 * its namespace reads another customer's object, and it does not error and it
 * looks correct.**
 *
 * ## Why the WorkspaceId, and not some other identifier
 *
 * The namespace is `settings.id` — the branded {@link WorkspaceId}. It is not a
 * new workspace identifier, and refusing to invent one is the point: it is the
 * value §3's fingerprint already asserts. `evaluateWorkspaceIdentity` refuses a
 * pool whose `settings.id` is not the one the registry named, so **a database
 * that passes the fingerprint has, by construction, the right storage
 * namespace.**
 *
 * That inheritance is the whole argument, because there is no storage-side
 * fingerprint and there cannot be: a database can be asked who it is, an object
 * under the wrong prefix reads back perfectly and has nothing to say. Storage
 * therefore borrows the database's verification instead of holding one of its
 * own, and any identifier that did not come from that check — a slug, a
 * hostname, a request parameter, a segment of a stored key — forfeits the
 * inheritance silently.
 *
 * ## The stored key never carries the namespace
 *
 * `generateStorageKey()` keeps producing `uploads/2026/08/…`, the database keeps
 * storing exactly that, and `w/<workspaceId>/` is added here and stripped
 * nowhere else. Two properties depend on it. `isPublicStorageKey` still
 * classifies on segment 0 of the *stored* key, so prefixing does not turn every
 * public asset private. And `contentJson` stores host-independent
 * `/api/storage/${key}` refs, which stay valid across a friendly URL rename
 * and make any future move of the objects a copy rather than a content rewrite.
 *
 * ## Compose, then verify
 *
 * {@link composeNamespacedKey} is the only door, and it asserts on the *result*
 * rather than on the input. Verifying the composed name is what makes one check
 * cover traversal, absolute keys, empty keys and encoding tricks at once: they
 * are all the same claim — "the name that is about to reach a command is not
 * inside the namespace it was composed for" — and asking that question of the
 * finished string cannot miss a way of arriving at it. A composed name that
 * fails throws. It never falls back to the un-namespaced key, because in a
 * shared bucket that key is nobody's namespace.
 */
import type { WorkspaceId } from '@quackback/ids'

/**
 * Segment 0 of every object name this application writes.
 *
 * A literal marker rather than the bare workspace id so that an object's owner
 * is legible to a human reading a bucket listing during an incident, and so that
 * anything already at the bucket root is unambiguously *not* ours — see the
 * relocation note in `s3.ts`.
 */
export const WORKSPACE_NAMESPACE_ROOT = 'w'

/** S3 and every compatible provider cap an object key at 1024 UTF-8 bytes. */
const MAX_OBJECT_NAME_BYTES = 1024

/**
 * Any C0 control character, or DEL.
 *
 * A codepoint scan rather than a regex on purpose. `no-control-regex` is right
 * to ban these in a pattern — a control character in a regex is nearly always a
 * paste accident — and writing it as a comparison also keeps the bytes out of
 * the source, where a raw NUL compiles fine, is invisible in a diff, and is
 * silently skipped by this environment's grep.
 */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * A composed object name did not land inside its workspace namespace.
 *
 * Deliberately not a subclass of anything the storage surfaces already catch:
 * `StorageUnavailableError` becomes a 503 an operator is meant to fix, and this
 * is not that. This is a caller handing the storage boundary a key that would
 * have addressed something it must not, and it should surface as a fault.
 */
export class StorageNamespaceViolation extends Error {
  readonly workspaceId: WorkspaceId
  readonly key: string
  constructor(workspaceId: WorkspaceId, key: string, reason: string) {
    super(`Storage key ${JSON.stringify(key)} is not addressable in ${workspaceId}: ${reason}`)
    this.name = 'StorageNamespaceViolation'
    this.workspaceId = workspaceId
    this.key = key
  }
}

/** Everything every object name for `workspaceId` begins with. */
export function workspaceNamespace(workspaceId: WorkspaceId): string {
  return `${WORKSPACE_NAMESPACE_ROOT}/${workspaceId}/`
}

/**
 * A stored key → the name of the object in the bucket.
 *
 * The only place the namespace is applied. Throws
 * {@link StorageNamespaceViolation} rather than returning anything when the
 * result would not be inside the namespace.
 */
export function composeNamespacedKey(workspaceId: WorkspaceId, key: string): string {
  const namespace = workspaceNamespace(workspaceId)
  const objectName = `${namespace}${key}`

  const refuse = (reason: string): never => {
    throw new StorageNamespaceViolation(workspaceId, key, reason)
  }

  // Restated rather than assumed. It is trivially true of the line above and
  // would stop being true the moment composition grows a special case, which is
  // precisely when nobody would think to re-derive it.
  if (!objectName.startsWith(namespace)) refuse('composition did not produce a namespaced name')

  // An empty key composes to the namespace itself. That names a prefix, not an
  // object, and a request for it is bucket-listing-shaped rather than
  // object-shaped — the one operation this module deliberately cannot express.
  if (objectName.length === namespace.length) refuse('the key is empty')

  if (Buffer.byteLength(objectName, 'utf8') > MAX_OBJECT_NAME_BYTES) {
    refuse(`the composed name exceeds ${MAX_OBJECT_NAME_BYTES} bytes`)
  }

  assertCanonical(namespace, objectName, refuse)

  // One round of percent-decoding, because more than one layer between a
  // request and a bucket decodes before it addresses — this app's own
  // `/api/storage` route calls `decodeURIComponent` on the path — and to those
  // layers `%2e%2e%2f` is `../`. A key that is canonical only until something
  // downstream decodes it is not canonical.
  //
  // No written key can contain `%`: `generateStorageKey` sanitises filenames to
  // `[a-zA-Z0-9.-]`, and the two hand-built key shapes (`exports/<id>.zip`, a
  // content hash plus an extension) cannot either. So this costs nothing on
  // every real key and refuses the ones that only arrive from outside.
  if (objectName.includes('%')) {
    let decoded: string
    try {
      decoded = decodeURIComponent(objectName)
    } catch {
      return refuse('the key contains malformed percent-encoding')
    }
    assertCanonical(namespace, decoded, refuse)
  }

  return objectName
}

/**
 * The invariant, stated once for a name and once for its decoded form.
 *
 * "Is its own normal form, and that form starts with the namespace" is the
 * single property. `.` and `..` segments, an absolute key, a doubled slash and a
 * trailing slash all fail it for the same reason rather than needing a rule
 * each — which is what makes this one check rather than a list that can be
 * incomplete.
 */
function assertCanonical(
  namespace: string,
  candidate: string,
  refuse: (reason: string) => never
): void {
  if (!candidate.startsWith(namespace)) {
    refuse(`it resolves to ${JSON.stringify(candidate)}, outside the namespace`)
  }
  if (hasControlCharacter(candidate)) refuse('it contains a control character')
  // Not a path separator here, but it is to Windows clients, to some proxies,
  // and to anything that normalises before signing. A key nobody can produce is
  // a key nobody should be able to read.
  if (candidate.includes('\\')) refuse('it contains a backslash')

  for (const segment of candidate.split('/')) {
    if (segment === '') refuse('it contains an empty path segment')
    if (segment === '.' || segment === '..') refuse('it contains a relative path segment')
  }
}
