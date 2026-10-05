// @vitest-environment happy-dom
/**
 * The title field is borderless, so the browser outline is off and it draws
 * its own keyboard focus cue: a neutral underline in the ring colour (never the
 * brand colour), on the bottom edge only so the field still reads as a title.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { Form } from '@/components/ui/form'
import { TitleInput } from '../title-input'

function Harness() {
  const form = useForm({ defaultValues: { title: '' } })
  return (
    <Form {...form}>
      <TitleInput control={form.control} placeholder="Title" />
    </Form>
  )
}

describe('TitleInput', () => {
  it('shows keyboard focus with a neutral underline instead of no cue at all', () => {
    render(<Harness />)
    const classes = screen.getByRole('textbox', { name: 'Title' }).className.split(/\s+/)
    expect(classes).toContain('outline-none')
    // Reserved, invisible until focus, so focusing does not shift the layout.
    expect(classes).toContain('border-b-2')
    expect(classes).toContain('border-transparent')
    expect(classes).toContain('focus-visible:border-ring')
    expect(classes.filter((c) => /focus.*(primary|amber|accent)/.test(c))).toEqual([])
  })
})
