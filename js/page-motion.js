(() => {
  'use strict'

  if (window.PageMotion) {
    window.PageMotion.init()
    return
  }

  const containerPendingClass = 'page-motion-pending'
  const containerEnteringClass = 'page-motion-entering'
  const containerActiveClass = 'page-motion-active'
  const itemClass = 'page-motion-item'
  const itemPendingClass = 'page-motion-item-pending'
  const itemPrerenderClass = 'page-motion-item-prerender'
  const itemVisibleClass = 'page-motion-item-visible'

  const runtime = {
    container: null,
    frames: new Set(),
    styleCleanups: [],
    useGlassLifecycle: false,
    generation: 0,
    replayGeneration: 0
  }

  const uniqueElements = elements => Array.from(new Set(elements.filter(Boolean)))

  const queryAll = (scope, selector) => scope ? Array.from(scope.querySelectorAll(selector)) : []

  const getCurrentContainer = () => document.getElementById('content-inner')

  const isHidden = element => Boolean(element.closest('[hidden]'))

  const getMotionGroup = element => {
    const group = Number.parseInt(element.dataset.motionGroup || '0', 10)
    return Number.isFinite(group) && group >= 0 ? group : 0
  }

  const getMotionOrder = element => {
    const order = Number.parseInt(element.dataset.motionOrder || '0', 10)
    return Number.isFinite(order) && order >= 0 ? order : 0
  }

  const scanDeclarativeTargets = scope => {
    if (!scope) return []

    const targets = []
    if (scope.matches?.('[data-page-motion]')) targets.push(scope)
    targets.push(...queryAll(scope, '[data-page-motion]'))

    return uniqueElements(targets)
      .filter(target => !isHidden(target))
      .sort((a, b) => getMotionGroup(a) - getMotionGroup(b) || getMotionOrder(a) - getMotionOrder(b))
  }

  const directChildren = element => element
    ? Array.from(element.children).filter(child => !['LINK', 'SCRIPT', 'STYLE'].includes(child.tagName))
    : []

  const asideTargets = container => queryAll(container, '#aside-content .card-widget')

  const normalizeGroups = groups => {
    const claimed = new Set()

    return groups.map(group => uniqueElements(group).filter(element => {
      if (claimed.has(element)) return false
      claimed.add(element)
      return true
    }))
  }

  const planNotes = container => {
    const root = container.querySelector('.notes-page')
    const search = queryAll(root, '.notes-search-shell')
    const heading = queryAll(root, '.notes-heading')
    const content = queryAll(root, '.notes-entry, .notes-empty')

    return {
      groups: [search, heading, content],
      useGlassLifecycle: false
    }
  }

  const planEcust = container => {
    const root = container.querySelector('.ecust-journey')
    const hero = queryAll(root, '.ecust-heading')
    const motto = queryAll(root, '.ecust-motto')
    const entries = queryAll(root, '.ecust-entry')

    return {
      groups: [hero, motto, entries],
      useGlassLifecycle: false
    }
  }

  const planPost = container => {
    const root = container.querySelector('#post')
    const children = directChildren(root)
    const localHero = children.filter(child => child.id === 'post-info')
    const content = children.filter(child => child.id === 'article-container')
    const secondary = children.filter(child => !localHero.includes(child) && !content.includes(child))

    return {
      groups: [localHero, content, [...secondary, ...asideTargets(container)]],
      useGlassLifecycle: true
    }
  }

  const planCollection = (container, pageType) => {
    const root = container.querySelector(`#${pageType}`)
    const title = queryAll(root, '.article-sort-title')
    const sortedItems = queryAll(root, '.article-sort-item')
    const postItems = queryAll(container, '#recent-posts .recent-post-item')
    const content = sortedItems.length
      ? sortedItems
      : postItems.length
        ? postItems
        : queryAll(root, '.article-sort, #recent-posts')
    const secondary = queryAll(root, '.pagination, #pagination')

    return {
      groups: [title, content, [...secondary, ...asideTargets(container)]],
      useGlassLifecycle: true
    }
  }

  const planGenericPage = container => {
    const root = container.querySelector('#page') || container.firstElementChild
    const children = directChildren(root)
    const title = children.filter(child => child.classList.contains('page-title'))
    const secondary = children.filter(child => child.id === 'post-comment')
    const content = children.filter(child => !title.includes(child) && !secondary.includes(child))
    const fallbackContent = content.length || title.length ? content : [root]

    return {
      groups: [title, fallbackContent, [...secondary, ...asideTargets(container)]],
      useGlassLifecycle: true
    }
  }

  const getPlan = container => {
    if (!container || container.querySelector('#home-dashboard')) return null

    const declarativeTargets = scanDeclarativeTargets(container)
    if (declarativeTargets.length) {
      const highestGroup = Math.max(...declarativeTargets.map(getMotionGroup))
      const groups = Array.from({ length: highestGroup + 1 }, () => [])
      declarativeTargets.forEach(target => groups[getMotionGroup(target)].push(target))

      return {
        groups,
        useGlassLifecycle: false
      }
    }

    if (container.querySelector('.notes-page')) return planNotes(container)
    if (container.querySelector('.ecust-journey')) return planEcust(container)

    const pageType = container.dataset.pageType || ''
    if (pageType === 'post' || container.querySelector('#post')) return planPost(container)
    if (['archive', 'category', 'tag'].includes(pageType)) return planCollection(container, pageType)
    return planGenericPage(container)
  }

  const isCurrent = (generation, container = runtime.container) => (
    generation === runtime.generation &&
    container?.isConnected &&
    runtime.container === container &&
    getCurrentContainer() === container
  )

  const scheduleFrame = callback => {
    const frame = window.requestAnimationFrame(() => {
      runtime.frames.delete(frame)
      callback()
    })
    runtime.frames.add(frame)
  }

  const clearTarget = target => {
    target.getAnimations?.().forEach(animation => {
      if (animation.animationName === 'page-motion-reveal') animation.cancel()
    })
    target.classList.remove(itemClass, itemPendingClass, itemPrerenderClass, itemVisibleClass)
    target.style.removeProperty('--page-motion-group')
    target.removeAttribute('data-page-motion-replay')
  }

  const scanActiveTargets = container => queryAll(container, `.${itemClass}`)

  const clearTargets = container => {
    queryAll(container, `.${itemClass}, .${itemPendingClass}, .${itemPrerenderClass}, .${itemVisibleClass}, [data-page-motion-replay]`)
      .forEach(clearTarget)
  }

  const clearReplayTargets = container => {
    queryAll(container, '[data-page-motion-replay]').forEach(clearTarget)
  }

  const clearContainerState = container => {
    container?.classList.remove(
      containerPendingClass,
      containerEnteringClass,
      containerActiveClass
    )
    container?.removeAttribute('data-page-motion-initialized')
  }

  const cleanup = () => {
    runtime.frames.forEach(frame => window.cancelAnimationFrame(frame))
    runtime.frames.clear()
    runtime.styleCleanups.splice(0).forEach(cleanupStyle => cleanupStyle())
    runtime.generation += 1
    runtime.replayGeneration += 1

    clearTargets(runtime.container)
    clearContainerState(runtime.container)

    runtime.container = null
    runtime.useGlassLifecycle = false
  }

  const recover = (container, generation) => {
    if (generation !== runtime.generation || runtime.container !== container) return false

    cleanup()
    clearTargets(container)
    clearContainerState(container)
    return false
  }

  const waitForPageStyles = container => {
    const stylesheets = Array.from(container.querySelectorAll('link[rel="stylesheet"]'))

    return Promise.all(stylesheets.map(stylesheet => new Promise(resolve => {
      try {
        if (stylesheet.sheet) {
          resolve()
          return
        }
      } catch {
        // The load/error events below remain authoritative for inaccessible sheets.
      }

      let settled = false
      let fallbackTimer = null
      const finish = () => {
        if (settled) return
        settled = true
        stylesheet.removeEventListener('load', finish)
        stylesheet.removeEventListener('error', finish)
        if (fallbackTimer) window.clearTimeout(fallbackTimer)
        const cleanupIndex = runtime.styleCleanups.indexOf(finish)
        if (cleanupIndex >= 0) runtime.styleCleanups.splice(cleanupIndex, 1)
        resolve()
      }

      stylesheet.addEventListener('load', finish, { once: true })
      stylesheet.addEventListener('error', finish, { once: true })
      fallbackTimer = window.setTimeout(finish, 1500)
      runtime.styleCleanups.push(finish)
    })))
  }

  const prepare = (container = getCurrentContainer()) => {
    if (!container || container !== getCurrentContainer()) return null
    const plan = getPlan(container)
    if (!plan) return null

    cleanup()
    const groups = normalizeGroups(plan.groups)
    runtime.container = container
    runtime.useGlassLifecycle = plan.useGlassLifecycle

    container.dataset.pageMotionInitialized = 'true'
    container.classList.remove(containerActiveClass)
    container.classList.add(containerPendingClass, containerEnteringClass)

    if (runtime.useGlassLifecycle) window.GlassCardLifecycle?.prepare(container)

    groups.forEach((group, groupIndex) => {
      group.forEach(target => {
        target.classList.remove(itemPrerenderClass, itemVisibleClass)
        target.classList.add(itemClass, itemPendingClass)
        target.style.setProperty('--page-motion-group', String(groupIndex))
      })
    })

    return runtime.generation
  }

  const measure = (generation = runtime.generation, container = runtime.container) => {
    if (!isCurrent(generation, container)) return false

    const targets = scanActiveTargets(container)

    targets.forEach(element => {
      void element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      void style.backgroundColor
      void style.backdropFilter
      void style.webkitBackdropFilter
    })

    if (runtime.useGlassLifecycle) window.GlassCardLifecycle?.forceComposite(runtime.container)

    targets.forEach(target => {
      target.classList.remove(itemPendingClass)
      target.classList.add(itemPrerenderClass)
      void target.offsetWidth
    })
    return true
  }

  const reveal = (generation = runtime.generation, container = runtime.container) => {
    if (!isCurrent(generation, container)) return false

    if (runtime.useGlassLifecycle) window.GlassCardLifecycle?.ready(container)
    scanActiveTargets(container).forEach(target => {
      target.classList.remove(itemPendingClass, itemPrerenderClass)
      target.classList.add(itemVisibleClass)
    })
    container.classList.remove(
      containerPendingClass,
      containerEnteringClass
    )
    container.classList.add(containerActiveClass)
    return true
  }

  const init = async () => {
    const container = getCurrentContainer()
    if (!container) return false

    if (container.querySelector('#home-dashboard')) {
      cleanup()
      clearContainerState(container)
      return false
    }

    if (runtime.container === container && container.dataset.pageMotionInitialized === 'true') return true

    let generation = null

    try {
      generation = prepare(container)
      if (generation === null) return false
      await waitForPageStyles(container)
      if (!isCurrent(generation, container)) return false

      scheduleFrame(() => {
        try {
          if (!measure(generation, container)) return
          scheduleFrame(() => {
            try {
              if (!isCurrent(generation, container)) return
              scheduleFrame(() => {
                try {
                  reveal(generation, container)
                } catch {
                  recover(container, generation)
                }
              })
            } catch {
              recover(container, generation)
            }
          })
        } catch {
          recover(container, generation)
        }
      })
      return true
    } catch {
      if (generation !== null) return recover(container, generation)
      clearContainerState(container)
      return false
    }
  }

  const replay = scope => {
    const container = getCurrentContainer()
    if (!isCurrent(runtime.generation, container) || !scope?.isConnected || !container.contains(scope)) return false

    clearReplayTargets(container)
    const targets = scanDeclarativeTargets(scope)
      .filter(target => scope === target || scope.contains(target))
    if (!targets.length) return false

    const generation = runtime.generation
    const replayGeneration = ++runtime.replayGeneration
    const replayToken = String(replayGeneration)

    targets.forEach(target => {
      target.dataset.pageMotionReplay = replayToken
      target.classList.remove(itemPrerenderClass, itemVisibleClass)
      target.classList.add(itemClass, itemPendingClass)
      target.style.setProperty('--page-motion-group', String(getMotionGroup(target)))
    })

    scheduleFrame(() => {
      if (!isCurrent(generation, container) || replayGeneration !== runtime.replayGeneration) return

      queryAll(scope, `[data-page-motion-replay="${replayToken}"]`).forEach(target => {
        void target.getBoundingClientRect()
        target.classList.remove(itemPendingClass)
        target.classList.add(itemPrerenderClass)
        void target.offsetWidth
      })

      scheduleFrame(() => {
        if (!isCurrent(generation, container) || replayGeneration !== runtime.replayGeneration) return
        queryAll(scope, `[data-page-motion-replay="${replayToken}"]`).forEach(target => {
          target.classList.remove(itemPendingClass, itemPrerenderClass)
          target.classList.add(itemVisibleClass)
          target.removeAttribute('data-page-motion-replay')
        })
      })
    })

    return true
  }

  window.PageMotion = { init, prepare, measure, reveal, replay, cleanup }
  init()

  if (!window.pageMotionPjaxBound) {
    window.pageMotionPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', () => init())
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      init()
    })
  }
})()
