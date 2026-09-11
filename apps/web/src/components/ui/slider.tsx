import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@/lib/shared/utils'

type SliderProps = Omit<SliderPrimitive.Root.Props, 'value' | 'defaultValue' | 'onValueChange'> & {
  value?: number[]
  defaultValue?: number[]
  onValueChange?: (value: number[]) => void
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  ...props
}: SliderProps) {
  const thumbCount = value?.length ?? defaultValue?.length ?? 1

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      onValueChange={(next) => {
        if (!onValueChange) return
        onValueChange(Array.isArray(next) ? [...next] : [next])
      }}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full items-center">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-background shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
