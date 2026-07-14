(() => {
  'use strict'

  if (window.EcustAnimation) {
    window.EcustAnimation.init()
    return
  }

  const runtime = {
    container: null,
    scope: null,
    cards: [],
    animationFrames: new Set(),
    styleCleanups: [],
    generation: 0
  }

  const cancelPendingWork = () => {
    runtime.animationFrames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.animationFrames.clear()
    runtime.styleCleanups.splice(0).forEach(cleanup => cleanup())
  }

  const reset = () => {
    cancelPendingWork()
    runtime.generation += 1

    runtime.cards.forEach(card => {
      card.classList.remove('ecust-card-enter', 'ecust-card-visible')
      card.style.removeProperty('--ecust-delay-index')
    })

    runtime.scope?.classList.remove('ecust-page-entering', 'ecust-page-ready')
    runtime.container?.classList.remove('page-animation-pending', 'pjax-content-entering', 'page-animation-active')
    runtime.container?.removeAttribute('data-ecust-animation-initialized')
    runtime.container?.removeAttribute('data-ecust-animation-ready')
    runtime.container = null
    runtime.scope = null
    runtime.cards = []
  }

  const waitForStyles = (container) => {
    const stylesheet = container.querySelector('link[rel="stylesheet"][href*="/css/pages/ecust.css"]')
    if (!stylesheet) return Promise.resolve()

    try {
      if (stylesheet.sheet) return Promise.resolve()
    } catch (error) {
      // The load/error events below still provide a safe readiness boundary.
    }

    return new Promise(resolve => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        stylesheet.removeEventListener('load', finish)
        stylesheet.removeEventListener('error', finish)
        resolve()
      }

      stylesheet.addEventListener('load', finish, { once: true })
      stylesheet.addEventListener('error', finish, { once: true })
      runtime.styleCleanups.push(finish)
    })
  }

  const reveal = (generation) => {
    const { container, scope, cards } = runtime
    if (!container?.isConnected || !scope?.isConnected || generation !== runtime.generation) return

    const layoutFrame = window.requestAnimationFrame(() => {
      runtime.animationFrames.delete(layoutFrame)
      if (!container.isConnected || generation !== runtime.generation) return

      void scope.offsetWidth
      cards.forEach(card => window.getComputedStyle(card).backgroundColor)

      const revealFrame = window.requestAnimationFrame(() => {
        runtime.animationFrames.delete(revealFrame)
        if (!container.isConnected || generation !== runtime.generation) return

        cards.forEach(card => card.classList.add('ecust-card-visible'))
        scope.classList.remove('ecust-page-entering')
        scope.classList.add('ecust-page-ready')
        container.classList.remove('page-animation-pending', 'pjax-content-entering')
        container.classList.add('page-animation-active')
        container.setAttribute('data-ecust-animation-ready', 'true')
      })
      runtime.animationFrames.add(revealFrame)
    })
    runtime.animationFrames.add(layoutFrame)
  }

  const init = async (container = document.getElementById('content-inner')) => {
    const scope = container?.querySelector('.ecust-page-enter')
    if (!container || !scope) return
    if (runtime.container === container && container.dataset.ecustAnimationInitialized === 'true') return

    reset()
    runtime.container = container
    runtime.scope = scope
    runtime.cards = Array.from(scope.querySelectorAll(':scope > .semester-card'))
    container.setAttribute('data-ecust-animation-initialized', 'true')

    container.classList.add('page-animation-pending', 'pjax-content-entering')
    scope.classList.add('ecust-page-entering')
    runtime.cards.forEach((card, index) => {
      card.classList.remove('ecust-card-visible')
      card.classList.add('ecust-card-enter')
      card.style.setProperty('--ecust-delay-index', String(index))
    })

    const generation = runtime.generation
    await waitForStyles(container)
    reveal(generation)
  }

  window.EcustAnimation = { init, reset, reveal }
  init()

  document.addEventListener('pjax:send', reset)
  document.addEventListener('pjax:complete', () => init())
  document.addEventListener('pjax:error', reset)
})()
