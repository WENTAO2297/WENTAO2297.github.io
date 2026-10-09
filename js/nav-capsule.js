(() => {
  'use strict'

  if (window.SiteNavCapsule) {
    window.SiteNavCapsule.refresh()
    return
  }

  const root = document.documentElement
  const nav = document.querySelector('#page-header #nav')
  const menuSurface = nav?.querySelector('.capsule-menu-surface')
  const morphEnterThreshold = 88
  const morphExitThreshold = 64
  const hideThreshold = 150
  const colors = Object.freeze({
    pink: { accent: '#f3b6df', border: 'rgba(243, 182, 223, .8)', glow: 'rgba(243, 182, 223, .35)' },
    cyan: { accent: '#43dce9', border: 'rgba(67, 220, 233, .8)', glow: 'rgba(67, 220, 233, .34)' },
    violet: { accent: '#bc9cff', border: 'rgba(188, 156, 255, .82)', glow: 'rgba(188, 156, 255, .36)' },
    mint: { accent: '#83e6c4', border: 'rgba(131, 230, 196, .8)', glow: 'rgba(131, 230, 196, .34)' }
  })
  let indicatorFrame = 0
  let indicatorHideTimer = null
  let pendingIndicator = null
  let indicatorVisible = false
  let scrollFrame = 0
  let spotlightFrame = 0
  let lastScrollTop = 0
  let scrollTravel = 0
  let resizeFrame = 0
  const groupCloseTimers = new WeakMap()

  if (!nav) return

  const setStyleIfChanged = (element, name, value) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
  }

  const setAccent = name => {
    const color = colors[name]
    if (!color) return
    nav.style.setProperty('--capsule-accent', color.accent)
    root.style.setProperty('--accent-color', color.accent)
    root.style.setProperty('--accent-border', color.border)
    root.style.setProperty('--accent-glow', color.glow)
    root.style.setProperty('--accent-soft-glow', color.glow)
    try { localStorage.setItem('site-capsule-accent', name) } catch {}
    nav.querySelectorAll('[data-capsule-accent]').forEach(swatch => {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.capsuleAccent === name))
    })
  }

  const placeIndicator = target => {
    if (!menuSurface || !target || target.offsetParent === null) {
      menuSurface?.style.setProperty('--capsule-indicator-opacity', '0')
      indicatorVisible = false
      return
    }
    const surface = menuSurface.getBoundingClientRect()
    const item = target.getBoundingClientRect()
    // A hidden highlight appears at its target; only a visible highlight slides.
    menuSurface.classList.toggle('capsule-indicator-moving', indicatorVisible)
    menuSurface.style.setProperty('--capsule-indicator-left', `${item.left - surface.left - menuSurface.clientLeft}px`)
    menuSurface.style.setProperty('--capsule-indicator-top', `${item.top - surface.top - menuSurface.clientTop}px`)
    menuSurface.style.setProperty('--capsule-indicator-width', `${item.width}px`)
    menuSurface.style.setProperty('--capsule-indicator-height', `${item.height}px`)
    menuSurface.style.setProperty('--capsule-indicator-opacity', '1')
    indicatorVisible = true
  }

  const queueIndicator = target => {
    pendingIndicator = target
    if (indicatorFrame) return
    indicatorFrame = requestAnimationFrame(() => {
      indicatorFrame = 0
      if (pendingIndicator) placeIndicator(pendingIndicator)
    })
  }

  const hideIndicator = () => {
    if (indicatorHideTimer !== null) window.clearTimeout(indicatorHideTimer)
    indicatorHideTimer = null
    if (indicatorFrame) cancelAnimationFrame(indicatorFrame)
    indicatorFrame = 0
    pendingIndicator = null
    indicatorVisible = false
    menuSurface?.style.setProperty('--capsule-indicator-opacity', '0')
  }

  const cancelIndicatorHide = () => {
    if (indicatorHideTimer !== null) window.clearTimeout(indicatorHideTimer)
    indicatorHideTimer = null
  }

  const scheduleIndicatorHide = delay => {
    cancelIndicatorHide()
    indicatorHideTimer = window.setTimeout(hideIndicator, delay)
  }

  const getScrollTop = () => window.pageYOffset || document.documentElement.scrollTop || 0

  const getHeroBoundary = () => {
    const header = document.getElementById('page-header')
    return header?.offsetHeight || 0
  }

  // Keep the same grid throughout the morph; measure existing content without clones.
  const updateMorphedWidth = () => {
    nav.classList.toggle('hide-menu', window.innerWidth <= 1240)
    // Expanded width is shared CSS across pages; only intrinsic compact content
    // needs measuring. PJAX no longer retargets the bar to a page-specific grid.
    if (window.innerWidth <= 768 && nav.classList.contains('capsule-search-open')) return
    const brand = nav.querySelector('#blog-info')
    const tools = nav.querySelector('.capsule-tools')
    const brandWidth = Math.max(0, ...[...brand.children].map(item => item.offsetWidth))
    const toolWidth = tools.offsetWidth
    const menuWidth = menuSurface?.offsetWidth || 0
    const narrow = window.innerWidth <= 1240
    const width = narrow
      ? brandWidth + toolWidth + menuWidth + (window.innerWidth <= 768 ? 26 : 66)
      : Math.max(brandWidth, toolWidth) * 2 + menuWidth + 66
    nav.style.setProperty('--capsule-compact-width', `${Math.ceil(width)}px`)
  }

  const setMorphed = shouldMorph => {
    if (shouldMorph === nav.classList.contains('capsule-morphed')) return
    nav.classList.toggle('capsule-morphed', shouldMorph)
    // Morphing only changes the outer box. Its content widths are already
    // tracked by ResizeObserver; measuring again here forces layout mid-transition.
  }

  const updateScrollState = () => {
    const scrollTop = Math.max(0, getScrollTop())
    const direction = scrollTop - lastScrollTop
    const overHero = scrollTop < getHeroBoundary()
    const pinned = nav.classList.contains('capsule-search-open')
      || nav.classList.contains('capsule-profile-open')
      || Boolean(nav.querySelector('[data-nav-surface-state="closing"]'))
      || Boolean(menuSurface.querySelector('.menus_item.is-open'))
      || Boolean(nav.querySelector(':focus-visible'))
      || nav.querySelector('[data-capsule-palette]')?.getAttribute('aria-expanded') === 'true'

    // Ignore tiny reversals and use separate enter/exit thresholds to prevent flicker.
    if (direction && Math.sign(direction) !== Math.sign(scrollTravel)) scrollTravel = 0
    scrollTravel += direction
    if (scrollTop <= morphExitThreshold || overHero || pinned) {
      nav.classList.remove('capsule-scroll-hidden')
      scrollTravel = 0
    } else if (scrollTravel < -10) {
      nav.classList.remove('capsule-scroll-hidden')
      scrollTravel = 0
    } else if (scrollTravel > 10 && scrollTop > hideThreshold) {
      nav.classList.add('capsule-scroll-hidden')
      scrollTravel = 0
    }

    if (scrollTop > morphEnterThreshold) setMorphed(true)
    else if (scrollTop < morphExitThreshold) setMorphed(false)
    lastScrollTop = scrollTop
  }

  const queueScrollUpdate = () => {
    if (scrollFrame) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      updateScrollState()
    })
  }

  const alignDropdownPanels = () => {
    const hosts = [...nav.querySelectorAll('.menus_item:has(> .menus_item_child), .capsule-palette')].filter(host => {
      const panel = host.querySelector(':scope > .menus_item_child, :scope > .capsule-palette__options')
      return panel && !panel.hidden && ['open', 'closing'].includes(panel.dataset.navSurfaceState)
        && host.offsetParent !== null
    })
    // Closed menus need no geometry work during the capsule's scroll morph.
    if (!hosts.length) return
    const bottom = nav.getBoundingClientRect().bottom
    // Read every visible host first, then write, to avoid repeated forced layouts.
    const positions = hosts.map(host => {
      const rect = host.getBoundingClientRect()
      return { host, top: bottom - rect.top - host.clientTop, bridge: Math.max(0, bottom - rect.bottom) + 2 }
    })
    positions.forEach(({ host, top, bridge }) => {
      setStyleIfChanged(host, '--capsule-panel-top', `${top}px`)
      setStyleIfChanged(host, '--capsule-panel-bridge', `${bridge}px`)
    })
  }

  const queueResize = () => {
    if (resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      updateMorphedWidth()
      alignDropdownPanels()
      if (pendingIndicator?.isConnected) placeIndicator(pendingIndicator)
    })
  }

  const isWithinSearch = target => Boolean(target instanceof Node && (
    nav.querySelector('#capsule-search-panel')?.contains(target)
    || nav.querySelector('#capsule-search-results')?.contains(target)
  ))

  const updateSpotlight = event => {
    const rect = nav.getBoundingClientRect()
    nav.style.setProperty('--capsule-spotlight-x', `${event.clientX - rect.left}px`)
    nav.style.setProperty('--capsule-spotlight-y', `${event.clientY - rect.top}px`)
    nav.classList.add('capsule-spotlight')
  }

  const queueSpotlightUpdate = event => {
    const { clientX, clientY } = event
    if (spotlightFrame) return
    spotlightFrame = requestAnimationFrame(() => {
      spotlightFrame = 0
      updateSpotlight({ clientX, clientY })
    })
  }

  const clearSpotlight = () => {
    if (spotlightFrame) cancelAnimationFrame(spotlightFrame)
    spotlightFrame = 0
    nav.classList.remove('capsule-spotlight')
  }

  const player = () => {
    const players = Array.isArray(window.aplayers) ? window.aplayers : []
    const active = players.find(item => item?.container?.isConnected && !item.options?.fixed)
      || players.find(item => item?.container?.isConnected)
    const element = active?.container || nav.querySelector('.aplayer') || document.querySelector('.aplayer')
    return element ? { api: active, element } : null
  }

  const syncPlayer = () => {
    const available = Boolean(player())
    const music = nav.querySelector('[data-capsule-music]')
    const play = nav.querySelector('[data-capsule-play]')
    music.hidden = !available
    play.hidden = !available
    if (available) {
      const isPlaying = player()?.api?.paused === false
      play.setAttribute('aria-label', isPlaying ? '暂停音乐' : '播放音乐')
      play.title = isPlaying ? '暂停' : '播放'
      play.innerHTML = `<i class="fas ${isPlaying ? 'fa-pause' : 'fa-play'}" aria-hidden="true"></i>`
    }
  }

  const closePalette = () => {
    const toggle = nav.querySelector('[data-capsule-palette]')
    const options = nav.querySelector('#capsule-palette-options')
    window.SiteNavSurfaceMotion.setOpen(options, false)
    toggle.setAttribute('aria-expanded', 'false')
  }

  const closeSearch = (restoreFocus = false) => {
    const shell = nav.querySelector('#capsule-search-panel')
    if (!shell) return
    nav.classList.remove('capsule-search-open')
    nav.querySelector('[data-capsule-search]').setAttribute('aria-expanded', 'false')
    window.closeHomeDashboardSearchResults?.()
    if (restoreFocus) nav.querySelector('[data-capsule-search]').focus({ preventScroll: true })
    queueResize()
  }

  const setGroupOpen = (item, open) => {
    clearTimeout(groupCloseTimers.get(item))
    groupCloseTimers.delete(item)
    window.SiteNavSurfaceMotion.setOpen(item.querySelector(':scope > .menus_item_child'), open)
    item.classList.toggle('is-open', open)
    const trigger = item.querySelector(':scope > .group')
    trigger?.classList.toggle('hide', !open)
    trigger?.setAttribute('aria-expanded', String(open))
    if (open) alignDropdownPanels()
  }
  const closeGroups = except => {
    menuSurface.querySelectorAll('.menus_item').forEach(item => {
      if (item !== except) setGroupOpen(item, false)
    })
  }

  const refresh = () => {
    if (scrollFrame) cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    scrollTravel = 0
    lastScrollTop = getScrollTop()
    hideIndicator()
    syncPlayer()
    updateMorphedWidth()
    alignDropdownPanels()
    nav.classList.remove('capsule-scroll-hidden')
    updateScrollState()
  }

  let savedAccent = 'pink'
  try { savedAccent = localStorage.getItem('site-capsule-accent') || savedAccent } catch {}
  setAccent(savedAccent)
  refresh()

  menuSurface?.addEventListener('pointerover', event => {
    const item = event.target instanceof Element && event.target.closest('.menus_items > .menus_item > .site-page')
    if (item) {
      cancelIndicatorHide()
      queueIndicator(item)
    }
  })
  menuSurface?.addEventListener('pointerout', event => {
    const item = event.target instanceof Element && event.target.closest('.menus_items > .menus_item > .site-page')
    const nextItem = event.relatedTarget instanceof Element && event.relatedTarget.closest('.menus_items > .menus_item > .site-page')
    if (item && item !== nextItem && !item.parentElement.contains(event.relatedTarget)) scheduleIndicatorHide(100)
  })
  menuSurface?.addEventListener('pointerleave', () => scheduleIndicatorHide(150))
  menuSurface?.addEventListener('focusin', event => {
    const item = event.target instanceof Element && event.target.closest('.menus_items > .menus_item > .site-page')
    if (item) {
      cancelIndicatorHide()
      queueIndicator(item)
    }
  })
  menuSurface?.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!menuSurface.contains(document.activeElement)) hideIndicator()
  }))

  nav.addEventListener('mousemove', queueSpotlightUpdate, { passive: true })
  nav.addEventListener('mouseleave', clearSpotlight)
  window.addEventListener('scroll', queueScrollUpdate, { passive: true })
  window.addEventListener('resize', queueResize, { passive: true })
  const contentObserver = new ResizeObserver(queueResize)
  // Follow the capsule's actual animated height, rather than a trigger's fixed gap.
  const navGeometryObserver = new ResizeObserver(alignDropdownPanels)
  navGeometryObserver.observe(nav)
  contentObserver.observe(menuSurface)
  contentObserver.observe(nav.querySelector('.capsule-tools'))
  nav.querySelectorAll('#blog-info > a').forEach(item => contentObserver.observe(item))
  document.fonts?.ready.then(queueResize)
  nav.addEventListener('transitionend', event => {
    if (event.target === nav && pendingIndicator) placeIndicator(pendingIndicator)
  })

  nav.querySelector('#capsule-search-input')?.addEventListener('focus', () => {
    nav.classList.add('capsule-search-open')
    nav.classList.remove('capsule-scroll-hidden')
    nav.querySelector('[data-capsule-search]').setAttribute('aria-expanded', 'true')
    closePalette()
    closeGroups()
  })
  nav.querySelector('#capsule-search-panel')?.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!isWithinSearch(document.activeElement)) closeSearch()
  }))
  nav.querySelector('#capsule-search-results')?.addEventListener('focusout', () => requestAnimationFrame(() => {
    if (!isWithinSearch(document.activeElement)) closeSearch()
  }))
  menuSurface.querySelectorAll('.menus_item:has(> .group)').forEach(item => {
    item.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return
      closeSearch()
      closeGroups(item)
      setGroupOpen(item, true)
    })
    item.addEventListener('pointerleave', () => {
      clearTimeout(groupCloseTimers.get(item))
      groupCloseTimers.set(item, setTimeout(() => {
        if (!item.matches(':hover') && !item.contains(document.activeElement)) setGroupOpen(item, false)
      }, 280))
    })
    item.addEventListener('focusout', () => requestAnimationFrame(() => {
      if (!item.contains(document.activeElement)) setGroupOpen(item, false)
    }))
  })
  menuSurface.addEventListener('keydown', event => {
    const group = event.target.closest('.group')
    if (!group || !['Enter', ' ', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const item = group.parentElement
    const open = event.key === 'ArrowDown' || !item.classList.contains('is-open')
    closeGroups(item)
    setGroupOpen(item, open)
    if (event.key === 'ArrowDown') item.querySelector('.menus_item_child a')?.focus()
  })
  document.querySelector('#sidebar-menus')?.addEventListener('keydown', event => {
    if (event.target.matches('.group') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      event.target.click()
    }
  })
  document.querySelector('#sidebar-menus')?.addEventListener('click', event => {
    const group = event.target.closest('.group')
    if (group) queueMicrotask(() => group.setAttribute('aria-expanded', String(!group.classList.contains('hide'))))
  })

  nav.addEventListener('click', event => {
    const search = event.target.closest('[data-capsule-search]')
    if (search) {
      if (!nav.classList.contains('capsule-search-open')) event.preventDefault()
      nav.classList.add('capsule-search-open')
      nav.classList.remove('capsule-scroll-hidden')
      search.setAttribute('aria-expanded', 'true')
      closePalette()
      closeGroups()
      nav.querySelector('#capsule-search-input').focus({ preventScroll: true })
      return
    }

    const group = event.target.closest('.capsule-menu-surface .group')
    if (group) {
      const item = group.parentElement
      const open = !item.classList.contains('is-open')
      closeGroups(item)
      setGroupOpen(item, open)
      return
    }

    const theme = event.target.closest('[data-capsule-theme]')
    if (theme) {
      document.getElementById('darkmode')?.click()
      requestAnimationFrame(() => {
        const dark = root.dataset.theme === 'dark'
        theme.innerHTML = `<i class="fas ${dark ? 'fa-sun' : 'fa-moon'} capsule-theme-icon" aria-hidden="true"></i>`
        theme.title = dark ? '切换到浅色模式' : '切换到深色模式'
        theme.setAttribute('aria-label', theme.title)
      })
      return
    }

    const palette = event.target.closest('[data-capsule-palette]')
    if (palette) {
      closeSearch()
      const options = nav.querySelector('#capsule-palette-options')
      const open = palette.getAttribute('aria-expanded') !== 'true'
      window.SiteNavSurfaceMotion.setOpen(options, open)
      palette.setAttribute('aria-expanded', String(open))
      if (open) alignDropdownPanels()
      return
    }

    const swatch = event.target.closest('[data-capsule-accent]')
    if (swatch) {
      setAccent(swatch.dataset.capsuleAccent)
      closePalette()
      nav.querySelector('[data-capsule-palette]').focus()
      return
    }

    const music = event.target.closest('[data-capsule-music]')
    if (music) {
      const found = player()
      found?.element.querySelector('.aplayer-icon-menu')?.click()
      return
    }

    const play = event.target.closest('[data-capsule-play]')
    if (play) {
      const found = player()
      if (found?.api) {
        if (found.api.paused) found.api.play()
        else found.api.pause()
      } else {
        found?.element.querySelector('.aplayer-pic')?.click()
      }
      requestAnimationFrame(syncPlayer)
    }
  })

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.capsule-palette')) closePalette()
    if (!isWithinSearch(event.target)) closeSearch()
    if (!event.target.closest('.capsule-menu-surface')) closeGroups()
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    closePalette()
    if (nav.classList.contains('capsule-search-open')) closeSearch(true)
    const openGroup = menuSurface.querySelector('.menus_item.is-open')
    if (openGroup) { closeGroups(); openGroup.querySelector('.group')?.focus() }
  })
  document.addEventListener('pjax:send', () => {
    closeSearch()
    closePalette()
    closeGroups()
    hideIndicator()
    clearSpotlight()
  })
  document.addEventListener('pjax:complete', refresh)
  document.addEventListener('pjax:complete', () => {
    const theme = nav.querySelector('[data-capsule-theme]')
    const dark = root.dataset.theme === 'dark'
    theme.innerHTML = `<i class="fas ${dark ? 'fa-sun' : 'fa-moon'} capsule-theme-icon" aria-hidden="true"></i>`
    theme.title = dark ? '切换到浅色模式' : '切换到深色模式'
    theme.setAttribute('aria-label', theme.title)
  })
  window.addEventListener('pageshow', refresh)
  window.addEventListener('aplayer:loaded', syncPlayer)
  window.SiteNavCapsule = Object.freeze({ refresh })
})()
