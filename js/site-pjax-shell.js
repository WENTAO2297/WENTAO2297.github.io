(() => {
  'use strict'

  const root = document.documentElement
  const controlledBodyClasses = ['site-video-body', 'home-dashboard-body']
  let pendingUrl = null

  const normalizePath = (path) => {
    const normalized = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '')
    return normalized || '/'
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
      const nextBodyClasses = new Set((content.dataset.bodyClass || '').split(/\s+/).filter(Boolean))
      controlledBodyClasses.forEach(className => {
        document.body.classList.toggle(className, nextBodyClasses.has(className))
      })

      if (bodyWrap) bodyWrap.className = content.dataset.bodyWrapClass || ''
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
  }

  window.syncPersistentShell = syncPersistentShell
  syncPersistentShell()

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

  document.addEventListener('pjax:send', () => {
    // Navbar/Header stay mounted as the persistent App Shell during PJAX navigation.
    root.classList.add('app-shell-persistent', 'pjax-content-leaving')
    window.closeHomeDashboardSearchResults?.()
  })

  document.addEventListener('pjax:complete', () => {
    // Butterfly's PJAX complete handler calls syncPersistentShell once.
    window.requestAnimationFrame(() => {
      root.classList.remove('pjax-content-leaving')
      pendingUrl = null
    })
  })

  document.addEventListener('pjax:error', () => {
    root.classList.remove('pjax-content-leaving')
    window.location.href = pendingUrl || window.location.href
  })
})()
