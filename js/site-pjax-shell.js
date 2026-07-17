(() => {
  'use strict'

  const root = document.documentElement
  const controlledBodyClasses = ['site-video-body', 'home-dashboard-body']
  const isManagedBodyWrapClass = className => (
    className === 'post' ||
    className === 'page' ||
    className === 'hide-aside' ||
    className === 'home-dashboard-page' ||
    className.startsWith('type-')
  )
  let pendingUrl = null
  let navigationSequence = 0
  let scheduledSync = false

  const normalizePath = (path) => {
    let value = String(path || '/')
    try {
      value = new URL(value, window.location.origin).pathname
    } catch (error) {
      // Keep the raw path for the small, local values used by the data attributes.
    }

    const normalized = value.replace(/\/index\.html$/, '/').replace(/\/+$/, '')
    return normalized || '/'
  }

  const getEventPath = event => {
    const detail = event?.detail || {}
    const request = detail.request || {}
    const candidate = detail.url || detail.href || request.responseURL || request.url
    return candidate ? normalizePath(candidate) : null
  }

  const scheduleSync = () => {
    if (scheduledSync) return
    scheduledSync = true
    window.requestAnimationFrame(() => {
      scheduledSync = false
      syncPersistentShell()
    })
  }

  const isCurrentNavigation = (link, currentPath) => {
    const linkPath = normalizePath(new URL(link.href, window.location.href).pathname)
    if (linkPath === '/') return currentPath === '/'
    return currentPath === linkPath || currentPath.startsWith(`${linkPath}/`)
  }

  const updateNavigation = () => {
    const currentPath = normalizePath(window.location.pathname)
    document.querySelectorAll('#nav a.site-page, #sidebar-menus a.site-page').forEach(link => {
      let active = false

      try {
        active = isCurrentNavigation(link, currentPath)
      } catch (error) {
        active = false
      }

      link.classList.toggle('active', active)
      if (active) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }

  const syncPersistentShell = () => {
    const content = document.getElementById('content-inner')
    const bodyWrap = document.getElementById('body-wrap')
    const header = document.getElementById('page-header')
    const headerState = document.getElementById('pjax-page-header')

    if (content) {
      const currentPath = normalizePath(window.location.pathname)
      const contentPath = content.dataset.pagePath ? normalizePath(content.dataset.pagePath) : null

      // A stale PJAX response must never update the shell for the current URL.
      // If history is updated one task after pjax:complete, retry once on the next frame.
      if (contentPath && contentPath !== currentPath) {
        scheduleSync()
        return false
      }

      const nextBodyClasses = new Set((content.dataset.bodyClass || '').split(/\s+/).filter(Boolean))
      controlledBodyClasses.forEach(className => {
        document.body.classList.toggle(className, nextBodyClasses.has(className))
      })

      if (bodyWrap) {
        const nextBodyWrapClasses = new Set((content.dataset.bodyWrapClass || '').split(/\s+/).filter(Boolean))
        Array.from(bodyWrap.classList).forEach(className => {
          if (isManagedBodyWrapClass(className)) bodyWrap.classList.remove(className)
        })
        nextBodyWrapClasses.forEach(className => bodyWrap.classList.add(className))

        // An article with an aside is always a two-column post. This is a
        // lifecycle guard for stale hide-aside state, not a CSS layout override.
        if (content.querySelector('#post') && content.querySelector('#aside-content')) {
          bodyWrap.classList.remove('hide-aside')
          bodyWrap.classList.add('post')
        }
      }
    } else {
      return false
    }

    if (header && headerState) {
      header.className = headerState.dataset.headerClass || ''
      const headerStyle = headerState.dataset.headerStyle || ''
      if (headerStyle) header.setAttribute('style', headerStyle)
      else header.removeAttribute('style')

      const pageTitle = document.querySelector('#nav .nav-page-title')
      if (pageTitle) {
        const isPost = headerState.dataset.pageType === 'post'
        pageTitle.classList.toggle('is-hidden', !isPost)
        const title = pageTitle.querySelector('.site-name:first-child')
        if (title) title.textContent = headerState.dataset.pageTitle || document.title
      }
    }

    updateNavigation()
    return true
  }

  window.syncPersistentShell = syncPersistentShell
  syncPersistentShell()

  const persistentBodyWrap = document.getElementById('body-wrap')
  if (persistentBodyWrap && window.MutationObserver) {
    const observer = new MutationObserver(() => syncPersistentShell())
    observer.observe(persistentBodyWrap, { childList: true })
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const link = event.target.closest('a[href]')
    if (!link || link.target === '_blank' || link.hasAttribute('download') || link.hasAttribute('data-no-pjax')) return

    try {
      const url = new URL(link.href, window.location.href)
      if (url.origin === window.location.origin && url.protocol.startsWith('http') && !url.hash) pendingUrl = url.href
    } catch (error) {
      pendingUrl = null
    }
  }, true)

  window.addEventListener('popstate', () => {
    pendingUrl = window.location.href
  }, true)

  document.addEventListener('pjax:send', event => {
    // Navbar/Header stay mounted as the persistent App Shell during PJAX navigation.
    navigationSequence += 1
    const eventPath = getEventPath(event)
    if (eventPath) pendingUrl = new URL(eventPath, window.location.origin).href
    root.classList.add('app-shell-persistent', 'pjax-content-leaving')
    window.closeHomeDashboardSearchResults?.()
  })

  document.addEventListener('pjax:complete', () => {
    // Butterfly's PJAX complete handler calls syncPersistentShell once.
    const completedSequence = navigationSequence
    window.requestAnimationFrame(() => {
      if (completedSequence !== navigationSequence) return
      root.classList.remove('pjax-content-leaving')
      pendingUrl = null
    })
  })

  document.addEventListener('pjax:error', () => {
    root.classList.remove('pjax-content-leaving')
    window.location.href = pendingUrl || window.location.href
  })
})()
