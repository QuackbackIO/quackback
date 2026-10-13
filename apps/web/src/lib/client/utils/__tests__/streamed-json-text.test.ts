import { expect, it } from 'vitest'
import { StreamedJsonText } from '../streamed-json-text'

it('decodes escaped quotes, newlines, Unicode and surrogate pairs at every split', () => {
  const text = 'Quoted "answer"\n\\ path 🌊 文本'
  const json = JSON.stringify({ citations: [{ text: 'Ignore nested text' }], text, actions: [] })
  for (let split = 0; split <= json.length; split++) {
    const stream = new StreamedJsonText('text')
    const first = stream.append(json.slice(0, split))
    const last = stream.append(json.slice(split))
    expect(first.delta + last.delta).toBe(text)
    expect(last.text).toBe(text)
  }
  const escaped = new StreamedJsonText('text')
  for (const character of '{"text":"\\uD83C\\uDF0A"}') escaped.append(character)
  expect(escaped.text).toBe('🌊')
})
it('uses the requested top-level field and ignores names inside other strings', () => {
  const stream = new StreamedJsonText('draft')
  stream.append(
    JSON.stringify({
      title: 'The "draft" field',
      nested: { draft: 'Hidden' },
      draft: 'Visible',
      text: 'Other',
    })
  )
  expect(stream.text).toBe('Visible')
})
it('emits each character once for a long answer arriving one byte at a time', () => {
  const text = 'A long answer. '.repeat(1000)
  const stream = new StreamedJsonText('text')
  const deltas = Array.from(JSON.stringify({ text }), (character) => stream.append(character).delta)
  expect(deltas.join('')).toBe(text)
  expect(stream.append(' ').delta).toBe('')
})
it('does not display a non-string result field', () => {
  const stream = new StreamedJsonText('text')
  stream.append('{"text":{"text":"Hidden"},"other":"Ignored"}')
  expect(stream.text).toBe('')
})
it('does not interpret JSON quoted inside unstructured model prose', () => {
  const stream = new StreamedJsonText('text')
  stream.append('Some model prose {"text":"Not structured output"}')
  expect(stream.text).toBe('')
})
