(() => {
  'use strict'

  if (window.PersonalSpaceOrbit) {
    window.PersonalSpaceOrbit.init()
    return
  }

  const rootSelector = '.personal-star-chart'
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const orbitOpeningTiming = Object.freeze({
    scheduleDelayMs: 180,
    coreDurationMs: 420,
    orbitDurationMs: 850,
    firstNodeDelayMs: 70,
    nodeStaggerMs: 80
  })

  const pageState = {
    root: null,
    lifecycle: null,
    generation: 0
  }

  const isLive = (root, generation, lifecycle) => {
    return generation === pageState.generation
      && pageState.root === root
      && pageState.lifecycle === lifecycle
      && !lifecycle.isDestroyed()
      && root.isConnected
  }

  const addAnimation = (lifecycle, animation) => {
    lifecycle.addAnimation(animation)
    return animation
  }

  const scheduleFrame = (lifecycle, callback) => {
    let frame
    frame = window.requestAnimationFrame(() => {
      lifecycle.removeFrame(frame)
      callback()
    })
    return lifecycle.addFrame(frame)
  }

  const scheduleTimer = (lifecycle, callback, delay) => {
    let timer
    timer = window.setTimeout(() => {
      lifecycle.removeTimer(timer)
      callback()
    }, delay)
    return lifecycle.addTimer(timer)
  }

  const revealOrbitItems = root => {
    root.querySelectorAll('.personal-orbit').forEach(orbit => orbit.classList.remove('is-orbit-pending'))
  }

  const cleanup = () => {
    const root = pageState.root
    pageState.generation += 1

    if (root) {
      root.dataset.orbitState = 'pending'
      root.querySelectorAll('.personal-orbit').forEach(orbit => orbit.classList.add('is-orbit-pending'))
    }

    pageState.lifecycle?.destroy()
    pageState.lifecycle = null
    pageState.root = null
  }

  const finishOpening = (root, generation, lifecycle) => {
    if (!isLive(root, generation, lifecycle)) return

    root.dataset.orbitState = 'ready'
    scheduleFrame(lifecycle, () => {
      if (!isLive(root, generation, lifecycle)) return
      lifecycle.forEachAnimation(animation => {
        try { animation.cancel() } catch {}
      })
    })
  }

  const startOpening = (root, generation, lifecycle) => {
    if (!isLive(root, generation, lifecycle)) return

    const core = root.querySelector('.personal-star-core')
    const arms = Array.from(root.querySelectorAll('.personal-orbit__arm'))
    const nodes = Array.from(root.querySelectorAll('.personal-orbit-node'))

    if (!core || arms.length !== nodes.length || !arms.length) {
      revealOrbitItems(root)
      root.dataset.orbitState = 'ready'
      return
    }

    root.dataset.orbitState = 'opening'
    revealOrbitItems(root)

    addAnimation(lifecycle, core.animate([
      { opacity: 0, filter: 'brightness(0.65) blur(2px)' },
      { opacity: 1, filter: 'brightness(1.18) blur(0)' }
    ], {
      duration: orbitOpeningTiming.coreDurationMs,
      easing,
      fill: 'both'
    }))

    const openingAnimations = []
    arms.forEach((arm, index) => {
      const radius = arm.offsetWidth
      const delay = orbitOpeningTiming.firstNodeDelayMs + index * orbitOpeningTiming.nodeStaggerMs

      openingAnimations.push(addAnimation(lifecycle, arm.animate([
        { width: '0px' },
        { width: `${radius}px` }
      ], {
        duration: orbitOpeningTiming.orbitDurationMs,
        delay,
        easing,
        fill: 'both'
      })))

      openingAnimations.push(addAnimation(lifecycle, nodes[index].animate([
        { opacity: 0, transform: 'scale(0.35)' },
        { opacity: 0, transform: 'scale(0.42)', offset: 0.18 },
        { opacity: 0.18, transform: 'scale(0.54)', offset: 0.42 },
        { opacity: 1, transform: 'scale(1)' }
      ], {
        duration: orbitOpeningTiming.orbitDurationMs,
        delay,
        easing,
        fill: 'both'
      })))
    })

    Promise.allSettled(openingAnimations.map(animation => animation.finished))
      .then(() => finishOpening(root, generation, lifecycle))
  }

  const bindPageEvents = (root, lifecycle) => {
    const handleVisibilityChange = () => {
      root.toggleAttribute('data-orbit-page-hidden', document.hidden)
    }
    lifecycle.addListener(document, 'visibilitychange', handleVisibilityChange)
    handleVisibilityChange()

    const handleOrbitKeydown = event => {
      const link = event.target.closest?.('.personal-orbit-node--open')
      if (!link || !root.contains(link)) return

      const isEnter = event.key === 'Enter' || event.key === 'Return'
      const isSpace = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
      if (!isEnter && !isSpace) return

      event.preventDefault()
      link.click()
    }
    lifecycle.addListener(root, 'keydown', handleOrbitKeydown)
  }

  const initializePersonalSpacePage = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      return false
    }

    if (pageState.root === root) return true

    cleanup()
    const lifecycle = window.SitePageRuntime?.create?.({ name: 'personal-space' })
    if (!lifecycle) return false

    pageState.root = root
    pageState.lifecycle = lifecycle
    const generation = pageState.generation

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionHandler = () => {
      cleanup()
      initializePersonalSpacePage()
    }
    lifecycle.addListener(motionQuery, 'change', motionHandler)

    bindPageEvents(root, lifecycle)

    if (motionQuery.matches) {
      root.dataset.orbitState = 'ready'
      revealOrbitItems(root)
      window.SiteReadiness?.markPageReady({ page: 'personal-space', reason: 'orbit-layout-ready' })
      return true
    }

    root.dataset.orbitState = 'pending'
    window.SiteReadiness?.markPageReady({ page: 'personal-space', reason: 'orbit-layout-ready' })
    scheduleTimer(lifecycle, () => {
      try {
        startOpening(root, generation, lifecycle)
      } catch {
        if (!isLive(root, generation, lifecycle)) return
        lifecycle.forEachAnimation(animation => {
          try { animation.cancel() } catch {}
        })
        revealOrbitItems(root)
        root.dataset.orbitState = 'ready'
      }
    }, orbitOpeningTiming.scheduleDelayMs)
    return true
  }

  window.PersonalSpaceOrbit = { init: initializePersonalSpacePage, cleanup }
  initializePersonalSpacePage()

  if (!window.personalSpaceOrbitPjaxBound) {
    window.personalSpaceOrbitPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', initializePersonalSpacePage)
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      initializePersonalSpacePage()
    })
  }
})()
