(() => {
  document.querySelectorAll('.project-space-card--link').forEach(link => {
    if (link.dataset.projectSpaceKeyboardBound === 'true') return

    link.dataset.projectSpaceKeyboardBound = 'true'
    link.addEventListener('keydown', event => {
      const isEnter = event.key === 'Enter' || event.key === 'Return'
      const isSpace = event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space'
      if (!isEnter && !isSpace) return

      event.preventDefault()
      link.click()
    })
  })
})()
