import { afterAll, beforeAll } from 'vitest'

const setAttribute = HTMLIFrameElement.prototype.setAttribute

beforeAll(() => {
  HTMLIFrameElement.prototype.setAttribute = function patchedSetAttribute(name, value) {
    if (name.toLowerCase() === 'src' && /^https?:\/\//i.test(value)) {
      setAttribute.call(this, 'data-quackback-test-src', value)
      return setAttribute.call(this, name, 'about:blank')
    }
    return setAttribute.call(this, name, value)
  }
})

afterAll(() => {
  HTMLIFrameElement.prototype.setAttribute = setAttribute
})
