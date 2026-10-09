(() => {
  'use strict'

  if (window.UpdatesPage) {
    window.UpdatesPage.init()
    return
  }

  let instance = null

  const create = root => {
    const runtime = window.SitePageRuntime.create({ name: 'updates' })
    const cards = Array.from(root.querySelectorAll('.updates-card'))
      .sort((a, b) => Number(a.dataset.updateOrder) - Number(b.dataset.updateOrder))
    const feed = root.querySelector('.updates-feed')
    const columns = root.querySelector('.updates-page__columns')
    const lanes = { text: root.querySelector('[data-updates-lane="text"]'), photo: root.querySelector('[data-updates-lane="photo"]') }
    const mobile = window.matchMedia('(max-width: 760px)')
    const orderControls = root.querySelector('.updates-order')
    const content = root.querySelector('.updates-page__body')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const motionStyle = window.getComputedStyle(root)
    const fadeOutDuration = parseFloat(motionStyle.getPropertyValue('--updates-fade-out-duration')) || 160
    const fadeInDuration = parseFloat(motionStyle.getPropertyValue('--updates-fade-in-duration')) || 240
    const easing = motionStyle.getPropertyValue('--updates-easing').trim() || 'ease'
    let sortOrder = root.dataset.sortOrder === 'oldest' ? 'oldest' : 'latest'
    let orderAnimation = null
    let orderGeneration = 0
    let orderSwitching = false
    const dialog = root.querySelector('.updates-lightbox')
    const fullImage = dialog.querySelector('.updates-lightbox__image')
    const caption = dialog.querySelector('.updates-lightbox__caption')
    const error = dialog.querySelector('.updates-lightbox__error')
    const previous = dialog.querySelector('.updates-lightbox__previous')
    const next = dialog.querySelector('.updates-lightbox__next')
    let photos = []
    let photoIndex = 0
    let trigger = null

    const refreshText = () => {
      if (runtime.isDestroyed()) return
      cards.forEach(card => {
        const text = card.querySelector('.updates-card__text')
        const button = card.querySelector('.updates-card__expand')
        if (text && button) button.hidden = !text.classList.contains('is-expanded') && text.scrollHeight <= text.clientHeight + 1
      })
    }

    const updateOrderControls = () => {
      root.dataset.sortOrder = sortOrder
      if (orderControls) {
        orderControls.hidden = false
        orderControls.dataset.activeOrder = sortOrder
      }
      orderControls?.querySelectorAll('[data-update-sort]').forEach(button => {
        const active = button.dataset.updateSort === sortOrder
        button.classList.toggle('is-active', active)
        button.setAttribute('aria-pressed', String(active))
        button.setAttribute('aria-disabled', String(orderSwitching))
      })
    }

    const layout = () => {
      const singleColumn = mobile.matches
      const orderedCards = sortOrder === 'latest' ? cards : [...cards].sort((a, b) =>
        Date.parse(a.querySelector('time').dateTime) - Date.parse(b.querySelector('time').dateTime)
          || Number(a.dataset.updateOrder) - Number(b.dataset.updateOrder))
      orderedCards.forEach(card => (singleColumn ? feed : lanes[card.dataset.updateKind]).append(card))
      columns.hidden = singleColumn
      feed.hidden = !singleColumn
      feed.setAttribute('aria-label', sortOrder === 'oldest' ? '按时间正序排列的动态' : '按时间倒序排列的动态')
      updateOrderControls()
      root.dataset.layout = singleColumn ? 'mobile' : 'desktop'
      root.dataset.ready = 'true'
      refreshText()
    }

    const finishOrderTransition = () => {
      orderGeneration += 1
      orderAnimation?.cancel()
      orderAnimation = null
      orderSwitching = false
      delete content.dataset.orderTransition
      content.removeAttribute('aria-busy')
      updateOrderControls()
    }

    const switchOrder = async nextOrder => {
      if (orderSwitching || sortOrder === nextOrder) return
      sortOrder = nextOrder
      const announce = () => {
        root.querySelector('.updates-order__status').textContent = sortOrder === 'oldest' ? '最早的动态在前' : '最新的动态在前'
      }
      if (!cards.length || reducedMotion.matches || typeof content.animate !== 'function') {
        layout()
        announce()
        return
      }

      const generation = ++orderGeneration
      const isCurrent = () => generation === orderGeneration && !runtime.isDestroyed()
      orderSwitching = true
      updateOrderControls()
      content.setAttribute('aria-busy', 'true')
      content.dataset.orderTransition = 'out'
      orderAnimation = runtime.addAnimation(content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeOutDuration, easing, fill: 'forwards' }))
      await orderAnimation.finished.catch(() => {})
      if (!isCurrent()) return

      layout()
      const fadeOut = orderAnimation
      content.dataset.orderTransition = 'in'
      orderAnimation = runtime.addAnimation(content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeInDuration, easing, fill: 'forwards' }))
      fadeOut.cancel()
      await orderAnimation.finished.catch(() => {})
      if (!isCurrent()) return

      finishOrderTransition()
      announce()
    }

    const renderPhoto = () => {
      const photo = photos[photoIndex]
      if (!photo) return
      error.hidden = true
      fullImage.hidden = false
      fullImage.alt = photo.querySelector('img').alt
      fullImage.src = photo.href
      caption.textContent = photo.dataset.caption || ''
      caption.hidden = !caption.textContent
      dialog.querySelector('.updates-lightbox__counter').textContent = `${photoIndex + 1} / ${photos.length}`
      previous.disabled = next.disabled = photos.length < 2
    }

    const stepPhoto = direction => {
      if (photos.length < 2) return
      photoIndex = (photoIndex + direction + photos.length) % photos.length
      renderPhoto()
    }

    runtime.addListener(root, 'click', event => {
      const sortButton = event.target.closest('[data-update-sort]')
      if (sortButton) {
        switchOrder(sortButton.dataset.updateSort)
        return
      }
      const button = event.target.closest('.updates-card__expand')
      if (button) {
        const text = document.getElementById(button.getAttribute('aria-controls'))
        const expanded = text.classList.toggle('is-expanded')
        button.setAttribute('aria-expanded', String(expanded))
        button.textContent = expanded ? '收起' : '展开全文'
        return
      }
      const photo = event.target.closest('[data-update-photo]')
      if (!photo || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      if (photo.getAttribute('aria-disabled') === 'true') {
        event.preventDefault()
        return
      }
      if (typeof dialog.showModal !== 'function') return
      event.preventDefault()
      photos = Array.from(photo.closest('.updates-card__photos').querySelectorAll('[data-update-photo]:not([aria-disabled="true"])'))
      photoIndex = photos.indexOf(photo)
      trigger = photo
      renderPhoto()
      dialog.showModal()
      document.documentElement.classList.add('updates-photo-open')
      dialog.querySelector('.updates-lightbox__close').focus()
    })

    runtime.addListener(dialog.querySelector('.updates-lightbox__close'), 'click', () => dialog.close())
    runtime.addListener(previous, 'click', () => stepPhoto(-1))
    runtime.addListener(next, 'click', () => stepPhoto(1))
    runtime.addListener(dialog, 'keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        stepPhoto(event.key === 'ArrowLeft' ? -1 : 1)
      }
    })
    runtime.addListener(dialog, 'click', event => {
      if (event.target !== dialog) return
      const bounds = dialog.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
    })
    runtime.addListener(dialog, 'close', () => {
      document.documentElement.classList.remove('updates-photo-open')
      fullImage.removeAttribute('src')
      trigger?.isConnected && trigger.focus({ preventScroll: true })
    })
    runtime.addListener(fullImage, 'error', () => {
      fullImage.hidden = true
      error.hidden = false
    })

    root.querySelectorAll('[data-update-photo] img').forEach(image => {
      const failed = () => {
        image.hidden = true
        image.parentElement.setAttribute('aria-disabled', 'true')
        image.parentElement.querySelector('.updates-card__photo-fallback').hidden = false
      }
      runtime.addListener(image, 'error', failed)
      if (image.complete && image.naturalWidth === 0) failed()
    })

    runtime.addListener(mobile, 'change', () => {
      finishOrderTransition()
      layout()
    })
    runtime.addListener(reducedMotion, 'change', () => {
      finishOrderTransition()
      layout()
    })
    runtime.addListener(window, 'resize', refreshText)
    runtime.addCleanup(() => {
      finishOrderTransition()
      if (dialog.open) dialog.close()
      document.documentElement.classList.remove('updates-photo-open')
      fullImage.removeAttribute('src')
    })
    layout()
    document.fonts?.ready.then(refreshText)
    return { root, destroy: () => runtime.destroy() }
  }

  const destroy = () => {
    instance?.destroy()
    instance = null
  }

  const init = () => {
    const root = document.querySelector('.updates-page')
    if (instance?.root === root) return
    destroy()
    if (root && window.SitePageRuntime?.create) instance = create(root)
  }

  window.UpdatesPage = Object.freeze({ init, destroy })
  document.addEventListener('pjax:send', destroy)
  document.addEventListener('pjax:complete', init)
  document.addEventListener('pjax:error', init)
  window.addEventListener('pagehide', destroy)
  window.addEventListener('pageshow', init)
  init()
})()
