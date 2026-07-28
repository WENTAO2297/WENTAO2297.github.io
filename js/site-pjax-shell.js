(() => {
  'use strict'

  const root = document.documentElement
  const controlledBodyClasses = ['site-video-body', 'home-dashboard-body']
  const stylesheetTimeout = 900
  const memorableMomentsDetailNavigationClass = 'is-memorable-moments-detail-navigation'
  const memorableMomentsRestoreClass = 'is-restoring-memorable-moments'
  let pendingUrl = null
  let navigationGeneration = 0

  const clearMemorableMomentsNavigationState = () => {
    root.classList.remove(memorableMomentsDetailNavigationClass)
  }

  const shouldPreserveMemorableMomentsShell = () => {
    const detailNavigation = root.classList.contains(memorableMomentsDetailNavigationClass)
    const detailReturn = root.classList.contains(memorableMomentsRestoreClass)
      && Boolean(document.querySelector('.memorable-moment-detail'))
    return (detailNavigation || detailReturn) && Boolean(
      document.querySelector('.memorable-moments') || document.querySelector('.memorable-moment-detail')
    )
  }

  const isMemorableMomentsRestore = content => Boolean(
    root.classList.contains(memorableMomentsRestoreClass)
      && content?.querySelector('.memorable-moments')
  )

  const getSiteVideoElements = () => ({
    container: document.querySelector('.site-video-background'),
    media: document.querySelector('.site-video-background__media')
  })

  const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const playSiteVideo = media => {
    if (!media || document.visibilityState === 'hidden' || prefersReducedMotion()) return
    const playPromise = media.play?.()
    playPromise?.catch?.(() => {})
  }

  const bindSiteVideoMedia = (container, media) => {
    if (!container || !media || media.dataset.siteVideoBound === 'true') return

    media.dataset.siteVideoBound = 'true'
    media.addEventListener('loadeddata', () => {
      container.classList.add('is-video-ready')
      container.classList.remove('is-video-failed')
    })
    media.addEventListener('canplay', () => {
      container.classList.add('is-video-ready')
      container.classList.remove('is-video-failed')
    })
    media.addEventListener('error', () => {
      container.classList.remove('is-video-ready')
      container.classList.add('is-video-failed')
    })
  }

  const syncSiteVideoPlayback = () => {
    const { container, media } = getSiteVideoElements()
    if (!container || !media) return

    bindSiteVideoMedia(container, media)

    const reducedMotion = prefersReducedMotion()
    container.classList.toggle('is-reduced-motion', reducedMotion)

    if (reducedMotion || document.visibilityState === 'hidden') media.pause()
    else playSiteVideo(media)
  }

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

  const waitForStylesheet = stylesheet => new Promise(resolve => {
    try {
      if (stylesheet.sheet) {
        resolve()
        return
      }
    } catch (error) {
      // The load/error events and timeout below remain authoritative.
    }

    let settled = false
    let timeout = null
    const finish = () => {
      if (settled) return
      settled = true
      stylesheet.removeEventListener('load', finish)
      stylesheet.removeEventListener('error', finish)
      if (timeout) window.clearTimeout(timeout)
      resolve()
    }

    stylesheet.addEventListener('load', finish, { once: true })
    stylesheet.addEventListener('error', finish, { once: true })
    timeout = window.setTimeout(finish, stylesheetTimeout)
  })

  const waitForContentStyles = content => {
    const stylesheets = content
      ? Array.from(content.querySelectorAll('link[rel="stylesheet"]'))
      : []

    return Promise.all(stylesheets.map(waitForStylesheet))
  }

  const revealPreparedContent = async generation => {
    const content = document.getElementById('content-inner')
    await waitForContentStyles(content)
    if (generation !== navigationGeneration || content !== document.getElementById('content-inner')) return

    window.requestAnimationFrame(() => {
      if (generation !== navigationGeneration || content !== document.getElementById('content-inner')) return
      root.classList.remove('pjax-content-preparing', 'pjax-content-leaving')
      pendingUrl = null
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
  syncSiteVideoPlayback()

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
    navigationGeneration += 1
    root.classList.add('app-shell-persistent')
    if (shouldPreserveMemorableMomentsShell()) root.classList.remove('pjax-content-leaving')
    else root.classList.add('pjax-content-leaving')
    window.closeHomeDashboardSearchResults?.()
  })

  document.addEventListener('pjax:complete', () => {
    // Butterfly syncs the persistent shell first; content stays gated until its local CSS is ready.
    const content = document.getElementById('content-inner')
    if (isMemorableMomentsRestore(content)) {
      root.classList.remove('pjax-content-preparing', 'pjax-content-leaving')
      clearMemorableMomentsNavigationState()
      pendingUrl = null
      return
    }
    root.classList.add('pjax-content-preparing')
    clearMemorableMomentsNavigationState()
    revealPreparedContent(navigationGeneration)
  })

  document.addEventListener('pjax:error', () => {
    navigationGeneration += 1
    root.classList.remove('pjax-content-preparing', 'pjax-content-leaving')
    clearMemorableMomentsNavigationState()
    window.location.href = pendingUrl || window.location.href
  })

  document.addEventListener('visibilitychange', syncSiteVideoPlayback)
  window.addEventListener('pageshow', syncSiteVideoPlayback)
  window.addEventListener('pagehide', () => getSiteVideoElements().media?.pause?.())
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  if (motionPreference?.addEventListener) motionPreference.addEventListener('change', syncSiteVideoPlayback)
  else motionPreference?.addListener?.(syncSiteVideoPlayback)
})()
