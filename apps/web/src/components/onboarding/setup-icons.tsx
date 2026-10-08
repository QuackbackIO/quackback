import type { SVGProps } from 'react'

/*
 * Small solid icons for the setup screens, drawn here rather than imported.
 * The widget loads the same icon modules eagerly; importing them from these
 * lazy routes too would split each into a chunk of its own and add a request
 * to every widget load. Paths are Heroicons' 20px solid set.
 */

function SolidIcon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      data-slot="icon"
      {...props}
    >
      <path fillRule="evenodd" clipRule="evenodd" d={d} />
    </svg>
  )
}

export function SetupCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
      {...props}
    />
  )
}

export function SetupCheckCircleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
      {...props}
    />
  )
}

export function SetupWarningIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <SolidIcon
      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      {...props}
    />
  )
}
