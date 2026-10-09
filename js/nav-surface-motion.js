(() => {
  'use strict'
  if (window.SiteNavSurfaceMotion) return
  const states = new WeakMap()
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

  // Keep the surface rendered until exit finishes. Reversals start at the current
  // painted frame, and stale completion callbacks can never hide a reopened panel.
  const setOpen = (element, open) => {
    if (!element) return
    const previous = states.get(element)
    if (previous?.open === open) return
    const visible = !element.hidden && getComputedStyle(element).display !== 'none'
    const current = visible ? {
      opacity: getComputedStyle(element).opacity,
      transform: getComputedStyle(element).transform
    } : null
    previous?.animation?.cancel()
    const state = { open, animation: null }
    states.set(element, state)
    element.inert = !open
    element.setAttribute('aria-hidden', String(!open))
    if (!visible && !open) { element.hidden = true; return }

    element.dataset.navSurfaceState = open ? 'open' : 'closing'
    element.hidden = false
    const base = getComputedStyle(element).transform
    const resting = base === 'none' ? '' : base
    const end = { opacity: '1', transform: `${resting} translateY(0px)` }
    const start = { opacity: '0', transform: `${resting} translateY(-6px)` }
    const finish = () => {
      if (states.get(element) !== state) return
      element.hidden = !open
      element.dataset.navSurfaceState = open ? 'open' : 'closed'
      state.animation?.cancel()
      state.animation = null
    }
    if (reducedMotion.matches || !element.animate) { finish(); return }
    state.animation = element.animate(open ? [current || start, end] : [current || end, start], {
      duration: 200,
      easing: 'cubic-bezier(.2, .8, .2, 1)',
      fill: 'both'
    })
    state.animation.onfinish = finish
  }
  window.SiteNavSurfaceMotion = Object.freeze({ setOpen })
})()
