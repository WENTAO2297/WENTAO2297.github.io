(() => {
  'use strict'

  const dashboard = document.getElementById('home-dashboard')
  const phrase = dashboard?.querySelector('[data-home-phrase]')
  if (!dashboard || !phrase || phrase.dataset.phraseInitialized === 'true') return

  phrase.dataset.phraseInitialized = 'true'

  const startTyping = () => {
    if (!phrase.isConnected) return

    const characters = Array.from(phrase.dataset.homePhrase || '')
    if (!characters.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      phrase.textContent = characters.join('')
      return
    }

    phrase.textContent = ''
    phrase.dataset.typing = 'true'
    let phase = 'typing'
    let index = 0
    let phaseStartedAt = 0
    let lastStepAt = 0

    const enterPhase = (nextPhase, now) => {
      phase = nextPhase
      phaseStartedAt = now
      lastStepAt = now

      if (nextPhase === 'typing' || nextPhase === 'deleting') {
        phrase.dataset.typing = 'true'
      } else {
        phrase.removeAttribute('data-typing')
      }
    }

    const render = () => {
      phrase.textContent = characters.slice(0, index).join('')
    }

    const tick = (now) => {
      if (!phrase.isConnected) return

      if (!phaseStartedAt) enterPhase('typing', now)

      if (phase === 'typing' && now - lastStepAt >= 135) {
        index = Math.min(index + 1, characters.length)
        lastStepAt = now
        render()

        if (index === characters.length) enterPhase('holding', now)
      } else if (phase === 'holding' && now - phaseStartedAt >= 3000) {
        enterPhase('deleting', now)
      } else if (phase === 'deleting' && now - lastStepAt >= 110) {
        index = Math.max(index - 1, 0)
        lastStepAt = now
        render()

        if (index === 0) enterPhase('waiting', now)
      } else if (phase === 'waiting' && now - phaseStartedAt >= 1000) {
        enterPhase('typing', now)
      }

      window.requestAnimationFrame(tick)
    }

    window.requestAnimationFrame(tick)
  }

  const waitForDashboard = () => {
    if (!dashboard.isConnected) return
    if (dashboard.classList.contains('home-dashboard--ready')) {
      startTyping()
      return
    }

    window.requestAnimationFrame(waitForDashboard)
  }

  waitForDashboard()
})()
