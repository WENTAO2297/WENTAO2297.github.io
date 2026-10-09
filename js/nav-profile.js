(() => {
  'use strict'
  if (window.SiteNavProfile) return
  const nav = document.querySelector('#page-header #nav')
  const panel = nav?.querySelector('#nav-profile')
  const trigger = nav?.querySelector('.nav-site-title')
  if (!panel || !trigger) return

  let closeTimer = null
  let ticker = null
  let touchPointer = false
  let progressFrame = 0
  const isOpen = () => trigger.getAttribute('aria-expanded') === 'true'
  const yearFlip = panel.querySelector('.nav-profile__year')
  const reminder = () => yearFlip.querySelector('.nav-profile__year-back').textContent
  let flipTouch = false
  const updateFlipLabel = () => {
    const flipped = yearFlip.classList.contains('is-flipped')
    const percent = panel.querySelector('[data-profile-percent="year"]').textContent
    yearFlip.setAttribute('aria-label', flipped ? `${reminder()} 点击返回年进度` : `今年已过 ${percent}，翻转查看时间提醒`)
  }
  const setFlipped = flipped => {
    yearFlip.classList.toggle('is-flipped', flipped)
    yearFlip.setAttribute('aria-pressed', String(flipped))
    yearFlip.querySelector('.nav-profile__year-front').setAttribute('aria-hidden', String(flipped))
    yearFlip.querySelector('.nav-profile__year-back').setAttribute('aria-hidden', String(!flipped))
    updateFlipLabel()
  }
  yearFlip.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') setFlipped(true) })
  yearFlip.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') setFlipped(false) })
  yearFlip.addEventListener('pointerdown', event => { flipTouch = event.pointerType === 'touch' })
  yearFlip.addEventListener('click', event => {
    if (event.detail === 0 || flipTouch || matchMedia('(hover: none)').matches) setFlipped(!yearFlip.classList.contains('is-flipped'))
  })
  yearFlip.addEventListener('blur', () => { if (!yearFlip.matches(':hover')) setFlipped(false) })
  const progressFields = ['year'].map(key => ({
    label: panel.querySelector(`[data-profile-percent="${key}"]`),
    bar: panel.querySelector(`[data-profile-progress="${key}"]`)
  }))
  const paintProgress = values => progressFields.forEach((field, index) => {
    field.label.textContent = `${Math.floor(values[index])}%`
    field.bar.value = values[index]
    updateFlipLabel()
  })
  const stopProgress = () => { cancelAnimationFrame(progressFrame); progressFrame = 0 }
  const loadProgress = values => {
    stopProgress()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { paintProgress(values); return }
    paintProgress([0])
    const started = performance.now()
    const step = time => {
      if (!isOpen()) { progressFrame = 0; return }
      const fraction = Math.min(1, Math.max(0, (time - started - 80) / 700))
      const eased = 1 - Math.pow(1 - fraction, 3)
      paintProgress(values.map(value => value * eased))
      progressFrame = fraction < 1 ? requestAnimationFrame(step) : 0
    }
    progressFrame = requestAnimationFrame(step)
  }
  const fields = [...panel.querySelectorAll('[data-profile-time]')]
  const start = new Date(panel.dataset.start)
  // Calendar arithmetic in the owner's timezone, independent of a visitor's timezone.
  const shanghaiOffset = 8 * 60 * 60 * 1000
  const shiftedStart = new Date(start.getTime() + shanghaiOffset)
  const addMonths = count => {
    const date = new Date(shiftedStart)
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + count)
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, lastDay))
    return date
  }
  const updateTime = (animateProgress = false) => {
    const now = new Date(Date.now() + shanghaiOffset)
    if (Number.isFinite(start.getTime())) {
      let months = Math.max(0, (now.getUTCFullYear() - shiftedStart.getUTCFullYear()) * 12 + now.getUTCMonth() - shiftedStart.getUTCMonth())
      if (months > 0 && addMonths(months) > now) months--
      const seconds = Math.max(0, Math.floor((now - addMonths(months)) / 1000))
      const values = [Math.floor(months / 12), months % 12, Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
      fields.forEach((field, index) => { field.textContent = String(values[index]).padStart(2, '0') })
    }
    const year = now.getUTCFullYear()
    panel.querySelector('[data-profile-year]').textContent = String(year)
    const from = Date.UTC(year, 0, 1)
    const to = Date.UTC(year + 1, 0, 1)
    const values = [(now.getTime() - from) / (to - from) * 100]
    if (animateProgress) loadProgress(values)
    else if (!progressFrame) paintProgress(values)
  }

  const stopClock = () => { clearInterval(ticker); ticker = null }
  const cancelClose = () => { clearTimeout(closeTimer); closeTimer = null }
  const close = (restoreFocus = false) => {
    cancelClose()
    stopClock()
    stopProgress()
    window.SiteNavSurfaceMotion.setOpen(panel, false)
    trigger.setAttribute('aria-expanded', 'false')
    nav.classList.remove('capsule-profile-open')
    if (restoreFocus) trigger.focus({ preventScroll: true })
  }
  const open = () => {
    cancelClose()
    if (isOpen()) return
    // Let existing navigation handlers close their surfaces before opening this one.
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    setFlipped(false)
    window.SiteNavSurfaceMotion.setOpen(panel, true)
    trigger.setAttribute('aria-expanded', 'true')
    nav.classList.add('capsule-profile-open')
    nav.classList.remove('capsule-scroll-hidden')
    updateTime(true)
    stopClock()
    ticker = setInterval(updateTime, 1000)
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer = setTimeout(() => {
      if (!panel.matches(':hover') && !trigger.matches(':hover') && !panel.contains(document.activeElement) && document.activeElement !== trigger) close()
    }, 220)
  }
  for (const element of [trigger, panel]) {
    element.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') { cancelClose(); open() } })
    element.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') scheduleClose() })
    element.addEventListener('focusout', scheduleClose)
  }
  trigger.addEventListener('pointerdown', event => { if (event.isTrusted) touchPointer = event.pointerType === 'touch' })
  trigger.addEventListener('click', event => {
    if (!touchPointer && !matchMedia('(hover: none)').matches) return
    event.preventDefault()
    event.stopPropagation()
    isOpen() ? close() : open()
  }, true)
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', ' '].includes(event.key)) return
    event.preventDefault()
    open()
    panel.focus({ preventScroll: true })
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && isOpen()) close(panel.contains(document.activeElement))
  })
  document.addEventListener('pointerdown', event => {
    if (!panel.contains(event.target) && !trigger.contains(event.target)) close()
  })
  nav.querySelector('#menus')?.addEventListener('pointerenter', () => close())
  nav.querySelector('.capsule-tools')?.addEventListener('focusin', () => close())
  nav.querySelector('#menus')?.addEventListener('focusin', () => close())
  document.addEventListener('pjax:send', () => close())
  document.addEventListener('visibilitychange', () => {
    stopClock()
    stopProgress()
    if (isOpen() && !document.hidden) { updateTime(); ticker = setInterval(updateTime, 1000) }
  })
  window.addEventListener('pagehide', () => close())
  window.SiteNavProfile = Object.freeze({ close })
})()
