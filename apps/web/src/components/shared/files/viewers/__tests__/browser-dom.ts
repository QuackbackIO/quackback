/**
 * Three places where happy-dom's DOM differs from every browser's, all on the
 * paths docx-preview and DOMPurify take. Without these the document tests
 * would exercise happy-dom's gaps instead of the libraries: docx-preview would
 * lose every relationship id, and DOMPurify would drop every element as
 * nameless, then stop walking at the first node it removes and hand back the
 * rest of the markup untouched. Each fix makes happy-dom answer as the DOM
 * standard (and so a browser) does; none changes what either library does.
 */

// 1. `Node.prototype.nodeName`. Browsers define the getter once, on
// `Node.prototype`, and DOMPurify reads it from there. happy-dom defines it on
// each subclass and leaves the base getter returning ''.
const nodeProto = window.Node.prototype
const baseNodeName = Object.getOwnPropertyDescriptor(nodeProto, 'nodeName')

if (baseNodeName?.get && baseNodeName.get.call(document.createElement('p')) === '') {
  Object.defineProperty(nodeProto, 'nodeName', {
    configurable: true,
    get(this: Node): string {
      let proto: object | null = Object.getPrototypeOf(this)
      while (proto && proto !== nodeProto) {
        const own = Object.getOwnPropertyDescriptor(proto, 'nodeName')
        if (own?.get) return own.get.call(this) as string
        proto = Object.getPrototypeOf(proto)
      }
      return baseNodeName.get!.call(this) as string
    },
  })
}

// 2. Prefixed attributes in XML. In an XML document `r:id` has the local name
// `id` (Namespaces in XML); happy-dom's XML parser keeps `r:id`. docx-preview
// finds every relationship id, page size and style by local name.
const attrProto = window.Attr.prototype
const baseLocalName = Object.getOwnPropertyDescriptor(attrProto, 'localName')

const xmlProbe = new DOMParser().parseFromString('<a xmlns:p="urn:p" p:b="1"/>', 'application/xml')
const prefixed = Array.from(xmlProbe.documentElement.attributes).find((a) => a.name === 'p:b')
if (baseLocalName?.get && prefixed?.localName === 'p:b') {
  Object.defineProperty(attrProto, 'localName', {
    configurable: true,
    get(this: Attr): string {
      const name = baseLocalName.get!.call(this) as string
      const doc = this.ownerElement?.ownerDocument
      const isXml = doc !== undefined && doc !== null && doc.contentType !== 'text/html'
      return isXml && name.includes(':') ? name.slice(name.indexOf(':') + 1) : name
    },
  })
}

// 3. `NodeIterator` across removals. By the standard, removing the iterator's
// current node moves its reference to the node before it in tree order, so the
// walk carries on (https://dom.spec.whatwg.org/#nodeiterator-pre-removing-steps).
// happy-dom's iterator stays on the detached node and the walk ends.

/** The node after `node` in tree order, staying inside `root`. */
function following(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nextSibling) return current.nextSibling
    current = current.parentNode
  }
  return null
}

/** The node before `node` in tree order. */
function preceding(node: Node): Node | null {
  let prev = node.previousSibling
  if (!prev) return node.parentNode
  while (prev.lastChild) prev = prev.lastChild
  return prev
}

const SHOW_BITS: Record<number, number> = {
  1: 0x1,
  3: 0x4,
  4: 0x8,
  7: 0x40,
  8: 0x80,
  9: 0x100,
  11: 0x400,
}

class StandardNodeIterator {
  #reference: Node
  #anchor: Node | null = null
  #started = false

  constructor(
    readonly root: Node,
    readonly whatToShow: number = 0xffffffff,
    readonly filter: NodeFilter | null = null
  ) {
    this.#reference = root
  }

  #accepts(node: Node): boolean {
    const bit = SHOW_BITS[node.nodeType] ?? 0
    if ((this.whatToShow & bit) === 0) return false
    if (!this.filter) return true
    const verdict =
      typeof this.filter === 'function' ? this.filter(node) : this.filter.acceptNode(node)
    return verdict === 1
  }

  nextNode(): Node | null {
    let node: Node | null
    if (!this.#started) {
      this.#started = true
      node = this.root
    } else {
      // The reference was removed since the last step: resume from the node
      // that came before it, as the standard's pre-removing steps do.
      if (!this.root.contains(this.#reference) && this.#anchor) this.#reference = this.#anchor
      node = following(this.#reference, this.root)
    }
    while (node && !this.#accepts(node)) node = following(node, this.root)
    if (!node) return null
    this.#reference = node
    this.#anchor = node === this.root ? null : preceding(node)
    return node
  }

  previousNode(): Node | null {
    throw new Error('previousNode is not used by the sanitizer')
  }

  detach(): void {}
}

// Patch the prototype that actually owns the method: happy-dom's documents do
// not all inherit from `window.Document`.
let owner: object | null = document
while (owner && !Object.hasOwn(owner, 'createNodeIterator')) owner = Object.getPrototypeOf(owner)
if (owner) {
  Object.defineProperty(owner, 'createNodeIterator', {
    configurable: true,
    writable: true,
    value: function createNodeIterator(
      root: Node,
      whatToShow?: number,
      filter?: NodeFilter | null
    ) {
      return new StandardNodeIterator(root, whatToShow, filter)
    },
  })
}

export {}
