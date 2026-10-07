(() => {
  'use strict'

  if (window.HomeContentEntries) {
    window.HomeContentEntries.init()
    return
  }

  const autoplayIntervals = { champions: 7000, moments: 9500 }
  let instances = []
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')

  const createEntry = root => {
    const runtime = window.SitePageRuntime?.create({ name: 'home-content-entry' })
    if (!runtime) return null
    const images = Array.from(root.querySelectorAll('.home-entry__image'))
    const slides = Array.from(root.querySelectorAll('.home-entry__slide'))
    const link = root.querySelector('.home-entry__link')
    const kind = root.dataset.homeEntry
    const interval = autoplayIntervals[kind]
    let index = 0
    let hovered = false
    let visible = false
    let timer = null
    let generation = 0
    let gesture = null
    let suppressClickUntil = 0
    let notBefore = 0
    const loads = new Map()
    const pickRandomIndex = (exclude = -1) => {
      if (images.length < 2) return 0
      const choice = Math.floor(Math.random() * (images.length - (exclude >= 0 ? 1 : 0)))
      return exclude >= 0 && choice >= exclude ? choice + 1 : choice
    }
    let nextIndex = pickRandomIndex(index)

    const stop = () => {
      if (timer === null) return
      window.clearTimeout(timer)
      runtime.removeTimer(timer)
      timer = null
    }
    const load = i => {
      if (loads.has(i)) return loads.get(i)
      const image = images[i]
      const promise = new Promise(resolve => {
        if (image.complete && image.naturalWidth > 0) return resolve(true)
        const finish = ok => {
          removeLoad()
          removeError()
          resolve(ok)
        }
        const removeLoad = runtime.addListener(image, 'load', () => finish(true), { once: true })
        const removeError = runtime.addListener(image, 'error', () => finish(false), { once: true })
        if (image.dataset.src) {
          image.src = image.dataset.src
          delete image.dataset.src
        } else if (image.complete && image.naturalWidth === 0) finish(false)
      })
      const decoded = promise.then(async loaded => {
        if (!loaded) return false
        try {
          if (typeof image.decode === 'function') await image.decode()
          return image.naturalWidth > 0
        } catch {
          return false
        }
      })
      loads.set(i, decoded)
      return decoded
    }
    const eligible = () => !runtime.isDestroyed() && visible && !hovered &&
      !root.contains(document.activeElement) && !document.hidden && !motion.matches && images.length > 1
    const schedule = () => {
      stop()
      if (!eligible()) return
      timer = runtime.addTimer(window.setTimeout(() => {
        runtime.removeTimer(timer)
        timer = null
        show(nextIndex, false)
      }, Math.max(interval, notBefore - Date.now())))
    }
    const show = async (requested, manual) => {
      stop()
      const target = (requested + images.length) % images.length
      const request = ++generation
      if (manual) notBefore = Date.now() + 10000
      const ready = await load(target)
      if (runtime.isDestroyed() || request !== generation) return
      if (ready) {
        // Keep the outgoing image opaque until the incoming fade has finished.
        images.forEach(image => image.classList.remove('is-underlay'))
        const animate = target !== index && !motion.matches
        if (animate) {
          images[index].classList.add('is-underlay')
          images[target].classList.add('is-preparing')
        }
        images.forEach((image, i) => {
          image.classList.toggle('is-active', i === target)
          image.setAttribute('aria-hidden', String(i !== target))
          slides[i].setAttribute('aria-hidden', String(i !== target))
          slides[i].classList.toggle('is-active', i === target)
        })
        if (animate) {
          // Establish a decoded, transparent first frame before fading it in.
          void images[target].offsetWidth
          images[target].classList.remove('is-preparing')
        }
        index = target
        link.href = images[index].dataset.entryUrl
        link.setAttribute('aria-label', `${slides[index].querySelector('h2').textContent}，打开详情`)
        nextIndex = pickRandomIndex(index)
        if (manual) root.querySelector('.home-entry__status').textContent = `${index + 1} / ${images.length}，${slides[index].querySelector('h2').textContent}`
        if (visible && !navigator.connection?.saveData) load(nextIndex)
      } else {
        nextIndex = pickRandomIndex(index)
        if (manual) root.querySelector('.home-entry__status').textContent = '图片暂时无法加载。'
      }
      schedule()
    }

    images.forEach(image => runtime.addListener(image, 'transitionend', event => {
      if (event.propertyName !== 'opacity' || !image.classList.contains('is-active')) return
      images.forEach(photo => photo.classList.remove('is-underlay'))
    }))
    runtime.addListener(root, 'mouseenter', () => { hovered = true; stop() })
    runtime.addListener(root, 'mouseleave', () => { hovered = false; schedule() })
    runtime.addListener(root, 'focusin', stop)
    runtime.addListener(root, 'focusout', () => queueMicrotask(schedule))
    runtime.addListener(document, 'visibilitychange', schedule)
    runtime.addListener(motion, 'change', schedule)
    runtime.addListener(link, 'pointerdown', event => {
      if (event.pointerType !== 'touch' || !event.isPrimary) return
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY }
      stop()
    }, { passive: true })
    runtime.addListener(link, 'pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return
      const dx = event.clientX - gesture.x
      const dy = event.clientY - gesture.y
      gesture = null
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        suppressClickUntil = Date.now() + 500
        show(nextIndex, true)
      } else schedule()
    }, { passive: true })
    runtime.addListener(link, 'pointercancel', () => { gesture = null; schedule() }, { passive: true })
    runtime.addListener(link, 'click', event => {
      if (Date.now() >= suppressClickUntil) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }, true)

    if ('IntersectionObserver' in window) {
      runtime.addObserver(new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting
        if (visible && !navigator.connection?.saveData) load(nextIndex)
        schedule()
      }, { threshold: .15 })).observe(root)
    } else visible = true
    runtime.addCleanup(() => {
      generation += 1
      stop()
      loads.clear()
      images.forEach(image => image.classList.remove('is-underlay', 'is-preparing'))
    })
    show(pickRandomIndex(), false)
    return { root, destroy: () => runtime.destroy() }
  }

  const destroy = () => {
    instances.forEach(instance => instance.destroy())
    instances = []
  }
  const init = () => {
    const roots = Array.from(document.querySelectorAll('[data-home-entry]'))
    if (instances.length && instances.every(instance => roots.includes(instance.root))) return
    destroy()
    instances = roots.map(createEntry).filter(Boolean)
  }
  window.HomeContentEntries = Object.freeze({ init, destroy })
  document.addEventListener('pjax:send', destroy)
  document.addEventListener('pjax:complete', init)
  document.addEventListener('pjax:error', init)
  window.addEventListener('pagehide', destroy)
  window.addEventListener('pageshow', init)
  init()
})()
