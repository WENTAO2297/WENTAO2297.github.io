/**
 * Small, page-scoped resource registry for PJAX-aware scripts.
 *
 * Page modules register timers, animation frames, Web Animations, listeners,
 * observers, and final cleanup callbacks here so one destroy call can release
 * everything owned by the current page instance.
 *
 * @typedef {{name?: string}} PageRuntimeOptions
 * @typedef {() => void} CleanupCallback
 */
(() => {
  'use strict'

  if (window.SitePageRuntime?.create) return

  /**
   * Create an isolated lifecycle registry for one page instance.
   *
   * @param {PageRuntimeOptions} options
   * @returns {Object} Frozen page runtime API.
   */
  const create = ({ name = 'page' } = {}) => {
    let runtimeDestroyed = false
    const timerIds = new Set()
    const frameIds = new Set()
    const activeAnimations = new Set()
    const listenerRecords = []
    const activeObservers = new Set()
    /** @type {CleanupCallback[]} */
    const cleanupCallbacks = []

    const removeListener = record => {
      const index = listenerRecords.indexOf(record)
      if (index >= 0) listenerRecords.splice(index, 1)
      record.remove()
    }

    const addTimer = id => {
      if (!runtimeDestroyed && id !== null && id !== undefined) timerIds.add(id)
      return id
    }

    const removeTimer = id => {
      if (id !== null && id !== undefined) timerIds.delete(id)
    }

    const addFrame = id => {
      if (!runtimeDestroyed && id !== null && id !== undefined) frameIds.add(id)
      return id
    }

    const removeFrame = id => {
      if (id !== null && id !== undefined) frameIds.delete(id)
    }

    const addAnimation = animation => {
      if (!animation) return animation
      if (runtimeDestroyed) {
        try { animation.cancel?.() } catch {}
        return animation
      }
      activeAnimations.add(animation)
      const finished = animation.finished
      if (finished && typeof finished.then === 'function') {
        Promise.resolve(finished).catch(() => {}).finally(() => activeAnimations.delete(animation))
      }
      return animation
    }

    const removeAnimation = animation => activeAnimations.delete(animation)

    const forEachAnimation = callback => activeAnimations.forEach(callback)

    const addListener = (target, event, handler, options) => {
      if (runtimeDestroyed || !target) return () => {}
      const add = typeof target.addEventListener === 'function'
        ? target.addEventListener.bind(target)
        : typeof target.addListener === 'function'
          ? target.addListener.bind(target)
          : null
      if (!add) return () => {}

      const remove = typeof target.removeEventListener === 'function'
        ? target.removeEventListener.bind(target)
        : typeof target.removeListener === 'function'
          ? target.removeListener.bind(target)
          : null
      add(event, handler, options)
      const record = {
        remove: () => remove?.(event, handler, options)
      }
      listenerRecords.push(record)
      return () => removeListener(record)
    }

    const addObserver = observer => {
      if (!observer) return observer
      if (runtimeDestroyed) {
        try { observer.disconnect?.() } catch {}
        return observer
      }
      activeObservers.add(observer)
      return observer
    }

    const addCleanup = cleanup => {
      if (typeof cleanup !== 'function') return cleanup
      if (runtimeDestroyed) {
        try { cleanup() } catch {}
      } else {
        cleanupCallbacks.push(cleanup)
      }
      return cleanup
    }

    /**
     * Release page resources once. The order is deliberate: cancel work first,
     * then detach listeners and observers, and finally run module cleanups.
     * Each collection is cleared as it is processed, so repeated destroy calls
     * remain safe and cannot run callbacks twice.
     */
    const destroy = () => {
      if (runtimeDestroyed) return
      runtimeDestroyed = true

      timerIds.forEach(id => window.clearTimeout(id))
      timerIds.clear()
      frameIds.forEach(id => window.cancelAnimationFrame(id))
      frameIds.clear()
      activeAnimations.forEach(animation => {
        try { animation.cancel?.() } catch {}
      })
      activeAnimations.clear()
      listenerRecords.splice(0).reverse().forEach(record => record.remove())
      activeObservers.forEach(observer => {
        try { observer.disconnect?.() } catch {}
      })
      activeObservers.clear()
      cleanupCallbacks.splice(0).reverse().forEach(cleanup => {
        try { cleanup() } catch {}
      })
    }

    return Object.freeze({
      name,
      addTimer,
      removeTimer,
      addFrame,
      removeFrame,
      addAnimation,
      removeAnimation,
      forEachAnimation,
      addListener,
      addObserver,
      addCleanup,
      isDestroyed: () => runtimeDestroyed,
      destroy
    })
  }

  window.SitePageRuntime = Object.freeze({ create })
})()
