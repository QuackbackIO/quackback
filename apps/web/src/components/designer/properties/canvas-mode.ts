import { createContext } from 'react'

/** The mode the canvas shows, so a colour field opens on the colours in view. */
export const CanvasModeContext = createContext<'light' | 'dark'>('light')
