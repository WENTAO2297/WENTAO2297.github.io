(() => {
  'use strict'

  const itemClass = 'page-animation-item'
  const revealedClass = 'page-animation-revealed'
  const pendingClass = 'page-animation-pending'
  const enteringClass = 'pjax-content-entering'
  const activeClass = 'page-animation-active'

  const runtime = {
    container: null,
    targets: [],
    animationFrames: new Set(),
    styleCleanups: [],
    generation: 0,
    itemClass,
    revealedClass
  }

  const cancelPendingWork = () => {
    runtime.animationFrames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.animationFrames.clear()

    runtime.styleCleanups.splice(0).forEach(cleanup => cleanup())
  }

  const getTargets = (container) => Array.from(container.children)
    .filter(element => !['LINK', 'SCRIPT', 'STYLE'].includes(element.tagName))

  const waitForPageStyles = (container) => {
    const stylesheets = Array.from(container.querySelectorAll('link[rel="stylesheet"]'))

    return Promise.all(stylesheets.map(stylesheet => new Promise(resolve => {
      try {
        if (stylesheet.sheet) {
          resolve()
          return
        }
      } catch (error) {
        // A stylesheet that cannot expose CSS rules can still report load/error below.
      }

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
    })))
  }

  const reset = (container = runtime.container) => {
    cancelPendingWork()
    runtime.generation += 1

    if (!container) {
      runtime.container = null
      runtime.targets = []
      return
    }

    runtime.targets.forEach(target => {
      target.classList.remove(runtime.itemClass, runtime.revealedClass)
      target.style.removeProperty('--delay-index')
    })
    window.GlassCardLifecycle?.reset(container)
    container.classList.remove(pendingClass, enteringClass, activeClass)
    runtime.container = null
    runtime.targets = []
    runtime.itemClass = itemClass
    runtime.revealedClass = revealedClass
  }

  const reveal = (container = runtime.container, generation = runtime.generation) => {
    if (!container || !container.isConnected || generation !== runtime.generation) return

    const firstFrame = window.requestAnimationFrame(() => {
      runtime.animationFrames.delete(firstFrame)
      if (!container.isConnected || generation !== runtime.generation) return

      // Force the browser to calculate layout and glass styles before the reveal frame.
      void container.offsetWidth
      window.GlassCardLifecycle?.forceComposite(container)

      const secondFrame = window.requestAnimationFrame(() => {
        runtime.animationFrames.delete(secondFrame)
        if (!container.isConnected || generation !== runtime.generation) return

        window.GlassCardLifecycle?.ready(container)
        runtime.targets.forEach(target => target.classList.add(runtime.revealedClass))
        container.classList.remove(pendingClass, enteringClass)
        container.classList.add(activeClass)
      })
      runtime.animationFrames.add(secondFrame)
    })
    runtime.animationFrames.add(firstFrame)
  }

  const init = async (container = document.getElementById('content-inner')) => {
    reset()
    if (!container) return

    if (container.querySelector('#home-dashboard')) {
      container.classList.remove(pendingClass, enteringClass)
      return
    }

    if (container.querySelector('.ecust-page-enter')) {
      window.EcustAnimation?.init(container)
      return
    }

    runtime.container = container
    container.classList.add(pendingClass, enteringClass)
    window.GlassCardLifecycle?.prepare(container)
    runtime.targets = getTargets(container)
    runtime.targets.forEach((target, index) => {
      target.classList.remove(runtime.revealedClass)
      target.classList.add(runtime.itemClass)
      target.style.setProperty('--delay-index', String(index))
    })

    const generation = runtime.generation
    await waitForPageStyles(container)
    reveal(container, generation)
  }

  window.PageAnimation = { init, reset, reveal }

  init()

  if (!window.pageAnimationPjaxBound) {
    window.pageAnimationPjaxBound = true
    document.addEventListener('pjax:send', () => window.PageAnimation.reset())
    document.addEventListener('pjax:complete', () => window.PageAnimation.init())
    document.addEventListener('pjax:error', () => window.PageAnimation.reset())
  }
})()
