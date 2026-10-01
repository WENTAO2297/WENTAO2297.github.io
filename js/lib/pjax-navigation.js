(() => {
  'use strict'

  // Keep PJAX's networking and history entries. Only traversal scroll ownership
  // changes: 0.2.8 writes the outgoing DOM's scroll into the incoming entry.
  const installScrollRestoration = pjax => {
    const positions = new Map()
    let activeEntry = window.history.state
    let traversal = null
    let generation = 0
    let frame = null

    const rememberPosition = entry => {
      if (!entry?.uid) return
      positions.delete(entry.uid)
      positions.set(entry.uid, [window.scrollX, window.scrollY])
      if (positions.size > 64) positions.delete(positions.keys().next().value)
    }

    const cancelRestore = () => {
      generation += 1
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = null
    }

    const restorePosition = (position, token) => {
      const started = performance.now()
      let passes = 0
      let correctionScheduled = false
      const restore = () => {
        frame = null
        if (token !== generation) return
        // The album's existing card/viewport restoration remains its owner.
        if (document.documentElement.classList.contains('is-restoring-memorable-moments')
          && document.querySelector('.memorable-moments')) return

        const hash = window.location.hash
        let anchor = null
        if (hash) {
          try { anchor = document.getElementById(decodeURIComponent(hash.slice(1))) } catch {}
          if (!anchor) return
        }
        const target = anchor
          ? [0, anchor.getBoundingClientRect().top + window.scrollY]
          : position
        const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
        // Two frames allow inserted DOM/CSS to establish layout. Height growth
        // may extend this to 250ms, never to font/image/MathJax readiness.
        if (++passes < 2 || (maxY < target[1] && performance.now() - started < 250)) {
          frame = window.requestAnimationFrame(restore)
          return
        }
        const root = document.documentElement
        const previous = root.style.scrollBehavior
        root.style.scrollBehavior = 'auto'
        window.scrollTo({ left: target[0], top: target[1], behavior: 'auto' })
        if (previous) root.style.scrollBehavior = previous
        else root.style.removeProperty('scroll-behavior')
        // A subsequent frame can apply native scroll anchoring after a layout
        // task. Correct that once; do not poll for full MathJax/media readiness.
        if (!correctionScheduled && performance.now() - started < 250) {
          correctionScheduled = true
          frame = window.requestAnimationFrame(restore)
        }
      }
      frame = window.requestAnimationFrame(restore)
    }

    window.addEventListener('popstate', event => {
      if (!event.state?.url) return
      rememberPosition(activeEntry)
      cancelRestore()
      traversal = {
        state: event.state,
        position: positions.get(event.state.uid) || event.state.scrollPos || [0, 0]
      }
    }, true)

    document.addEventListener('pjax:send', event => {
      cancelRestore()
      if (event.history !== false) {
        traversal = null
        rememberPosition(window.history.state)
      }
    })
    document.addEventListener('pjax:complete', () => { activeEntry = window.history.state })
    document.addEventListener('pjax:error', () => { traversal = null; cancelRestore() })
    window.addEventListener('wheel', cancelRestore, { passive: true })
    window.addEventListener('touchstart', cancelRestore, { passive: true })
    window.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelRestore()
    })

    // handleResponse is a documented 0.2.8 extension point, not a private patch.
    const handleResponse = pjax.handleResponse
    pjax.handleResponse = function (html, request, href, options) {
      const destination = options?.history === false ? traversal : null
      if (!destination || typeof html !== 'string' || !html) {
        return handleResponse.call(this, html, request, href, options)
      }
      traversal = null
      const token = generation
      handleResponse.call(this, html, request, href, { ...options, scrollRestoration: false })
      if (token !== generation || window.location.href !== destination.state.url) return
      // Preserve page-owned markers and correct the target entry that PJAX just
      // overwrote. replaceState never creates an extra navigation entry.
      activeEntry = {
        ...window.history.state,
        ...destination.state,
        url: window.location.href,
        title: document.title,
        scrollPos: destination.position
      }
      window.history.replaceState(activeEntry, document.title, window.location.href)
      restorePosition(destination.position, token)
    }
  }

  // A title switch always has exactly one old/new node. Reading its document
  // avoids selector-count failures when the target omits optional metadata.
  const metadataSelector = 'link[rel="canonical"], meta[name="description"], '
    + 'meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]'
  const switchTitleAndMetadata = function (oldTitle, newTitle) {
    const incoming = Array.from(newTitle.ownerDocument.head.querySelectorAll(metadataSelector))
      .map(node => document.importNode(node, true))
    document.head.querySelectorAll(metadataSelector).forEach(node => node.remove())
    incoming.forEach(node => document.head.appendChild(node))
    window.Pjax.switches.outerHTML.call(this, oldTitle, newTitle)
  }

  window.SitePjaxNavigation = { installScrollRestoration, switchTitleAndMetadata }
})()
