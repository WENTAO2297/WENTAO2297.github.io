(() => {
  'use strict'

  if (window.StudyJourney) {
    window.StudyJourney.init()
    return
  }

  const rootSelector = '.study-journey'
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const routeDuration = 820
  const routeToNodesGap = 80
  const nodeStagger = 140
  const nodeDuration = 380

  const runtime = {
    root: null,
    animations: new Set(),
    frames: new Set(),
    timers: new Set(),
    generation: 0,
    motionQuery: null,
    motionHandler: null,
    visibilityHandler: null
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

  const resetRoot = root => {
    if (!root) return

    root.removeAttribute('data-journey-initialized')
    root.removeAttribute('data-journey-state')

    const route = root.querySelector('.study-route__progress')
    route?.style.removeProperty('stroke-dasharray')
    route?.style.removeProperty('stroke-dashoffset')

    root.querySelectorAll('.study-node').forEach(node => {
      node.style.removeProperty('opacity')
      node.style.removeProperty('transform')
    })
  }

  const cleanup = () => {
    clearAsyncWork()
    runtime.generation += 1

    if (runtime.visibilityHandler) {
      document.removeEventListener('visibilitychange', runtime.visibilityHandler)
      runtime.visibilityHandler = null
    }

    if (runtime.motionQuery && runtime.motionHandler) {
      runtime.motionQuery.removeEventListener?.('change', runtime.motionHandler)
      runtime.motionQuery.removeListener?.(runtime.motionHandler)
    }

    runtime.motionQuery = null
    runtime.motionHandler = null
    resetRoot(runtime.root)
    runtime.root = null
  }

  const showStatic = (root, route, nodes) => {
    root.dataset.journeyState = 'is-journey-ready'
    route.style.strokeDasharray = 'none'
    route.style.strokeDashoffset = '0'
    nodes.forEach(node => {
      node.style.opacity = '1'
      node.style.transform = 'none'
    })
  }

  const finishJourney = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return
    root.dataset.journeyState = 'is-journey-ready'
  }

  const startNodes = (root, nodes, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    root.dataset.journeyState = 'is-nodes-entering'
    const openingAnimations = nodes.map((node, index) => addAnimation(node.animate([
      { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.94)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
    ], {
      duration: nodeDuration,
      delay: index * nodeStagger,
      easing,
      fill: 'both'
    })))

    Promise.allSettled(openingAnimations.map(animation => animation.finished))
      .then(() => finishJourney(root, generation))
  }

  const startRoute = (root, route, nodes, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    root.dataset.journeyState = 'is-route-drawing'
    const length = route.getTotalLength()
    route.style.strokeDasharray = `${length}px`
    route.style.strokeDashoffset = `${length}px`

    const routeAnimation = addAnimation(route.animate([
      { strokeDashoffset: `${length}px` },
      { strokeDashoffset: '0px' }
    ], {
      duration: routeDuration,
      easing,
      fill: 'forwards'
    }))

    routeAnimation.finished
      .then(() => {
        if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return
        root.dataset.journeyState = 'is-route-complete'
        scheduleTimer(() => startNodes(root, nodes, generation), routeToNodesGap)
      })
      .catch(() => {})
  }

  const bindPageEvents = root => {
    runtime.visibilityHandler = () => {
      root.toggleAttribute('data-journey-page-hidden', document.hidden)
    }
    document.addEventListener('visibilitychange', runtime.visibilityHandler)
    runtime.visibilityHandler()
  }

  const init = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      return false
    }

    if (runtime.root === root && root.dataset.journeyInitialized === 'true') return true

    cleanup()
    runtime.root = root
    const generation = runtime.generation
    const route = root.querySelector('.study-route__progress')
    const nodes = Array.from(root.querySelectorAll('.study-node'))

    root.dataset.journeyInitialized = 'true'
    if (!route || nodes.length !== 3) {
      root.dataset.journeyState = 'is-journey-ready'
      return true
    }

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
      showStatic(root, route, nodes)
      return true
    }

    root.dataset.journeyState = 'is-route-drawing'
    scheduleFrame(() => startRoute(root, route, nodes, generation))
    return true
  }

  window.StudyJourney = { init, cleanup }
  init()

  if (!window.studyJourneyPjaxBound) {
    window.studyJourneyPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', init)
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      init()
    })
  }
})()
