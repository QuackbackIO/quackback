/**
 * The builder's history: each change is a labelled step of patches, undone
 * and redone in order; a burst of the same change, or a group such as a drag
 * or an AI reply, is one step; and only so many steps are kept.
 */
import { describe, expect, it } from 'vitest'
import { change, createHistory, patchesBetween } from '../history'

type Doc = { title: string; count: number; items: string[]; nested?: { on: boolean } }
const start: Doc = { title: 'Home', count: 0, items: ['a', 'b'] }

describe('change', () => {
  it('makes the next document with the patches that make it and take it back', () => {
    const [next, patches, inverse] = change(start, (draft) => {
      draft.title = 'Feedback'
    })
    expect(next).toEqual({ ...start, title: 'Feedback' })
    expect(start.title).toBe('Home')
    expect(patches).toEqual([{ op: 'replace', path: ['title'], value: 'Feedback' }])
    expect(inverse).toEqual([{ op: 'replace', path: ['title'], value: 'Home' }])
  })

  it('ignores what a recipe returns, so a helper that returns a value never replaces the document', () => {
    const [next] = change(start, (draft) => draft.items.push('c'))
    expect(next.items).toEqual(['a', 'b', 'c'])
  })

  it('leaves the result open to change, as the builder treats its drafts', () => {
    const [next] = change(start, (draft) => void (draft.count = 1))
    expect(Object.isFrozen(next)).toBe(false)
  })
})

describe('patchesBetween', () => {
  it('patches only what differs between two whole documents', () => {
    const after: Doc = { title: 'Home', count: 2, items: ['a', 'b'], nested: { on: true } }
    const [patches, inverse] = patchesBetween(start, after)
    expect(patches).toEqual(
      expect.arrayContaining([
        { op: 'replace', path: ['count'], value: 2 },
        { op: 'add', path: ['nested'], value: { on: true } },
      ])
    )
    expect(patches).toHaveLength(2)
    const history = createHistory()
    history.getState().push('AI', patches, inverse)
    expect(history.getState().undo(after)?.doc).toEqual(start)
  })

  it('has nothing to patch between equal documents', () => {
    expect(patchesBetween(start, structuredClone(start))[0]).toEqual([])
  })
})

describe('createHistory', () => {
  function edit(history: ReturnType<typeof createHistory>, doc: Doc, label: string, at = 0) {
    const [next, patches, inverse] = change(doc, (draft) => void (draft.count += 1))
    history.getState().push(label, patches, inverse, at)
    return next
  }

  it('undoes and redoes labelled steps in order', () => {
    const history = createHistory()
    const one = edit(history, start, 'One')
    const two = edit(history, one, 'Two')
    expect(history.getState().undoLabel()).toBe('Two')
    const back = history.getState().undo(two)!
    expect(back).toEqual({ doc: one, label: 'Two' })
    expect(history.getState().undoLabel()).toBe('One')
    expect(history.getState().redoLabel()).toBe('Two')
    expect(history.getState().redo(back.doc)).toEqual({ doc: two, label: 'Two' })
    expect(history.getState().redoLabel()).toBeNull()
  })

  it('has nothing to undo or redo at the ends', () => {
    const history = createHistory()
    expect(history.getState().undo(start)).toBeNull()
    expect(history.getState().redo(start)).toBeNull()
  })

  it('forgets what was undone once a new change is made', () => {
    const history = createHistory()
    const one = edit(history, start, 'One')
    history.getState().undo(one)
    edit(history, start, 'Other')
    expect(history.getState().redoLabel()).toBeNull()
  })

  it('keeps a change that changed nothing out of the history', () => {
    const history = createHistory()
    history.getState().push('Nothing', [], [])
    expect(history.getState().undoLabel()).toBeNull()
  })

  it('merges a quick burst of the same change into one step', () => {
    const history = createHistory({ mergeMs: 1000 })
    let doc = edit(history, start, 'Headline', 0)
    doc = edit(history, doc, 'Headline', 500)
    doc = edit(history, doc, 'Headline', 900)
    expect(doc.count).toBe(3)
    expect(history.getState().past).toHaveLength(1)
    expect(history.getState().undo(doc)?.doc).toEqual(start)
    // Slower, or a different change, is a new step.
    const slow = createHistory({ mergeMs: 1000 })
    const a = edit(slow, start, 'Headline', 0)
    edit(slow, a, 'Headline', 2000)
    expect(slow.getState().past).toHaveLength(2)
  })

  it('makes a group, such as a drag, one step under its own label', () => {
    const history = createHistory()
    history.getState().begin('Move block')
    let doc = edit(history, start, 'Step')
    history.getState().begin('Inner')
    doc = edit(history, doc, 'Step')
    history.getState().end()
    doc = edit(history, doc, 'Step')
    expect(history.getState().past).toHaveLength(0)
    history.getState().end()
    expect(history.getState().past).toHaveLength(1)
    expect(history.getState().undoLabel()).toBe('Move block')
    const back = history.getState().undo(doc)!
    expect(back.doc).toEqual(start)
    expect(history.getState().redo(back.doc)?.doc).toEqual(doc)
  })

  it('records nothing for a group that changed nothing', () => {
    const history = createHistory()
    history.getState().begin('Drag')
    history.getState().end()
    expect(history.getState().past).toHaveLength(0)
  })

  it('closes an open group before undoing', () => {
    const history = createHistory()
    history.getState().begin('Drag')
    const doc = edit(history, start, 'Step')
    expect(history.getState().undo(doc)?.doc).toEqual(start)
    expect(history.getState().group).toBeNull()
  })

  it('keeps only the newest steps up to its cap', () => {
    const history = createHistory({ limit: 3 })
    let doc = start
    for (const label of ['1', '2', '3', '4', '5']) doc = edit(history, doc, label)
    expect(history.getState().past.map((step) => step.label)).toEqual(['3', '4', '5'])
  })

  it('forgets everything on clear, or starts again from steps given', () => {
    const history = createHistory()
    const doc = edit(history, start, 'One')
    history.getState().clear()
    expect(history.getState().undo(doc)).toBeNull()
    const [patches, inverse] = patchesBetween(doc, start)
    history.getState().clear([{ label: 'Discard draft', patches, inversePatches: inverse }])
    expect(history.getState().undoLabel()).toBe('Discard draft')
    expect(history.getState().undo(start)?.doc).toEqual(doc)
  })
})

describe('createHistory groups', () => {
  it('never merges a group into the step before it, even under the same label', () => {
    const history = createHistory({ mergeMs: 1000 })
    for (let i = 0; i < 2; i++) {
      history.getState().begin('Quackback AI')
      const [, patches, inverse] = change(start, (draft) => void (draft.count = i + 1))
      history.getState().push('Quackback AI', patches, inverse)
      history.getState().end()
    }
    expect(history.getState().past).toHaveLength(2)
  })
})
