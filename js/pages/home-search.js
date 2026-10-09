(() => {
  if (window.initHomeDashboardSearch) {
    window.initHomeDashboardSearch()
    return
  }

  const stripHtml = value => {
    const documentFragment = new DOMParser().parseFromString(value || '', 'text/html')
    return (documentFragment.body.textContent || '').replace(/\s+/g, ' ').trim()
  }

  const loadSearchIndex = () => {
    if (window.homeSearchIndexPromise) return window.homeSearchIndexPromise

    const searchPath = window.GLOBAL_CONFIG?.localSearch?.path || '/search.xml'
    const metadataElement = document.getElementById('capsule-search-metadata') || document.getElementById('home-search-metadata')
    let metadata = []

    try {
      metadata = JSON.parse(metadataElement?.textContent || '[]')
    } catch (error) {
      metadata = []
    }

    const metadataByUrl = new Map(metadata.map(item => [item.url, item]))
    window.homeSearchIndexPromise = fetch(searchPath)
      .then(response => {
        if (!response.ok) throw new Error(`Search index returned ${response.status}`)
        return response.text()
      })
      .then(source => {
        const xml = new DOMParser().parseFromString(source, 'text/xml')
        if (xml.querySelector('parsererror')) throw new Error('Search index is not valid XML')

        return [...xml.querySelectorAll('entry')].map(entry => {
          const url = entry.querySelector('url')?.textContent?.trim() || ''
          const entryMetadata = metadataByUrl.get(url) || {}

          return {
            title: entry.querySelector('title')?.textContent?.trim() || '',
            content: stripHtml(entry.querySelector('content')?.textContent || ''),
            description: entryMetadata.description || '',
            sectionLabel: entryMetadata.sectionLabel || '',
            url
          }
        }).filter(entry => entry.title && entry.url)
      })
      .catch(error => {
        window.homeSearchIndexPromise = null
        throw error
      })

    return window.homeSearchIndexPromise
  }

  const makeExcerpt = (content, keywords) => {
    if (!content) return '打开文章查看内容。'
    const normalizedContent = content.toLocaleLowerCase()
    const positions = keywords
      .map(keyword => normalizedContent.indexOf(keyword))
      .filter(position => position >= 0)
    const firstMatch = positions.length ? Math.min(...positions) : 0
    const start = Math.max(0, firstMatch - 30)
    const end = Math.min(content.length, firstMatch + 100)
    return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
  }

  const setResultsOpen = (container, input, isOpen) => {
    if (container.closest('#nav')) window.SiteNavSurfaceMotion.setOpen(container, isOpen)
    else container.hidden = !isOpen
    container.classList.toggle('is-open', isOpen)
    container.setAttribute('aria-hidden', String(!isOpen))
    input.setAttribute('aria-expanded', String(isOpen))
  }

  const closeCurrentResults = () => {
    document.querySelectorAll('.dashboard-search__input').forEach(input => {
      const results = document.getElementById(input.getAttribute('aria-controls'))
      input.closest('form')?.dispatchEvent(new Event('search:close'))
      if (results) setResultsOpen(results, input, false)
    })
  }

  const renderResults = (container, input, entries, query) => {
    const status = container.querySelector('.dashboard-search-results__status')
    const list = container.querySelector('.dashboard-search-results__list')
    const keywords = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)

    const results = entries.map(entry => {
      const title = entry.title.toLocaleLowerCase()
      const content = `${entry.description} ${entry.sectionLabel} ${entry.content}`.toLocaleLowerCase()
      const matchedKeywords = keywords.filter(keyword => title.includes(keyword) || content.includes(keyword))
      if (!matchedKeywords.length) return null

      return {
        ...entry,
        score: matchedKeywords.length * 10 + keywords.filter(keyword => title.includes(keyword)).length * 20
      }
    }).filter(Boolean).sort((left, right) => right.score - left.score).slice(0, 8)

    list.replaceChildren()
    status.textContent = results.length ? `找到 ${results.length} 条相关内容` : `没有找到与“${query}”相关的内容`

    results.forEach(result => {
      const item = document.createElement('li')
      const link = document.createElement('a')
      const title = document.createElement('span')
      const excerpt = document.createElement('p')

      item.className = 'dashboard-search-result'
      link.href = result.url
      title.className = 'dashboard-search-result__title'
      excerpt.className = 'dashboard-search-result__excerpt'
      title.textContent = result.title
      excerpt.textContent = makeExcerpt(result.description || result.content, keywords)
      link.append(title, excerpt)
      item.append(link)
      list.append(item)
    })

    window.pjax?.refresh(container)
    if (input) setResultsOpen(container, input, true)
  }

  const initHomeSearch = () => {
    document.querySelectorAll('.dashboard-search').forEach(initSearchForm)
  }

  const initSearchForm = form => {
    const input = form.querySelector('.dashboard-search__input')
    const results = input && document.getElementById(input.getAttribute('aria-controls'))
    if (!form || !input || !results || form.dataset.searchReady === 'true') return

    let requestId = 0
    let searchTimer = 0
    form.addEventListener('search:close', () => {
      clearTimeout(searchTimer)
      requestId++
    })
    form.dataset.searchReady = 'true'
    form.addEventListener('submit', event => {
      event.preventDefault()
      clearTimeout(searchTimer)
      const query = input.value.trim()
      const currentRequest = ++requestId

      if (!query) {
        setResultsOpen(results, input, false)
        return
      }

      setResultsOpen(results, input, true)
      results.querySelector('.dashboard-search-results__status').textContent = '正在搜索…'
      results.querySelector('.dashboard-search-results__list').replaceChildren()

      loadSearchIndex()
        .then(entries => {
          if (currentRequest !== requestId || !form.isConnected || input.value.trim() !== query || input.getAttribute('aria-expanded') !== 'true') return
          renderResults(results, input, entries, query)
        })
        .catch(() => {
          if (currentRequest !== requestId || !form.isConnected || input.getAttribute('aria-expanded') !== 'true') return
          results.querySelector('.dashboard-search-results__status').textContent = '搜索索引暂时不可用，请稍后再试。'
        })
    })

    const scheduleSearch = event => {
      requestId++
      clearTimeout(searchTimer)
      if (!input.value.trim()) {
        setResultsOpen(results, input, false)
        return
      }
      if (form.dataset.searchLive === 'true' && !event.isComposing) {
        searchTimer = setTimeout(() => form.requestSubmit(), 180)
      }
    }
    input.addEventListener('input', scheduleSearch)
    input.addEventListener('compositionend', scheduleSearch)

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      form.requestSubmit()
    })
  }

  window.initHomeDashboardSearch = initHomeSearch
  window.closeHomeDashboardSearchResults = closeCurrentResults
  initHomeSearch()

  if (!window.homeDashboardSearchPjaxBound) {
    window.homeDashboardSearchPjaxBound = true
    window.addEventListener('pjax:complete', initHomeSearch)
    document.addEventListener('click', event => {
      document.querySelectorAll('.dashboard-search').forEach(form => {
        const searchShell = form.closest('.dashboard-search-shell, .notes-search-shell')
        if (!searchShell) return
        const input = form.querySelector('.dashboard-search__input')
        const results = document.getElementById(input.getAttribute('aria-controls'))
        if (searchShell.contains(event.target) || results?.contains(event.target)) return
        form.dispatchEvent(new Event('search:close'))
        if (results) setResultsOpen(results, input, false)
      })
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.closeHomeDashboardSearchResults?.()
    })
  }
})()
