(() => {
  const stripHtml = value => {
    const documentFragment = new DOMParser().parseFromString(value || '', 'text/html')
    return (documentFragment.body.textContent || '').replace(/\s+/g, ' ').trim()
  }

  const loadSearchIndex = () => {
    if (window.homeSearchIndexPromise) return window.homeSearchIndexPromise

    const searchPath = window.GLOBAL_CONFIG?.localSearch?.path || '/search.xml'
    const metadataElement = document.getElementById('home-search-metadata')
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
    container.hidden = !isOpen
    container.classList.toggle('is-open', isOpen)
    container.setAttribute('aria-hidden', String(!isOpen))
    input.setAttribute('aria-expanded', String(isOpen))
  }

  const closeCurrentResults = () => {
    const input = document.getElementById('home-search-input')
    const results = document.getElementById('home-search-results')
    if (input && results) setResultsOpen(results, input, false)
  }

  const renderResults = (container, entries, query) => {
    const status = container.querySelector('.dashboard-search-results__status')
    const list = container.querySelector('.dashboard-search-results__list')
    const input = document.getElementById('home-search-input')
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

    if (input) setResultsOpen(container, input, true)
  }

  const initHomeSearch = () => {
    const form = document.querySelector('.dashboard-search')
    const input = document.getElementById('home-search-input')
    const results = document.getElementById('home-search-results')
    if (!form || !input || !results || form.dataset.searchReady === 'true') return

    form.dataset.searchReady = 'true'
    form.addEventListener('submit', event => {
      event.preventDefault()
      const query = input.value.trim()

      if (!query) {
        setResultsOpen(results, input, false)
        results.querySelector('.dashboard-search-results__list').replaceChildren()
        results.querySelector('.dashboard-search-results__status').textContent = ''
        return
      }

      setResultsOpen(results, input, true)
      results.querySelector('.dashboard-search-results__status').textContent = '正在搜索…'
      results.querySelector('.dashboard-search-results__list').replaceChildren()

      loadSearchIndex()
        .then(entries => renderResults(results, entries, query))
        .catch(() => {
          results.querySelector('.dashboard-search-results__status').textContent = '搜索索引暂时不可用，请稍后再试。'
        })
    })

    input.addEventListener('input', () => {
      if (!input.value.trim()) setResultsOpen(results, input, false)
    })

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
      const searchShell = document.querySelector('.dashboard-search-shell')
      if (searchShell && !searchShell.contains(event.target)) {
        window.closeHomeDashboardSearchResults?.()
      }
    })
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.closeHomeDashboardSearchResults?.()
    })
  }
})()
