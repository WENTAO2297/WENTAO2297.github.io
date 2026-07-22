(() => {
  'use strict'

  if (window.PersonalSpaceOrbit) {
    window.PersonalSpaceOrbit.init()
    return
  }

  const rootSelector = '.personal-star-chart'
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const openingTiming = Object.freeze({
    scheduleDelay: 180,
    coreDuration: 420,
    orbitDuration: 850,
    firstDelay: 70,
    stagger: 80
  })

  const runtime = {
    root: null,
    animations: new Set(),
    frames: new Set(),
    timers: new Set(),
    generation: 0,
    visibilityHandler: null,
    keyboardHandler: null,
    motionQuery: null,
    motionHandler: null
  }

  const addAnimation = animation => {
    runtime.animations.add(animation)
    animation.finished.catch(() => {}).finally(() => runtime.animations.delete(animation))
    return animation
  }

  const scheduleFrame = callback => {
    const frame = window.requestAnimationFrame(() => {
      runtime.frames.delete(frame)
      callback()
    })
    runtime.frames.add(frame)
    return frame
  }

  const scheduleTimer = (callback, delay) => {
    const timer = window.setTimeout(() => {
      runtime.timers.delete(timer)
      callback()
    }, delay)
    runtime.timers.add(timer)
    return timer
  }

  const clearAsyncWork = () => {
    runtime.animations.forEach(animation => animation.cancel())
    runtime.animations.clear()
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()
    runtime.timers.forEach(timer => window.clearTimeout(timer))
    runtime.timers.clear()
  }

  const revealOrbitItems = root => {
    root.querySelectorAll('.personal-orbit').forEach(orbit => orbit.classList.remove('is-orbit-pending'))
  }

  const cleanup = () => {
    clearAsyncWork()
    runtime.generation += 1

    if (runtime.root) {
      runtime.root.dataset.orbitState = 'pending'
      runtime.root.querySelectorAll('.personal-orbit').forEach(orbit => orbit.classList.add('is-orbit-pending'))
    }

    if (runtime.visibilityHandler) {
      document.removeEventListener('visibilitychange', runtime.visibilityHandler)
      runtime.visibilityHandler = null
    }

    if (runtime.keyboardHandler && runtime.root) {
      runtime.root.removeEventListener('keydown', runtime.keyboardHandler)
      runtime.keyboardHandler = null
    }

    if (runtime.motionQuery && runtime.motionHandler) {
      runtime.motionQuery.removeEventListener?.('change', runtime.motionHandler)
      runtime.motionQuery.removeListener?.(runtime.motionHandler)
    }

    runtime.motionQuery = null
    runtime.motionHandler = null
    runtime.root = null
  }

  const finishOpening = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    root.dataset.orbitState = 'ready'
    scheduleFrame(() => {
      if (generation !== runtime.generation || runtime.root !== root) return
      runtime.animations.forEach(animation => animation.cancel())
      runtime.animations.clear()
    })
  }

  const startOpening = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

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

    addAnimation(core.animate([
      { opacity: 0, filter: 'brightness(0.65) blur(2px)' },
      { opacity: 1, filter: 'brightness(1.18) blur(0)' }
    ], {
      duration: openingTiming.coreDuration,
      easing,
      fill: 'both'
    }))

    const openingAnimations = []
    arms.forEach((arm, index) => {
      const radius = arm.offsetWidth
      const delay = openingTiming.firstDelay + index * openingTiming.stagger

      openingAnimations.push(addAnimation(arm.animate([
        { width: '0px' },
        { width: `${radius}px` }
      ], {
        duration: openingTiming.orbitDuration,
        delay,
        easing,
        fill: 'both'
      })))

      openingAnimations.push(addAnimation(nodes[index].animate([
        { opacity: 0, transform: 'scale(0.35)' },
        { opacity: 0, transform: 'scale(0.42)', offset: 0.18 },
        { opacity: 0.18, transform: 'scale(0.54)', offset: 0.42 },
        { opacity: 1, transform: 'scale(1)' }
      ], {
        duration: openingTiming.orbitDuration,
        delay,
        easing,
        fill: 'both'
      })))
    })

    Promise.allSettled(openingAnimations.map(animation => animation.finished))
      .then(() => finishOpening(root, generation))
  }

  const bindPageEvents = root => {
    runtime.visibilityHandler = () => {
      root.toggleAttribute('data-orbit-page-hidden', document.hidden)
    }
    document.addEventListener('visibilitychange', runtime.visibilityHandler)
    runtime.visibilityHandler()

    runtime.keyboardHandler = event => {
      const link = event.target.closest?.('.personal-orbit-node--open')
      if (!link || !root.contains(link)) return

      const isEnter = event.key === 'Enter' || event.key === 'Return'
      const isSpace = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
      if (!isEnter && !isSpace) return

      event.preventDefault()
      link.click()
    }
    root.addEventListener('keydown', runtime.keyboardHandler)
  }

  const init = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      return false
    }

    if (runtime.root === root) return true

    cleanup()
    runtime.root = root
    const generation = runtime.generation

    runtime.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    runtime.motionHandler = () => {
      cleanup()
      init()
    }
    if (runtime.motionQuery.addEventListener) {
      runtime.motionQuery.addEventListener('change', runtime.motionHandler)
    } else {
      runtime.motionQuery.addListener?.(runtime.motionHandler)
    }

    bindPageEvents(root)

    if (runtime.motionQuery.matches) {
      root.dataset.orbitState = 'ready'
      revealOrbitItems(root)
      return true
    }

    root.dataset.orbitState = 'pending'
    scheduleTimer(() => {
      try {
        startOpening(root, generation)
      } catch {
        if (generation !== runtime.generation || runtime.root !== root) return
        clearAsyncWork()
        revealOrbitItems(root)
        root.dataset.orbitState = 'ready'
      }
    }, openingTiming.scheduleDelay)
    return true
  }

  window.PersonalSpaceOrbit = { init, cleanup }
  init()

  if (!window.personalSpaceOrbitPjaxBound) {
    window.personalSpaceOrbitPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', init)
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      init()
    })
  }
})()
