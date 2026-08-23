import { MinusIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'

export function QuantityStepper(props: {
  value: number
  min: number
  max?: number
  onChange: (next: number) => void
  decreaseLabel: string
  increaseLabel: string
}) {
  const atMin = props.value <= props.min
  const atMax = props.max != null && props.value >= props.max
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={props.decreaseLabel}
        disabled={atMin}
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
      >
        <MinusIcon className="size-3.5" />
      </Button>
      <div className="w-10 text-center text-sm font-semibold tabular-nums">{props.value}</div>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={props.increaseLabel}
        disabled={atMax}
        onClick={() => props.onChange(props.value + 1)}
      >
        <PlusIcon className="size-3.5" />
      </Button>
    </div>
  )
}
