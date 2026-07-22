(() => {
  'use strict'

  if (window.StudyJourney) {
    window.StudyJourney.init()
    return
  }

  const rootSelector = '.study-journey'
  const easing = 'cubic-bezier(0.33, 0, 0.2, 1)'
  const routeDuration = 1000
  const routeToNodesGap = 80
  const nodeStagger = 140
  const nodeDuration = 380
  const expectedNodeCount = 3
  const journeyStates = Object.freeze({
    drawing: 'is-route-drawing',
    routeComplete: 'is-route-complete',
    nodesEntering: 'is-nodes-entering',
    ready: 'is-journey-ready'
  })

  const runtime = {
    root: null,
    animations: new Set(),
    frames: new Set(),
    timers: new Set(),
    generation: 0,
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

  const resetRoot = root => {
    if (!root) return

    root.removeAttribute('data-journey-initialized')
    root.removeAttribute('data-journey-state')

    const routeMask = root.querySelector('.study-route__mask')
    routeMask?.style.removeProperty('--study-route-length')
    routeMask?.style.removeProperty('stroke-dasharray')
    routeMask?.style.removeProperty('stroke-dashoffset')

    root.querySelectorAll('.study-node').forEach(node => {
      node.style.removeProperty('opacity')
      node.style.removeProperty('transform')
    })
  }

  const cleanup = () => {
    clearAsyncWork()
    runtime.generation += 1

    if (runtime.motionQuery && runtime.motionHandler) {
      runtime.motionQuery.removeEventListener?.('change', runtime.motionHandler)
      runtime.motionQuery.removeListener?.(runtime.motionHandler)
    }

    runtime.motionQuery = null
    runtime.motionHandler = null
    resetRoot(runtime.root)
    runtime.root = null
  }

  const showStatic = (root, routeMask, nodes) => {
    root.dataset.journeyState = journeyStates.ready
    routeMask?.style.setProperty('stroke-dashoffset', '0px')
    nodes.forEach(node => {
      node.style.opacity = '1'
      node.style.transform = 'none'
    })
  }

  const finishJourney = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return
    root.dataset.journeyState = journeyStates.ready
  }

  const startNodes = (root, nodes, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    root.dataset.journeyState = journeyStates.nodesEntering
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

  const finishRoute = (root, routeMask, nodes, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return
    routeMask.style.setProperty('stroke-dashoffset', '0px')
    root.dataset.journeyState = journeyStates.routeComplete
    scheduleTimer(() => startNodes(root, nodes, generation), routeToNodesGap)
  }

  const startRoute = (root, routeMask, routeLength, nodes, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    root.dataset.journeyState = journeyStates.drawing
    const routeAnimation = addAnimation(routeMask.animate([
      { strokeDashoffset: `${routeLength}px` },
      { strokeDashoffset: '0px' }
    ], {
      duration: routeDuration,
      easing,
      fill: 'both'
    }))

    routeAnimation.finished.then(() => finishRoute(root, routeMask, nodes, generation))
      .catch(() => finishRoute(root, routeMask, nodes, generation))
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
    const routeMask = root.querySelector('.study-route__mask')
    const nodes = Array.from(root.querySelectorAll('.study-node'))

    root.dataset.journeyInitialized = 'true'
    if (!routeMask || nodes.length !== expectedNodeCount) {
      showStatic(root, routeMask, nodes)
      return true
    }

    const routeLength = routeMask.getTotalLength()
    routeMask.style.setProperty('--study-route-length', `${routeLength}px`)

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

    if (runtime.motionQuery.matches) {
      showStatic(root, routeMask, nodes)
      return true
    }

    root.dataset.journeyState = journeyStates.drawing
    scheduleFrame(() => startRoute(root, routeMask, routeLength, nodes, generation))
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
