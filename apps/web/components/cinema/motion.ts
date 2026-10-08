/** anime.js runs outside React, so it checks the OS setting directly (Motion uses useReducedMotion). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;
