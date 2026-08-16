/**
 * @typedef {{width: number, height: number}} PhotoMetrics
 * @typedef {Object} MemoryPlacement
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} centerX
 * @property {number} centerY
 * @property {number} rotation
 * @property {{left: number, right: number, top: number, bottom: number}} collision
 * @property {number} stageWidth
 * @property {number} stageHeight
 */
(() => {
  'use strict'

  if (window.JinshanMemoryField) {
    window.JinshanMemoryField.init()
    return
  }

  const rootSelector = '.jinshan-memory-page'
  const stageSelector = '.jinshan-memory-field__stage'
  const cardEasing = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const fadeInDurationMs = 820
  const fadeOutDurationMs = 620
  const reducedDurationMs = 100
  const holdMinMs = 4500
  const holdMaxMs = 7000
  const initialStaggerMs = 260
  const preloadCandidateCount = 4
  const recentCenterLimit = 8
  const emptySlotRetryDelayMs = 900
  const failedPhotoRetryDelayMs = 240
  const resizeDebounceMs = 100
  const lightboxSwipeThresholdPx = 44
  const runtime = {
    lifecycle: null,
    root: null,
    stage: null,
    slots: [],
    photos: [],
    photoMetrics: new Map(),
    failedPhotos: new Set(),
    queue: [],
    queueIndex: 0,
    previousPhoto: null,
    activeSlots: new Map(),
    reservedPlacements: new Map(),
    recentCenters: [],
    lastDepartureCenter: null,
    reservedPhotos: new Set(),
    pendingSlots: new Set(),
    slotTimers: new Map(),
    timers: new Set(),
    pauseReasons: new Set(),
    motionQuery: null,
    motionHandler: null,
    resizeHandler: null,
    resizeTimer: null,
    resizeFrame: null,
    lightbox: null,
    lightboxPhotos: [],
    lightboxIndex: 0,
    pointerStartX: null,
    lastFocusedButton: null,
    generation: 0
  }

  const isPaused = () => runtime.pauseReasons.size > 0
  const isLive = generation => generation === runtime.generation
    && runtime.lifecycle
    && !runtime.lifecycle.isDestroyed()
    && runtime.root?.isConnected
  const prefersReducedMotion = () => runtime.motionQuery?.matches === true

  const trackListener = (target, event, handler, options) => {
    runtime.lifecycle?.addListener(target, event, handler, options)
  }

  const trackAnimation = animation => {
    return runtime.lifecycle?.addAnimation(animation) || animation
  }

  const animationTransform = (offset, rotation) =>
    `translate3d(0, ${offset}px, 0) rotate(${rotation})`

  const animateCard = async (card, mode, rotation, generation) => {
    if (!card || !isLive(generation)) return false

    const reduced = prefersReducedMotion()
    const duration = reduced ? reducedDurationMs : mode === 'in' ? fadeInDurationMs : fadeOutDurationMs
    const keyframes = mode === 'in'
      ? [
          { opacity: 0, transform: animationTransform(reduced ? 0 : 12, rotation) },
          { opacity: 1, transform: animationTransform(0, rotation) }
        ]
      : [
          { opacity: 1, transform: animationTransform(0, rotation) },
          { opacity: 0, transform: animationTransform(0, rotation) }
        ]
    const animation = trackAnimation(card.animate(keyframes, { duration, easing: cardEasing, fill: 'both' }))
    try {
      await animation.finished
    } catch {}
    return isLive(generation)
  }

  const armTimer = timer => {
    timer.dueAt = Date.now() + timer.remaining
    timer.id = window.setTimeout(() => {
      const id = timer.id
      timer.id = null
      runtime.lifecycle?.removeTimer(id)
      if (isPaused()) {
        timer.remaining = 0
        return
      }
      runtime.timers.delete(timer)
      timer.callback()
    }, Math.max(0, timer.remaining))
    runtime.lifecycle?.addTimer(timer.id)
  }

  const scheduleTimer = (callback, delay) => {
    const timer = { callback, delay, remaining: delay, dueAt: 0, id: null }
    runtime.timers.add(timer)
    if (!isPaused()) armTimer(timer)
    return timer
  }

  const clearTimers = () => {
    runtime.timers.forEach(timer => {
      if (timer.id !== null) {
        window.clearTimeout(timer.id)
        runtime.lifecycle?.removeTimer(timer.id)
      }
    })
    runtime.timers.clear()
    runtime.slotTimers.clear()
  }

  const clearSlotTimer = slot => {
    const timer = runtime.slotTimers.get(slot)
    if (!timer) return
    if (timer.id !== null) {
      window.clearTimeout(timer.id)
      runtime.lifecycle?.removeTimer(timer.id)
    }
    runtime.timers.delete(timer)
    runtime.slotTimers.delete(slot)
  }

  const scheduleSlotTimer = (slot, callback, delay) => {
    clearSlotTimer(slot)
    const timer = scheduleTimer(() => {
      if (runtime.slotTimers.get(slot) === timer) runtime.slotTimers.delete(slot)
      callback()
    }, delay)
    runtime.slotTimers.set(slot, timer)
    return timer
  }

  const pauseTimers = () => {
    const now = Date.now()
    runtime.timers.forEach(timer => {
      if (timer.id === null) return
      window.clearTimeout(timer.id)
      runtime.lifecycle?.removeTimer(timer.id)
      timer.id = null
      timer.remaining = Math.max(0, timer.dueAt - now)
    })
  }

  const resumeTimers = () => {
    runtime.timers.forEach(timer => {
      if (timer.id === null) armTimer(timer)
    })
  }

  const cancelAnimations = () => runtime.lifecycle?.forEachAnimation(animation => {
    try { animation.cancel() } catch {}
  })

  const pauseAnimations = () => runtime.lifecycle?.forEachAnimation(animation => {
    try { animation.pause() } catch {}
  })

  const resumeAnimations = () => runtime.lifecycle?.forEachAnimation(animation => {
    try { animation.play() } catch {}
  })

  const updatePauseReason = (reason, shouldPause) => {
    const wasPaused = isPaused()
    if (shouldPause) runtime.pauseReasons.add(reason)
    else runtime.pauseReasons.delete(reason)
    const nowPaused = isPaused()
    if (wasPaused === nowPaused) return
    if (nowPaused) {
      pauseTimers()
      pauseAnimations()
    } else {
      resumeAnimations()
      resumeTimers()
      fillEmptySlots()
    }
  }

  const randomBetween = (min, max) => min + Math.random() * (max - min)

  const shuffle = values => {
    const result = values.slice()
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
    }
    return result
  }

  const refillQueue = () => {
    runtime.queue = shuffle(runtime.photos.filter(photo => !runtime.failedPhotos.has(photo)))
    if (runtime.queue.length > 1 && runtime.queue[0] === runtime.previousPhoto) {
      const swapIndex = runtime.queue.findIndex(photo => photo !== runtime.previousPhoto)
      if (swapIndex > 0) {
        ;[runtime.queue[0], runtime.queue[swapIndex]] = [runtime.queue[swapIndex], runtime.queue[0]]
      }
    }
    runtime.queueIndex = 0
  }

  const activePhotos = () => new Set([
    ...Array.from(runtime.activeSlots.values()).map(item => item.photo),
    ...runtime.reservedPhotos
  ])

  const takeNextPhoto = () => {
    if (!runtime.photos.length) return null
    const blocked = activePhotos()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (runtime.queueIndex >= runtime.queue.length) refillQueue()
      const availableIndex = runtime.queue.findIndex((photo, index) =>
        index >= runtime.queueIndex
        && !blocked.has(photo)
        && photo !== runtime.previousPhoto
        && !runtime.failedPhotos.has(photo)
      )
      if (availableIndex >= 0) {
        const photo = runtime.queue[availableIndex]
        runtime.queue.splice(availableIndex, 1)
        return photo
      }
      runtime.queueIndex = runtime.queue.length
    }
    return null
  }

  const readPhotoMetrics = source => new Promise(resolve => {
    const image = document.createElement('img')
    image.decoding = 'async'
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = source
  })

  /** @returns {Promise<PhotoMetrics|null>} Natural dimensions for a usable photo source. */
  const loadPhoto = (source, { priority = 0, generation = runtime.generation } = {}) => {
    const sharedPreload = window.SitePrefetch?.preloadAsset
    const preload = typeof sharedPreload === 'function'
      ? sharedPreload(source, { priority })
      : Promise.resolve({ ok: true })
    const promise = preload.then(result => result?.ok === false ? null : readPhotoMetrics(source)).then(metrics => {
      if (!isLive(generation)) return null
      if (!metrics?.width || !metrics?.height) {
        runtime.failedPhotos.add(source)
        return null
      }
      runtime.photoMetrics.set(source, metrics)
      return metrics
    }).catch(() => {
      if (isLive(generation)) runtime.failedPhotos.add(source)
      return null
    })
    return promise
  }

  const preloadCandidates = () => {
    const blocked = activePhotos()
    const candidates = runtime.queue
      .slice(runtime.queueIndex)
      .filter(photo => !blocked.has(photo) && !runtime.failedPhotos.has(photo))
      .slice(0, preloadCandidateCount)
    const sharedPreload = window.SitePrefetch?.preloadAsset
    if (typeof sharedPreload === 'function') {
      candidates.forEach(source => { void sharedPreload(source, { priority: 1 }).catch(() => {}) })
      return
    }
    const generation = runtime.generation
    candidates.forEach(source => { void loadPhoto(source, { priority: 1, generation }) })
  }

  const slotCount = () => {
    if (window.innerWidth <= 430) return 2
    if (window.innerWidth <= 900) return 3
    if (window.innerWidth >= 1360) return 5
    return 4
  }

  const slotIsAvailable = slot => runtime.slots.indexOf(slot) >= 0 && runtime.slots.indexOf(slot) < slotCount()

  // Keep layout units in the returned settings so placement math reads like a geometry contract.
  const layoutSettings = () => {
    if (window.innerWidth <= 430) {
      return {
        marginPx: 12,
        collisionGapPx: 14,
        rotationPaddingPx: 10,
        rotationLimitDeg: 0.7,
        minDepartureDistancePx: 68,
        horizontalWidthPx: [220, 286],
        verticalWidthPx: [160, 208],
        squareWidthPx: [190, 236],
        horizontalHeightPx: 190,
        verticalHeightPx: 230,
        squareHeightPx: 236
      }
    }
    if (window.innerWidth <= 600) {
      return {
        marginPx: 12,
        collisionGapPx: 16,
        rotationPaddingPx: 10,
        rotationLimitDeg: 0.8,
        minDepartureDistancePx: 76,
        horizontalWidthPx: [230, 300],
        verticalWidthPx: [170, 220],
        squareWidthPx: [210, 258],
        horizontalHeightPx: 210,
        verticalHeightPx: 250,
        squareHeightPx: 258
      }
    }
    if (window.innerWidth <= 900) {
      return {
        marginPx: 18,
        collisionGapPx: 20,
        rotationPaddingPx: 12,
        rotationLimitDeg: 1.2,
        minDepartureDistancePx: 104,
        horizontalWidthPx: [280, 350],
        verticalWidthPx: [210, 270],
        squareWidthPx: [250, 310],
        horizontalHeightPx: 250,
        verticalHeightPx: 320,
        squareHeightPx: 310
      }
    }
    return {
      marginPx: window.innerWidth >= 1360 ? 32 : 28,
      collisionGapPx: window.innerWidth >= 1360 ? 28 : 26,
      rotationPaddingPx: 14,
      rotationLimitDeg: 1.8,
      minDepartureDistancePx: window.innerWidth >= 1360 ? 150 : 132,
      horizontalWidthPx: window.innerWidth >= 1360 ? [340, 392] : [370, 452],
      verticalWidthPx: window.innerWidth >= 1360 ? [248, 300] : [260, 316],
      squareWidthPx: window.innerWidth >= 1360 ? [292, 346] : [300, 368],
      horizontalHeightPx: 300,
      verticalHeightPx: 390,
      squareHeightPx: 368
    }
  }

  const getLayoutContext = () => {
    const stageRect = runtime.stage?.getBoundingClientRect()
    if (!stageRect) return null
    const settings = layoutSettings()
    const titleRect = runtime.root?.querySelector('.jinshan-memory-page__title')?.getBoundingClientRect()
    const periodRect = runtime.root?.querySelector('.jinshan-memory-page__period')?.getBoundingClientRect()
    const epilogueRect = runtime.root?.querySelector('.jinshan-memory__epilogue')?.getBoundingClientRect()
    const headingBottom = Math.max(titleRect?.bottom || 0, periodRect?.bottom || 0)
    const top = Math.max(settings.marginPx, headingBottom - stageRect.top + settings.marginPx)
    const epilogueClearance = epilogueRect ? stageRect.bottom - epilogueRect.top + settings.marginPx : settings.marginPx
    const bottom = Math.min(stageRect.height - settings.marginPx, stageRect.height - Math.max(settings.marginPx, epilogueClearance))
    return {
      width: stageRect.width,
      height: stageRect.height,
      safe: {
        left: settings.marginPx,
        top: Math.min(top, stageRect.height - settings.marginPx),
        right: stageRect.width - settings.marginPx,
        bottom: Math.max(bottom, top + settings.marginPx)
      },
      settings
    }
  }

  const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y)

  const rotatedBounds = (width, height, rotation) => {
    const radians = Math.abs(rotation) * Math.PI / 180
    return {
      width: Math.abs(Math.cos(radians) * width) + Math.abs(Math.sin(radians) * height),
      height: Math.abs(Math.cos(radians) * height) + Math.abs(Math.sin(radians) * width)
    }
  }

  const overlaps = (first, second) =>
    first.left < second.right && second.left < first.right && first.top < second.bottom && second.top < first.bottom

  const photoSize = (metrics, context, scale = 1) => {
    const aspect = metrics.width / metrics.height
    const settings = context.settings
    let targetWidth
    let maxHeight
    if (aspect > 1.2) {
      targetWidth = randomBetween(settings.horizontalWidthPx[0], settings.horizontalWidthPx[1])
      maxHeight = settings.horizontalHeightPx
    } else if (aspect < 0.82) {
      targetWidth = randomBetween(settings.verticalWidthPx[0], settings.verticalWidthPx[1])
      maxHeight = settings.verticalHeightPx
    } else {
      targetWidth = randomBetween(settings.squareWidthPx[0], settings.squareWidthPx[1])
      maxHeight = settings.squareHeightPx
    }
    targetWidth *= scale
    const maxWidth = Math.min(context.width - context.settings.marginPx * 2, targetWidth)
    const width = Math.min(metrics.width, maxWidth)
    const height = width / aspect
    if (height <= maxHeight && height <= context.height) return { width, height }
    const limitedHeight = Math.min(maxHeight, context.height)
    return { width: limitedHeight * aspect, height: limitedHeight }
  }

  const collectOccupiedPlacements = ignoreSlot => [
    ...Array.from(runtime.activeSlots.entries())
      .filter(([slot]) => slot !== ignoreSlot)
      .map(([, item]) => item.placement),
    ...Array.from(runtime.reservedPlacements.entries())
      .filter(([slot]) => slot !== ignoreSlot)
      .map(([, placement]) => placement)
  ].filter(Boolean)

  const historyCenters = context => runtime.recentCenters.map(center => ({
    x: center.x * context.width,
    y: center.y * context.height
  }))

  const placementFor = (context, size, center, rotation) => {
    const bounds = rotatedBounds(size.width, size.height, rotation)
    const padding = context.settings.collisionGapPx + context.settings.rotationPaddingPx
    return {
      left: center.x - size.width / 2,
      top: center.y - size.height / 2,
      width: size.width,
      height: size.height,
      centerX: center.x,
      centerY: center.y,
      rotation,
      collision: {
        left: center.x - bounds.width / 2 - padding,
        right: center.x + bounds.width / 2 + padding,
        top: center.y - bounds.height / 2 - padding,
        bottom: center.y + bounds.height / 2 + padding
      },
      stageWidth: context.width,
      stageHeight: context.height
    }
  }

  const placementIsSafe = (placement, context, occupied, departureCenter, minimumDepartureDistance) => {
    const { collision } = placement
    if (
      collision.left < context.safe.left
      || collision.right > context.safe.right
      || collision.top < context.safe.top
      || collision.bottom > context.safe.bottom
    ) return false
    if (occupied.some(item => overlaps(collision, item.collision))) return false
    if (departureCenter && distance({ x: placement.centerX, y: placement.centerY }, departureCenter) < minimumDepartureDistance) return false
    return true
  }

  const placementScore = (placement, context, occupied, history, departureCenter) => {
    const center = { x: placement.centerX, y: placement.centerY }
    const nearestOccupied = occupied.length
      ? Math.min(...occupied.map(item => distance(center, { x: item.centerX, y: item.centerY })))
      : Math.min(context.width, context.height)
    const nearestHistory = history.length
      ? Math.min(...history.map(item => distance(center, item)))
      : Math.min(context.width, context.height)
    const departureDistance = departureCenter ? distance(center, departureCenter) : Math.min(context.width, context.height)
    const centerDistance = distance(center, { x: context.width / 2, y: context.height / 2 })
    return nearestOccupied * 1.18
      + Math.min(nearestHistory, 520) * 0.28
      + Math.min(departureDistance, 440) * 0.34
      - centerDistance * 0.08
      + Math.random() * 6
  }

  const fallbackCenters = [
    [0.14, 0.17], [0.5, 0.17], [0.86, 0.17],
    [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
    [0.14, 0.83], [0.5, 0.83], [0.86, 0.83],
    [0.32, 0.32], [0.68, 0.68]
  ]

  /**
   * Choose a collision-safe placement without mutating the DOM. The caller owns
   * reservation and rendering so reflow can reuse the same geometry routine.
   * @returns {MemoryPlacement|null}
   */
  const findPlacement = (metrics, ignoreSlot = null, occupiedOverride = null, avoidHistory = true, preferredScale = 1) => {
    const context = getLayoutContext()
    if (!context || !metrics?.width || !metrics?.height) return null
    const occupied = occupiedOverride || collectOccupiedPlacements(ignoreSlot)
    const history = avoidHistory ? historyCenters(context) : []
    const departureCenter = avoidHistory && runtime.lastDepartureCenter
      ? { x: runtime.lastDepartureCenter.x * context.width, y: runtime.lastDepartureCenter.y * context.height }
      : null
    const minimumDepartureDistance = avoidHistory ? context.settings.minDepartureDistancePx : 0
    const baseScale = Math.min(1, Math.max(0.68, preferredScale))
    const attempts = [
      { scale: baseScale, count: 32, minDeparture: minimumDepartureDistance },
      { scale: baseScale * 0.95, count: 16, minDeparture: minimumDepartureDistance },
      { scale: baseScale * 0.9, count: 16, minDeparture: 0 },
      { scale: baseScale * 0.84, count: 16, minDeparture: 0 },
      { scale: baseScale * 0.76, count: 10, minDeparture: 0 },
      { scale: baseScale * 0.68, count: 8, minDeparture: 0 }
    ]
    for (const attempt of attempts) {
      const size = photoSize(metrics, context, attempt.scale)
      const rotation = randomBetween(-context.settings.rotationLimitDeg, context.settings.rotationLimitDeg)
      let best = null
      let bestScore = -Infinity
      for (let index = 0; index < attempt.count; index += 1) {
        const bounds = rotatedBounds(size.width, size.height, rotation)
        const padding = context.settings.collisionGapPx + context.settings.rotationPaddingPx
        const minX = context.safe.left + bounds.width / 2 + padding
        const maxX = context.safe.right - bounds.width / 2 - padding
        const minY = context.safe.top + bounds.height / 2 + padding
        const maxY = context.safe.bottom - bounds.height / 2 - padding
        if (minX > maxX || minY > maxY) break
        const candidate = placementFor(context, size, {
          x: randomBetween(minX, maxX),
          y: randomBetween(minY, maxY)
        }, rotation)
        if (!placementIsSafe(candidate, context, occupied, departureCenter, attempt.minDeparture)) continue
        const score = placementScore(candidate, context, occupied, history, departureCenter)
        if (score > bestScore) {
          best = candidate
          bestScore = score
        }
      }
      if (best) return best
    }

    const fallbackScale = baseScale * 0.68
    const size = photoSize(metrics, context, fallbackScale)
    const rotation = randomBetween(-context.settings.rotationLimitDeg, context.settings.rotationLimitDeg)
    for (const [xRatio, yRatio] of shuffle(fallbackCenters)) {
      const candidate = placementFor(context, size, {
        x: context.width * xRatio,
        y: context.height * yRatio
      }, rotation)
      if (placementIsSafe(candidate, context, occupied, null, 0)) return candidate
    }
    return null
  }

  const applyPlacement = (slot, card, placement) => {
    slot.style.left = `${placement.left}px`
    slot.style.top = `${placement.top}px`
    slot.style.width = `${placement.width}px`
    slot.style.height = `${placement.height}px`
    slot.style.setProperty('--jinshan-slot-rotation', `${placement.rotation.toFixed(2)}deg`)
    if (card) card.style.transform = animationTransform(0, `${placement.rotation.toFixed(2)}deg`)
  }

  const rememberCenter = placement => {
    if (!placement?.stageWidth || !placement.stageHeight) return
    runtime.recentCenters.push({
      x: placement.centerX / placement.stageWidth,
      y: placement.centerY / placement.stageHeight
    })
    runtime.recentCenters = runtime.recentCenters.slice(-recentCenterLimit)
  }

  const requeuePhoto = source => {
    if (!source || runtime.failedPhotos.has(source) || runtime.photos.includes(source) === false) return
    if (!runtime.queue.includes(source) && !activePhotos().has(source)) runtime.queue.push(source)
  }

  const preparePhotoForSlot = async (slot, source, generation = runtime.generation) => {
    const metrics = await loadPhoto(source, { generation })
    if (!metrics || !isLive(generation)) return null
    const placement = findPlacement(metrics, slot)
    if (!placement) return null
    runtime.reservedPlacements.set(slot, placement)
    return { metrics, placement }
  }

  const clearSlot = (slot, hide = true) => {
    clearSlotTimer(slot)
    const current = runtime.activeSlots.get(slot)
    if (current) {
      runtime.activeSlots.delete(slot)
      if (current.photo) runtime.previousPhoto = current.photo
    }
    slot.replaceChildren()
    slot.style.removeProperty('left')
    slot.style.removeProperty('top')
    slot.style.removeProperty('width')
    slot.style.removeProperty('height')
    slot.style.removeProperty('--jinshan-slot-rotation')
    slot.classList.remove('is-active', 'is-entering')
    slot.disabled = true
    slot.hidden = hide
    slot.setAttribute('aria-hidden', 'true')
    slot.tabIndex = -1
  }

  const setSlotVisible = slot => {
    slot.hidden = false
    slot.disabled = false
    slot.removeAttribute('aria-hidden')
    slot.tabIndex = 0
    slot.classList.add('is-active')
  }

  const showPhotoInSlot = async (slot, source, generation, prepared = null) => {
    if (!isLive(generation) || isPaused() || !slotIsAvailable(slot)) return false
    const ready = prepared || await preparePhotoForSlot(slot, source, generation)
    if (!ready || !isLive(generation) || isPaused() || !slotIsAvailable(slot)) {
      runtime.reservedPlacements.delete(slot)
      return false
    }
    const card = document.createElement('span')
    card.className = 'jinshan-memory-card'
    const image = document.createElement('img')
    image.src = source
    image.alt = '金山中学旧照片'
    image.loading = 'eager'
    image.decoding = 'async'
    card.append(image)
    slot.replaceChildren(card)
    applyPlacement(slot, card, ready.placement)
    runtime.activeSlots.set(slot, { photo: source, card, placement: ready.placement })
    runtime.reservedPlacements.delete(slot)
    setSlotVisible(slot)
    slot.setAttribute('aria-label', '打开金山中学旧照片')
    slot.classList.add('is-entering')
    const entered = await animateCard(card, 'in', `${ready.placement.rotation.toFixed(2)}deg`, generation)
    if (!entered || !isLive(generation)) return false
    slot.classList.remove('is-entering')
    rememberCenter(ready.placement)
    scheduleSlotTimer(slot, () => replaceSlot(slot), randomBetween(holdMinMs, holdMaxMs))
    preloadCandidates()
    return true
  }

  const fillSlot = async (slot, generation = runtime.generation) => {
    if (!isLive(generation) || isPaused() || runtime.activeSlots.has(slot) || runtime.pendingSlots.has(slot)) return
    runtime.pendingSlots.add(slot)
    const source = takeNextPhoto()
    if (!source) {
      runtime.pendingSlots.delete(slot)
      scheduleSlotTimer(slot, () => fillSlot(slot, generation), emptySlotRetryDelayMs)
      return
    }
    runtime.reservedPhotos.add(source)
    try {
      const shown = await showPhotoInSlot(slot, source, generation)
      runtime.reservedPhotos.delete(source)
      if (!shown && isLive(generation) && !runtime.failedPhotos.has(source)) {
        requeuePhoto(source)
        scheduleSlotTimer(slot, () => fillSlot(slot, generation), failedPhotoRetryDelayMs)
      }
    } finally {
      runtime.pendingSlots.delete(slot)
    }
  }

  const replaceSlot = async slot => {
    if (!runtime.activeSlots.has(slot) || isPaused() || !runtime.root?.isConnected) return
    const generation = runtime.generation
    const current = runtime.activeSlots.get(slot)
    const next = takeNextPhoto()
    if (!current || !next) {
      scheduleSlotTimer(slot, () => replaceSlot(slot), emptySlotRetryDelayMs)
      return
    }
    runtime.reservedPhotos.add(next)
    const oldCard = current.card
    const prepared = await preparePhotoForSlot(slot, next, generation)
    if (!prepared || !isLive(generation) || isPaused() || !slotIsAvailable(slot)) {
      runtime.reservedPlacements.delete(slot)
      runtime.reservedPhotos.delete(next)
      requeuePhoto(next)
      if (isLive(generation) && !runtime.failedPhotos.has(next)) scheduleSlotTimer(slot, () => replaceSlot(slot), failedPhotoRetryDelayMs)
      return
    }
    runtime.lastDepartureCenter = current.placement ? {
      x: current.placement.centerX / current.placement.stageWidth,
      y: current.placement.centerY / current.placement.stageHeight
    } : null
    const faded = await animateCard(oldCard, 'out', `${current.placement?.rotation?.toFixed(2) || 0}deg`, generation)
    if (!faded || !isLive(generation) || isPaused() || !slotIsAvailable(slot)) {
      runtime.reservedPlacements.delete(slot)
      runtime.reservedPhotos.delete(next)
      requeuePhoto(next)
      return
    }
    runtime.activeSlots.delete(slot)
    runtime.previousPhoto = current.photo
    const shown = await showPhotoInSlot(slot, next, generation, prepared)
    runtime.reservedPhotos.delete(next)
    if (!shown && isLive(generation) && !isPaused() && slotIsAvailable(slot)) {
      requeuePhoto(next)
      scheduleSlotTimer(slot, () => fillSlot(slot, generation), failedPhotoRetryDelayMs)
    }
  }

  const fillEmptySlots = () => {
    if (!runtime.root || isPaused()) return
    runtime.slots.slice(0, slotCount()).forEach((slot, index) => {
      if (!runtime.activeSlots.has(slot) && !runtime.pendingSlots.has(slot)) {
        scheduleSlotTimer(slot, () => fillSlot(slot), index * initialStaggerMs)
      }
    })
  }

  const reflowActiveCards = (preferredScale = 1) => {
    if (!runtime.activeSlots.size) return
    const context = getLayoutContext()
    if (!context) return
    const entries = Array.from(runtime.activeSlots.entries())
      .filter(([slot]) => slotIsAvailable(slot))
      .sort(([, first], [, second]) => {
        const firstMetrics = runtime.photoMetrics.get(first.photo)
        const secondMetrics = runtime.photoMetrics.get(second.photo)
        return (secondMetrics?.width * secondMetrics?.height || 0) - (firstMetrics?.width * firstMetrics?.height || 0)
      })
    const planAtScale = scale => {
      const occupied = []
      const plan = []
      for (const [slot, item] of entries) {
        const metrics = runtime.photoMetrics.get(item.photo)
        const placement = findPlacement(metrics, slot, occupied, false, scale)
        if (!placement) return null
        plan.push({ slot, item, placement })
        occupied.push(placement)
      }
      return plan
    }
    const plan = [preferredScale, preferredScale * 0.9, preferredScale * 0.78]
      .map(scale => Math.min(1, Math.max(0.68, scale)))
      .map(scale => planAtScale(scale))
      .find(Boolean)
    if (!plan) return
    cancelAnimations()
    plan.forEach(({ slot, item, placement }) => {
      applyPlacement(slot, item.card, placement)
      item.placement = placement
      item.card.style.opacity = '1'
    })
  }

  const syncSlots = () => {
    const visibleSlots = new Set(runtime.slots.slice(0, slotCount()))
    runtime.slots.forEach(slot => {
      if (!visibleSlots.has(slot)) clearSlot(slot)
      else if (!runtime.activeSlots.has(slot)) {
        slot.className = 'jinshan-memory-slot'
      }
    })
    reflowActiveCards()
    fillEmptySlots()
  }

  const scheduleResize = () => {
    if (runtime.resizeTimer) {
      window.clearTimeout(runtime.resizeTimer)
      runtime.lifecycle?.removeTimer(runtime.resizeTimer)
    }
    if (runtime.resizeFrame) {
      window.cancelAnimationFrame(runtime.resizeFrame)
      runtime.lifecycle?.removeFrame(runtime.resizeFrame)
    }
    runtime.resizeFrame = null
    runtime.resizeTimer = window.setTimeout(() => {
      const timer = runtime.resizeTimer
      runtime.resizeTimer = null
      runtime.lifecycle?.removeTimer(timer)
      const frame = window.requestAnimationFrame(() => {
        runtime.resizeFrame = null
        runtime.lifecycle?.removeFrame(frame)
        syncSlots()
      })
      runtime.resizeFrame = frame
      runtime.lifecycle?.addFrame(frame)
    }, resizeDebounceMs)
    runtime.lifecycle?.addTimer(runtime.resizeTimer)
  }

  const currentLightboxPhoto = () => runtime.lightboxPhotos[runtime.lightboxIndex]

  const updateLightbox = () => {
    const lightbox = runtime.lightbox
    const source = currentLightboxPhoto()
    if (!lightbox || !source) return
    const image = lightbox.querySelector('.jinshan-memory-lightbox__image')
    const counter = lightbox.querySelector('.jinshan-memory-lightbox__counter')
    const previous = lightbox.querySelector('.jinshan-memory-lightbox__button--previous')
    const next = lightbox.querySelector('.jinshan-memory-lightbox__button--next')
    image.src = source
    image.alt = '金山中学旧照片'
    const disabled = runtime.lightboxPhotos.length < 2
    previous.hidden = disabled
    next.hidden = disabled
    previous.disabled = disabled
    next.disabled = disabled
    counter.textContent = `${runtime.lightboxIndex + 1} / ${runtime.lightboxPhotos.length}`
  }

  const closeLightbox = () => {
    if (!runtime.lightbox) return
    runtime.lightbox.hidden = true
    runtime.lightbox.classList.remove('is-open')
    document.body.classList.remove('jinshan-memory-lightbox-open')
    runtime.pointerStartX = null
    updatePauseReason('lightbox', false)
    const lastFocusedButton = runtime.lastFocusedButton
    runtime.lastFocusedButton = null
    if (lastFocusedButton?.isConnected) lastFocusedButton.focus({ preventScroll: true })
  }

  const openLightbox = source => {
    if (!runtime.lightbox || !source) return
    runtime.lightboxPhotos = runtime.photos.filter(photo => !runtime.failedPhotos.has(photo))
    runtime.lightboxIndex = Math.max(0, runtime.lightboxPhotos.indexOf(source))
    runtime.lastFocusedButton = runtime.slots.find(slot => runtime.activeSlots.get(slot)?.photo === source) || null
    runtime.lastFocusedButton = runtime.lastFocusedButton?.isConnected ? runtime.lastFocusedButton : null
    runtime.lightbox.hidden = false
    runtime.lightbox.classList.add('is-open')
    document.body.classList.add('jinshan-memory-lightbox-open')
    updatePauseReason('lightbox', true)
    updateLightbox()
    runtime.lightbox.querySelector('.jinshan-memory-lightbox__button--close')?.focus({ preventScroll: true })
  }

  const stepLightbox = direction => {
    if (!runtime.lightboxPhotos.length) return
    runtime.lightboxIndex = (runtime.lightboxIndex + direction + runtime.lightboxPhotos.length) % runtime.lightboxPhotos.length
    updateLightbox()
  }

  const buildLightbox = () => {
    const shell = document.createElement('div')
    shell.className = 'jinshan-memory-lightbox'
    shell.hidden = true
    shell.setAttribute('role', 'dialog')
    shell.setAttribute('aria-modal', 'true')
    shell.setAttribute('aria-label', '金山中学照片预览')

    const backdrop = document.createElement('div')
    backdrop.className = 'jinshan-memory-lightbox__backdrop'
    const content = document.createElement('div')
    content.className = 'jinshan-memory-lightbox__content'
    const image = document.createElement('img')
    image.className = 'jinshan-memory-lightbox__image'
    const counter = document.createElement('span')
    counter.className = 'jinshan-memory-lightbox__counter'
    counter.setAttribute('aria-live', 'polite')
    const close = document.createElement('button')
    close.className = 'jinshan-memory-lightbox__button jinshan-memory-lightbox__button--close'
    close.type = 'button'
    close.setAttribute('aria-label', '关闭照片预览')
    close.textContent = '×'
    const previous = document.createElement('button')
    previous.className = 'jinshan-memory-lightbox__button jinshan-memory-lightbox__button--previous'
    previous.type = 'button'
    previous.setAttribute('aria-label', '上一张照片')
    previous.textContent = '‹'
    const next = document.createElement('button')
    next.className = 'jinshan-memory-lightbox__button jinshan-memory-lightbox__button--next'
    next.type = 'button'
    next.setAttribute('aria-label', '下一张照片')
    next.textContent = '›'

    content.append(image, counter)
    shell.append(backdrop, content, close, previous, next)
    document.body.append(shell)
    runtime.lightbox = shell

    const bind = (target, event, handler, options) => {
      runtime.lifecycle?.addListener(target, event, handler, options)
    }
    bind(backdrop, 'click', closeLightbox)
    bind(close, 'click', closeLightbox)
    bind(previous, 'click', () => stepLightbox(-1))
    bind(next, 'click', () => stepLightbox(1))
    bind(content, 'pointerdown', event => { runtime.pointerStartX = event.clientX })
    bind(content, 'pointerup', event => {
      if (runtime.pointerStartX === null) return
      const delta = event.clientX - runtime.pointerStartX
      runtime.pointerStartX = null
      if (Math.abs(delta) < lightboxSwipeThresholdPx) return
      stepLightbox(delta > 0 ? -1 : 1)
    })
    bind(document, 'keydown', event => {
      if (shell.hidden) return
      if (event.key === 'Escape') closeLightbox()
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepLightbox(-1)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepLightbox(1)
      }
    })
  }

  const bindSlots = () => {
    runtime.slots.forEach(slot => {
      const handler = () => openLightbox(runtime.activeSlots.get(slot)?.photo)
      trackListener(slot, 'click', handler)
    })
  }

  const cleanup = () => {
    runtime.generation += 1
    const lifecycle = runtime.lifecycle
    clearTimers()
    if (runtime.resizeTimer) {
      window.clearTimeout(runtime.resizeTimer)
      lifecycle?.removeTimer(runtime.resizeTimer)
    }
    runtime.resizeTimer = null
    if (runtime.resizeFrame) {
      window.cancelAnimationFrame(runtime.resizeFrame)
      lifecycle?.removeFrame(runtime.resizeFrame)
    }
    runtime.resizeFrame = null
    lifecycle?.destroy()
    runtime.lifecycle = null
    runtime.lightbox?.remove()
    document.body.classList.remove('jinshan-memory-lightbox-open')
    runtime.root?.removeAttribute('data-jinshan-memory-initialized')
    runtime.root = null
    runtime.stage = null
    runtime.slots = []
    runtime.photos = []
    runtime.photoMetrics.clear()
    runtime.failedPhotos.clear()
    runtime.queue = []
    runtime.queueIndex = 0
    runtime.previousPhoto = null
    runtime.activeSlots.clear()
    runtime.reservedPlacements.clear()
    runtime.recentCenters = []
    runtime.lastDepartureCenter = null
    runtime.reservedPhotos.clear()
    runtime.pendingSlots.clear()
    runtime.pauseReasons.clear()
    runtime.motionQuery = null
    runtime.motionHandler = null
    runtime.resizeHandler = null
    runtime.lightbox = null
    runtime.lightboxPhotos = []
    runtime.lightboxIndex = 0
    runtime.pointerStartX = null
    runtime.lastFocusedButton = null
  }

  const initializeJinshanMemoryPage = () => {
    const root = document.querySelector(rootSelector)
    if (!root) {
      cleanup()
      return false
    }
    if (runtime.root === root && root.dataset.jinshanMemoryInitialized === 'true') return true

    cleanup()
    runtime.lifecycle = window.SitePageRuntime?.create?.({ name: 'jinshan' }) || null
    runtime.root = root
    runtime.stage = root.querySelector(stageSelector)
    runtime.slots = Array.from(root.querySelectorAll('.jinshan-memory-slot'))
    runtime.slots.forEach(slot => {
      slot.className = 'jinshan-memory-slot'
    })
    try {
      const payload = root.querySelector('#jinshan-memory-data')?.textContent || '[]'
      runtime.photos = [...new Set(JSON.parse(payload).filter(photo => typeof photo === 'string' && photo))]
    } catch {
      runtime.photos = []
    }
    root.dataset.jinshanMemoryInitialized = 'true'
    if (!runtime.stage || !runtime.photos.length) return true

    runtime.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    runtime.motionHandler = () => {
      if (runtime.root?.isConnected) {
        cancelAnimations()
        runtime.activeSlots.forEach(item => {
          item.card.style.opacity = '1'
          item.card.style.transform = animationTransform(0, `${item.placement?.rotation?.toFixed(2) || 0}deg`)
        })
      }
    }
    runtime.lifecycle?.addListener(runtime.motionQuery, 'change', runtime.motionHandler)
    runtime.resizeHandler = scheduleResize
    trackListener(window, 'resize', runtime.resizeHandler, { passive: true })
    trackListener(document, 'visibilitychange', () => updatePauseReason('visibility', document.hidden))
    bindSlots()
    buildLightbox()
    refillQueue()
    syncSlots()
    return true
  }

  window.JinshanMemoryField = { init: initializeJinshanMemoryPage, cleanup }
  initializeJinshanMemoryPage()

  if (!window.jinshanMemoryFieldPjaxBound) {
    window.jinshanMemoryFieldPjaxBound = true
    document.addEventListener('pjax:send', cleanup)
    document.addEventListener('pjax:complete', initializeJinshanMemoryPage)
    document.addEventListener('pjax:error', cleanup)
    window.addEventListener('pageshow', event => {
      if (event.persisted) cleanup()
      initializeJinshanMemoryPage()
    })
  }
})()
