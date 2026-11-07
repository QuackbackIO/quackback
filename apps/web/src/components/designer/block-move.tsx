import { useId, useRef } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The place to hand a move that is counted before the block is taken out,
 * as a drop between two blocks reads, for a block ending at a position.
 */
export function placeOfPosition(from: number, to: number): number {
  return to > from ? to + 1 : to
}

/**
 * Moves a Home block without dragging: one place up or down, or to a place
 * picked from the list.
 */
export function BlockMove({
  names,
  index,
  onMove,
  onPlace,
}: {
  /** Every block's name, in order. */
  names: readonly string[]
  /** Where this block is. */
  index: number
  onMove: (by: -1 | 1) => void
  /** Moves it to end at a position, counted as the list reads now. */
  onPlace: (position: number) => void
}) {
  const id = useId()
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)
  // A move to an end disables the button pressed; focus goes to the other one.
  const move = (by: -1 | 1) => {
    onMove(by)
    const end = by < 0 ? index === 1 : index === names.length - 2
    if (end) requestAnimationFrame(() => (by < 0 ? down : up).current?.focus())
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" ref={up} disabled={index === 0} onClick={() => move(-1)}>
        <ArrowUpIcon className="size-4" aria-hidden="true" />
        Move up
      </Button>
      <Button
        variant="outline"
        size="sm"
        ref={down}
        disabled={index === names.length - 1}
        onClick={() => move(1)}
      >
        <ArrowDownIcon className="size-4" aria-hidden="true" />
        Move down
      </Button>
      <span id={id} className="sr-only">
        Move to
      </span>
      <Select
        value={String(index)}
        onValueChange={(value) => {
          const to = Number(value)
          if (to !== index) onPlace(to)
        }}
      >
        <SelectTrigger size="sm" aria-labelledby={id} className="w-auto min-w-28">
          <span className="text-muted-foreground" aria-hidden="true">
            Move to
          </span>
          <SelectValue>{(value: string) => `${Number(value) + 1}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {names.map((name, at) => (
            <SelectItem key={at} value={String(at)}>
              {`${at + 1} · ${name}${at === index ? ' (here)' : ''}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
