(() => {
  'use strict'

  if (window.EcustAnimation) {
    window.EcustAnimation.init()
    return
  }

  const runtime = {
    container: null,
    scope: null,
    items: [],
    frames: new Set(),
    settleTimer: null,
    lastItem: null,
    lastItemHandler: null,
    styleCleanup: null,
    generation: 0
  }

  const cancelScheduledWork = () => {
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()

    if (runtime.settleTimer) {
      window.clearTimeout(runtime.settleTimer)
      runtime.settleTimer = null
    }

    if (runtime.lastItem && runtime.lastItemHandler) {
      runtime.lastItem.removeEventListener('animationend', runtime.lastItemHandler)
    }
    runtime.lastItem = null
    runtime.lastItemHandler = null

    if (runtime.styleCleanup) {
      runtime.styleCleanup()
      runtime.styleCleanup = null
    }
  }

  const clearItemState = () => {
    runtime.items.forEach(item => item.style.removeProperty('--ecust-fade-delay'))
  }

  const reset = (container = runtime.container) => {
    cancelScheduledWork()
    runtime.generation += 1
    clearItemState()

    runtime.scope?.classList.remove('ecust-page-animating', 'ecust-page-ready', 'ecust-page-settled')
    container?.classList.remove('page-animation-pending', 'pjax-content-entering', 'page-animation-active')
    container?.removeAttribute('data-ecust-animation-initialized')
    container?.removeAttribute('data-ecust-animation-ready')

    runtime.container = null
    runtime.scope = null
    runtime.items = []
  }

  const settle = (generation) => {
    if (generation !== runtime.generation || !runtime.scope?.isConnected) return

    cancelScheduledWork()
    clearItemState()
    runtime.scope.classList.remove('ecust-page-animating', 'ecust-page-ready')
    runtime.scope.classList.add('ecust-page-settled')
    runtime.container?.setAttribute('data-ecust-animation-ready', 'true')
  }

  const setDelays = (scope) => {
    const hero = scope.querySelector('[data-ecust-animate="hero"]')
    const heading = scope.querySelector('[data-ecust-animate="timeline-heading"]')
    const profile = scope.querySelector('[data-ecust-animate="profile"]')
    const semesters = Array.from(scope.querySelectorAll('[data-ecust-animate="semester"]'))

    hero?.style.setProperty('--ecust-fade-delay', '0ms')
    heading?.style.setProperty('--ecust-fade-delay', '140ms')
    profile?.style.setProperty('--ecust-fade-delay', '240ms')
    semesters.forEach((item, index) => {
      item.style.setProperty('--ecust-fade-delay', `${260 + index * 100}ms`)
    })

    return semesters
  }

  const waitForStylesheet = (container) => {
    const stylesheet = container.querySelector('link[rel="stylesheet"][href*="/css/pages/ecust.css"]')
    if (!stylesheet) return Promise.resolve()

    try {
      if (stylesheet.sheet) return Promise.resolve()
    } catch (error) {
      // The load and error events below remain authoritative for inaccessible sheets.
    }

    return new Promise(resolve => {
      let settled = false
      let fallbackTimer = null
      const finish = () => {
        if (settled) return
        settled = true
        stylesheet.removeEventListener('load', finish)
        stylesheet.removeEventListener('error', finish)
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        if (runtime.styleCleanup === finish) runtime.styleCleanup = null
        resolve()
      }

      stylesheet.addEventListener('load', finish, { once: true })
      stylesheet.addEventListener('error', finish, { once: true })
      fallbackTimer = window.setTimeout(finish, 1500)
      runtime.styleCleanup = finish
    })
  }

  const reveal = (generation) => {
    const firstFrame = window.requestAnimationFrame(() => {
      runtime.frames.delete(firstFrame)
      if (generation !== runtime.generation || !runtime.scope?.isConnected) return

      const secondFrame = window.requestAnimationFrame(() => {
        runtime.frames.delete(secondFrame)
        if (generation !== runtime.generation || !runtime.scope?.isConnected) return

        runtime.scope.classList.add('ecust-page-ready')
        runtime.container.classList.remove('page-animation-pending', 'pjax-content-entering')
        runtime.container.classList.add('page-animation-active')

        const semesters = runtime.items.filter(item => item.dataset.ecustAnimate === 'semester')
        runtime.lastItem = semesters.at(-1) || runtime.items.at(-1) || null
        runtime.lastItemHandler = event => {
          if (event.animationName === 'ecust-opacity-in') settle(generation)
        }
        runtime.lastItem?.addEventListener('animationend', runtime.lastItemHandler)
        runtime.settleTimer = window.setTimeout(() => settle(generation), 1800)
      })
      runtime.frames.add(secondFrame)
    })
    runtime.frames.add(firstFrame)
  }

  const init = async (container = document.getElementById('content-inner')) => {
    const scope = container?.querySelector('.ecust-page-enter')
    if (!container || !scope) return
    if (runtime.container === container && container.dataset.ecustAnimationInitialized === 'true') return

    reset()
    runtime.container = container
    runtime.scope = scope
    runtime.items = Array.from(scope.querySelectorAll('.ecust-animate-item'))
    const generation = runtime.generation

    container.dataset.ecustAnimationInitialized = 'true'
    container.classList.add('page-animation-pending', 'pjax-content-entering')
    scope.classList.remove('ecust-page-ready', 'ecust-page-settled')
    scope.classList.add('ecust-page-animating')
    setDelays(scope)

    await waitForStylesheet(container)
    if (generation !== runtime.generation || !scope.isConnected) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      container.classList.remove('page-animation-pending', 'pjax-content-entering')
      container.classList.add('page-animation-active')
      settle(generation)
      return
    }

    reveal(generation)
  }

  window.EcustAnimation = { init, reset, reveal }
  init()

  if (!window.ecustJourneyPjaxBound) {
    window.ecustJourneyPjaxBound = true
    document.addEventListener('pjax:send', () => window.EcustAnimation.reset())
    document.addEventListener('pjax:complete', () => window.EcustAnimation.init())
    document.addEventListener('pjax:error', () => window.EcustAnimation.reset())
  }
})()
