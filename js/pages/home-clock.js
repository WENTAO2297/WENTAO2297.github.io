(() => {
  'use strict'

  const clock = document.querySelector('.analog-clock')
  if (!clock || clock.dataset.clockInitialized === 'true') return

  clock.dataset.clockInitialized = 'true'
  const digitalTime = clock.querySelector('#analog-clock-time')
  const weekday = clock.querySelector('#analog-clock-weekday')
  const date = clock.querySelector('#analog-clock-date')
  let lastLabelSecond = -1

  const updateClock = () => {
    if (!clock.isConnected) return

    const now = new Date()
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000
    const minutes = now.getMinutes() + seconds / 60
    const hours = (now.getHours() % 12) + minutes / 60

    clock.style.setProperty('--clock-hour-angle', `${hours * 30}deg`)
    clock.style.setProperty('--clock-minute-angle', `${minutes * 6}deg`)
    clock.style.setProperty('--clock-second-angle', `${seconds * 6}deg`)

    if (now.getSeconds() !== lastLabelSecond) {
      lastLabelSecond = now.getSeconds()
      const hoursText = String(now.getHours()).padStart(2, '0')
      const minutesText = String(now.getMinutes()).padStart(2, '0')
      const weekdayText = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now).toUpperCase()
      const dateText = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric'
      }).format(now).toUpperCase()

      if (digitalTime) digitalTime.textContent = `${hoursText}:${minutesText}`
      if (weekday) weekday.textContent = weekdayText
      if (date) date.textContent = dateText
      clock.setAttribute('aria-label', new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(now))
    }

    window.requestAnimationFrame(updateClock)
  }

  window.requestAnimationFrame(updateClock)
})()
