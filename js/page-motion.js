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
    targets: [],
    measureElements: [],
    frames: new Set(),
    styleCleanups: [],
    useGlassLifecycle: false,
    generation: 0,
    replayGeneration: 0
  }

  const uniqueElements = elements => Array.from(new Set(elements.filter(Boolean)))

  const queryAll = (scope, selector) => scope ? Array.from(scope.querySelectorAll(selector)) : []

  const directChildren = element => element
    ? Array.from(element.children).filter(child => !['LINK', 'SCRIPT', 'STYLE'].includes(child.tagName))
    : []

  const headerTargets = () => queryAll(document, '#pjax-page-header #post-info, #pjax-page-header #page-site-info')

  const asideTargets = container => queryAll(container, '#aside-content .card-widget')

  const normalizeGroups = groups => {
    const claimed = new Set()

    return groups.map(group => uniqueElements(group).filter(element => {
      if (claimed.has(element)) return false
      claimed.add(element)
      return true
    }))
  }

  const planAbout = container => {
    const root = container.querySelector('.about-profile-page')
    const hero = queryAll(root, '.about-profile-hero')
    const activePanel = root?.querySelector('.about-profile-panel:not([hidden])') || root
    const content = queryAll(activePanel, '.about-profile-section, .about-profile-aside-card, .about-profile-blog-card')

    return {
      groups: [hero, content, []],
      measureElements: [...hero, ...content],
      useGlassLifecycle: false
    }
  }

  const planNotes = container => {
    const root = container.querySelector('.notes-page')
    const search = queryAll(root, '.notes-search-shell')
    const heading = queryAll(root, '.notes-heading')
    const content = queryAll(root, '.notes-entry, .notes-empty')

    return {
      groups: [search, heading, content],
      measureElements: [...search, ...heading, ...content],
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
      measureElements: [...hero, ...motto, ...entries],
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
      groups: [[...headerTargets(), ...localHero], content, [...secondary, ...asideTargets(container)]],
      measureElements: [],
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
      groups: [[...headerTargets(), ...title], content, [...secondary, ...asideTargets(container)]],
      measureElements: [],
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
      groups: [[...headerTargets(), ...title], fallbackContent, [...secondary, ...asideTargets(container)]],
      measureElements: [],
      useGlassLifecycle: true
    }
  }

  const getPlan = container => {
    if (!container || container.querySelector('#home-dashboard')) return null
    if (container.querySelector('.about-profile-page')) return planAbout(container)
    if (container.querySelector('.notes-page')) return planNotes(container)
    if (container.querySelector('.ecust-journey')) return planEcust(container)

    const pageType = container.dataset.pageType || ''
    if (pageType === 'post' || container.querySelector('#post')) return planPost(container)
    if (['archive', 'category', 'tag'].includes(pageType)) return planCollection(container, pageType)
    return planGenericPage(container)
  }

  const isCurrent = generation => generation === runtime.generation && runtime.container?.isConnected

  const scheduleFrame = callback => {
    const frame = window.requestAnimationFrame(() => {
      runtime.frames.delete(frame)
      callback()
    })
    runtime.frames.add(frame)
  }

  const clearTarget = target => {
    target.classList.remove(itemClass, itemPendingClass, itemPrerenderClass, itemVisibleClass)
    target.style.removeProperty('--page-motion-group')
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

    runtime.targets.forEach(clearTarget)
    clearContainerState(runtime.container)

    runtime.container = null
    runtime.targets = []
    runtime.measureElements = []
    runtime.useGlassLifecycle = false
  }

  const waitForPageStyles = container => {
    const stylesheets = Array.from(container.querySelectorAll('link[rel="stylesheet"]'))

    return Promise.all(stylesheets.map(stylesheet => new Promise(resolve => {
      try {
        if (stylesheet.sheet) {
          resolve()
          return
        }
      } catch (error) {
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

  const prepare = (container = document.getElementById('content-inner')) => {
    const plan = getPlan(container)
    if (!container || !plan) return null

    cleanup()
    const groups = normalizeGroups(plan.groups)
    runtime.container = container
    runtime.targets = groups.flat()
    runtime.measureElements = uniqueElements([...runtime.targets, ...plan.measureElements])
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

  const measure = (generation = runtime.generation) => {
    if (!isCurrent(generation)) return false

    runtime.measureElements.forEach(element => {
      void element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      void style.backgroundColor
      void style.backdropFilter
      void style.webkitBackdropFilter
    })

    if (runtime.useGlassLifecycle) window.GlassCardLifecycle?.forceComposite(runtime.container)

    runtime.targets.forEach(target => {
      target.classList.remove(itemPendingClass)
      target.classList.add(itemPrerenderClass)
      void target.offsetWidth
    })
    return true
  }

  const reveal = (generation = runtime.generation) => {
    if (!isCurrent(generation)) return false

    if (runtime.useGlassLifecycle) window.GlassCardLifecycle?.ready(runtime.container)
    runtime.targets.forEach(target => {
      target.classList.remove(itemPendingClass, itemPrerenderClass)
      target.classList.add(itemVisibleClass)
    })
    runtime.container.classList.remove(
      containerPendingClass,
      containerEnteringClass
    )
    runtime.container.classList.add(containerActiveClass)
    return true
  }

  const init = async (container = document.getElementById('content-inner')) => {
    if (!container) return false

    if (container.querySelector('#home-dashboard')) {
      cleanup()
      clearContainerState(container)
      return false
    }

    if (runtime.container === container && container.dataset.pageMotionInitialized === 'true') return true

    const generation = prepare(container)
    if (generation === null) return false
    await waitForPageStyles(container)
    if (!isCurrent(generation)) return false

    scheduleFrame(() => {
      if (!measure(generation)) return
      scheduleFrame(() => {
        if (!isCurrent(generation)) return
        scheduleFrame(() => reveal(generation))
      })
    })
    return true
  }

  const replay = (elements, groupIndex = 1) => {
    const targets = uniqueElements(Array.from(elements || []))
    if (!targets.length || !runtime.container?.isConnected) return false

    const generation = runtime.generation
    const replayGeneration = ++runtime.replayGeneration
    runtime.targets = uniqueElements([...runtime.targets, ...targets])

    targets.forEach(target => {
      target.classList.remove(itemPrerenderClass, itemVisibleClass)
      target.classList.add(itemClass, itemPendingClass)
      target.style.setProperty('--page-motion-group', String(groupIndex))
    })

    scheduleFrame(() => {
      if (!isCurrent(generation) || replayGeneration !== runtime.replayGeneration) return

      targets.forEach(target => {
        if (!target.isConnected) return
        void target.getBoundingClientRect()
        target.classList.remove(itemPendingClass)
        target.classList.add(itemPrerenderClass)
        void target.offsetWidth
      })

      scheduleFrame(() => {
        if (!isCurrent(generation) || replayGeneration !== runtime.replayGeneration) return
        targets.forEach(target => {
          if (!target.isConnected) return
          target.classList.remove(itemPendingClass, itemPrerenderClass)
          target.classList.add(itemVisibleClass)
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
    window.addEventListener('pageshow', () => init())
  }
})()
