(() => {
  'use strict'

  if (window.PersonalSpaceOrbit) {
    window.PersonalSpaceOrbit.init()
    return
  }

  const rootSelector = '.personal-star-chart'
  const easing = 'cubic-bezier(0.22, 1, 0.36, 1)'

  const runtime = {
    root: null,
    animations: new Set(),
    frames: new Set(),
    timers: new Set(),
    managedTimers: new Set(),
    svgMotions: new Set(),
    pulseTask: null,
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

  const scheduleManagedTimer = (callback, delay) => {
    const task = {
      callback,
      remaining: delay,
      dueAt: 0,
      timer: null
    }

    const arm = remaining => {
      task.remaining = remaining
      task.dueAt = performance.now() + remaining
      task.timer = window.setTimeout(() => {
        runtime.managedTimers.delete(task)
        task.timer = null
        callback()
      }, remaining)
    }

    task.arm = arm
    runtime.managedTimers.add(task)
    if (!document.hidden) arm(delay)
    return task
  }

  const pauseManagedTimers = () => {
    runtime.managedTimers.forEach(task => {
      if (task.timer === null) return
      window.clearTimeout(task.timer)
      task.timer = null
      task.remaining = Math.max(0, task.dueAt - performance.now())
    })
  }

  const resumeManagedTimers = () => {
    runtime.managedTimers.forEach(task => {
      if (task.timer !== null) return
      task.arm(task.remaining)
    })
  }

  const stopSvgMotions = () => {
    runtime.svgMotions.forEach(motion => {
      try { motion.endElement?.() } catch {}
    })
    runtime.svgMotions.clear()
  }

  const pauseSvgMotions = root => {
    root.querySelectorAll('.personal-orbit__signal').forEach(svg => svg.pauseAnimations?.())
  }

  const resumeSvgMotions = root => {
    root.querySelectorAll('.personal-orbit__signal').forEach(svg => svg.unpauseAnimations?.())
  }

  const clearAsyncWork = () => {
    runtime.animations.forEach(animation => animation.cancel())
    runtime.animations.clear()
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()
    runtime.timers.forEach(timer => window.clearTimeout(timer))
    runtime.timers.clear()
    runtime.managedTimers.forEach(task => {
      if (task.timer !== null) window.clearTimeout(task.timer)
    })
    runtime.managedTimers.clear()
    stopSvgMotions()
  }

  const cleanup = () => {
    clearAsyncWork()
    runtime.generation += 1

    if (runtime.root) {
      runtime.root.classList.remove('is-pulsing')
      runtime.root.querySelectorAll('.personal-orbit').forEach(orbit => orbit.classList.remove('is-signaling'))
      runtime.root.querySelectorAll('.personal-orbit-node').forEach(node => node.classList.remove('is-receiving'))
    }
    runtime.pulseTask = null

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
    if (!document.hidden) startPulseLoop(root, generation)
    scheduleFrame(() => {
      if (generation !== runtime.generation || runtime.root !== root) return
      runtime.animations.forEach(animation => animation.cancel())
      runtime.animations.clear()
    })
  }

  const pulseNow = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || document.hidden) return

    const core = root.querySelector('.personal-star-core')
    if (!core) return

    core.classList.add('is-pulsing')
    scheduleManagedTimer(() => core.classList.remove('is-pulsing'), 820)

    const orbits = Array.from(root.querySelectorAll('.personal-orbit'))
    const nodes = Array.from(root.querySelectorAll('.personal-orbit-node'))
    orbits.forEach((orbit, index) => {
      const motion = orbit.querySelector('.personal-orbit__signal-dot animateMotion')
      const signal = orbit.querySelector('.personal-orbit__signal')
      const delay = 820 + index * 150
      const duration = 1400

      if (!motion || !signal) return

      scheduleManagedTimer(() => {
        if (generation !== runtime.generation || runtime.root !== root || document.hidden) return
        orbit.classList.add('is-signaling')
        if (root.dataset.signalMode === 'smil') {
          runtime.svgMotions.add(motion)
          try { motion.beginElement() } catch {}
        }
      }, delay)

      scheduleManagedTimer(() => {
        if (generation !== runtime.generation || runtime.root !== root) return
        nodes[index]?.classList.add('is-receiving')
      }, delay + duration)

      scheduleManagedTimer(() => {
        orbit.classList.remove('is-signaling')
        nodes[index]?.classList.remove('is-receiving')
        runtime.svgMotions.delete(motion)
      }, delay + duration + 620)
    })
  }

  function startPulseLoop(root, generation) {
    if (runtime.pulseTask || generation !== runtime.generation || runtime.root !== root || document.hidden) return

    runtime.pulseTask = scheduleManagedTimer(() => {
      runtime.pulseTask = null
      pulseNow(root, generation)
      startPulseLoop(root, generation)
    }, 6200)
  }

  const startOpening = (root, generation) => {
    if (generation !== runtime.generation || runtime.root !== root || !root.isConnected) return

    const core = root.querySelector('.personal-star-core')
    const arms = Array.from(root.querySelectorAll('.personal-orbit__arm'))
    const nodes = Array.from(root.querySelectorAll('.personal-orbit-node'))

    if (!core || arms.length !== nodes.length || !arms.length) {
      root.dataset.orbitState = 'ready'
      return
    }

    root.dataset.orbitState = 'opening'

    addAnimation(core.animate([
      { opacity: 0, filter: 'brightness(0.65) blur(2px)' },
      { opacity: 1, filter: 'brightness(1.18) blur(0)' }
    ], {
      duration: 420,
      easing,
      fill: 'both'
    }))

    const openingAnimations = []
    arms.forEach((arm, index) => {
      const radius = arm.offsetWidth
      const delay = 70 + index * 80

      openingAnimations.push(addAnimation(arm.animate([
        { width: '0px' },
        { width: `${radius}px` }
      ], {
        duration: 850,
        delay,
        easing,
        fill: 'both'
      })))

      openingAnimations.push(addAnimation(nodes[index].animate([
        { opacity: 0, transform: 'scale(0.35)' },
        { opacity: 1, transform: 'scale(1)' }
      ], {
        duration: 850,
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
      if (document.hidden) {
        pauseManagedTimers()
        pauseSvgMotions(root)
      } else {
        resumeManagedTimers()
        resumeSvgMotions(root)
        if (root.dataset.orbitState === 'ready') startPulseLoop(root, runtime.generation)
      }
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

    if (runtime.root === root && root.dataset.orbitInitialized === 'true') return true

    cleanup()
    runtime.root = root
    const generation = runtime.generation
    root.dataset.orbitInitialized = 'true'

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

    const signalMotion = root.querySelector('.personal-orbit__signal-dot animateMotion')
    root.dataset.signalMode = typeof signalMotion?.beginElement === 'function' ? 'smil' : 'css'

    if (runtime.motionQuery.matches) {
      root.dataset.orbitReduced = 'true'
      root.dataset.orbitState = 'ready'
      return true
    }

    root.removeAttribute('data-orbit-reduced')
    root.dataset.orbitState = 'pending'
    scheduleTimer(() => startOpening(root, generation), 180)
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
