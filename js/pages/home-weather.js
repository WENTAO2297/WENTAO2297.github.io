(() => {
  'use strict'

  const cacheKey = 'wentao-home-weather-cache-v1'
  const weatherRuntime = window.wentaoHomeWeatherRuntime || {
    controllers: new Set(),
    cleanupBound: false,
    leaving: false
  }
  weatherRuntime.leaving = false
  window.wentaoHomeWeatherRuntime = weatherRuntime
  const shanghaiFallback = {
    latitude: 31.2304,
    longitude: 121.4737,
    location: '上海市'
  }

  const weatherCodes = {
    0: ['fa-sun', '晴'],
    1: ['fa-cloud-sun', '大致晴朗'],
    2: ['fa-cloud-sun', '多云'],
    3: ['fa-cloud', '阴'],
    45: ['fa-smog', '有雾'],
    48: ['fa-smog', '雾凇'],
    51: ['fa-cloud-rain', '小毛毛雨'],
    53: ['fa-cloud-rain', '毛毛雨'],
    55: ['fa-cloud-showers-heavy', '强毛毛雨'],
    56: ['fa-cloud-rain', '冻毛毛雨'],
    57: ['fa-cloud-showers-heavy', '冻毛毛雨'],
    61: ['fa-cloud-rain', '小雨'],
    63: ['fa-cloud-rain', '中雨'],
    65: ['fa-cloud-showers-heavy', '大雨'],
    66: ['fa-cloud-rain', '冻雨'],
    67: ['fa-cloud-showers-heavy', '冻雨'],
    71: ['fa-snowflake', '小雪'],
    73: ['fa-snowflake', '中雪'],
    75: ['fa-snowflake', '大雪'],
    77: ['fa-snowflake', '米雪'],
    80: ['fa-cloud-rain', '阵雨'],
    81: ['fa-cloud-showers-heavy', '较强阵雨'],
    82: ['fa-cloud-showers-heavy', '强阵雨'],
    85: ['fa-snowflake', '阵雪'],
    86: ['fa-snowflake', '强阵雪'],
    95: ['fa-bolt', '雷暴'],
    96: ['fa-bolt', '雷暴伴冰雹'],
    99: ['fa-bolt', '强雷暴伴冰雹']
  }

  const getWindDirection = (degrees) => {
    const directions = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
    return directions[Math.round(degrees / 45) % directions.length]
  }

  const getWindLevel = (speed) => {
    const thresholds = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]
    const level = thresholds.findIndex((threshold) => speed < threshold)
    return level === -1 ? 12 : level
  }

  const getComfortDescription = (apparentTemperature, humidity) => {
    if (apparentTemperature >= 35) return humidity >= 60 ? '体感闷热' : '体感炎热'
    if (apparentTemperature >= 30) return humidity >= 65 ? '体感偏闷' : '体感偏热'
    if (apparentTemperature <= 5) return '体感寒冷'
    if (apparentTemperature <= 12) return '体感偏凉'
    return humidity >= 75 ? '空气偏湿' : '体感舒适'
  }

  const getUvLevel = (uvIndex) => {
    if (uvIndex < 3) return '低'
    if (uvIndex < 6) return '中等'
    if (uvIndex < 8) return '高'
    if (uvIndex < 11) return '很高'
    return '极高'
  }

  const getAirQualityLevel = (airQualityIndex) => {
    if (airQualityIndex <= 50) return '优'
    if (airQualityIndex <= 100) return '良'
    if (airQualityIndex <= 150) return '轻度污染'
    if (airQualityIndex <= 200) return '中度污染'
    if (airQualityIndex <= 300) return '重度污染'
    return '严重污染'
  }

  const isWeatherDataValid = (data) => {
    const fields = ['location', 'symbol', 'temperature', 'summary', 'wind', 'humidity', 'uvIndex', 'airQuality']
    return data && fields.every((field) => typeof data[field] === 'string' && data[field].length > 0)
  }

  const readCache = () => {
    try {
      const cached = JSON.parse(window.localStorage.getItem(cacheKey))
      return cached && isWeatherDataValid(cached.data) ? cached.data : null
    } catch (error) {
      return null
    }
  }

  const writeCache = (data) => {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({
        savedAt: Date.now(),
        data
      }))
    } catch (error) {
      // Weather rendering must continue when storage is unavailable.
    }
  }

  const fetchJson = async (url) => {
    const controller = new AbortController()
    weatherRuntime.controllers.add(controller)
    const timeout = window.setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      return await response.json()
    } finally {
      window.clearTimeout(timeout)
      weatherRuntime.controllers.delete(controller)
    }
  }

  const requestPosition = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation || !window.isSecureContext) {
      reject(new Error('Geolocation unavailable'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        location: '当前位置',
        isFallback: false
      }),
      reject,
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 600000
      }
    )
  })

  const fetchWeatherData = async ({ latitude, longitude, location }) => {
    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast')
    weatherUrl.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'temperature_2m,weather_code,is_day,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
      daily: 'temperature_2m_max,temperature_2m_min',
      timezone: 'auto',
      forecast_days: '1'
    }).toString()

    const airQualityUrl = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
    airQualityUrl.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: 'uv_index,us_aqi',
      timezone: 'auto',
      forecast_days: '1'
    }).toString()

    const locationUrl = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client')
    locationUrl.search = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      localityLanguage: 'zh'
    }).toString()

    const [weatherResult, airQualityResult, locationResult] = await Promise.allSettled([
      fetchJson(weatherUrl),
      fetchJson(airQualityUrl),
      fetchJson(locationUrl)
    ])

    if (weatherResult.status !== 'fulfilled') throw weatherResult.reason
    if (airQualityResult.status !== 'fulfilled') throw airQualityResult.reason

    const current = weatherResult.value.current
    const daily = weatherResult.value.daily
    const airQualityCurrent = airQualityResult.value.current
    const high = daily?.temperature_2m_max?.[0]
    const low = daily?.temperature_2m_min?.[0]
    const requiredNumbers = [
      current?.temperature_2m,
      current?.weather_code,
      current?.apparent_temperature,
      current?.relative_humidity_2m,
      current?.wind_speed_10m,
      current?.wind_direction_10m,
      high,
      low,
      airQualityCurrent?.uv_index,
      airQualityCurrent?.us_aqi
    ]

    if (!requiredNumbers.every(Number.isFinite)) throw new Error('Incomplete weather data')

    const [symbol, description] = weatherCodes[current.weather_code] || ['fa-cloud', '当前天气']
    const resolvedLocation = locationResult.status === 'fulfilled'
      ? locationResult.value.city || locationResult.value.locality || locationResult.value.principalSubdivision || location
      : location
    const comfort = getComfortDescription(current.apparent_temperature, current.relative_humidity_2m)

    return {
      location: resolvedLocation,
      symbol,
      temperature: `${Math.round(current.temperature_2m)}°C`,
      summary: `预计今天${description}，${comfort}，最高${Math.round(high)}°，最低${Math.round(low)}°。`,
      wind: `${getWindDirection(current.wind_direction_10m)}风 ${getWindLevel(current.wind_speed_10m)}级`,
      humidity: `${Math.round(current.relative_humidity_2m)}%`,
      uvIndex: `${Math.round(airQualityCurrent.uv_index)} ${getUvLevel(airQualityCurrent.uv_index)}`,
      airQuality: `${Math.round(airQualityCurrent.us_aqi)} ${getAirQualityLevel(airQualityCurrent.us_aqi)}`
    }
  }

  const updateDate = (elements) => {
    if (!elements.date || !elements.weekday) return

    const now = new Date()
    elements.date.textContent = `${now.getMonth() + 1}月${now.getDate()}日`
    elements.weekday.textContent = new Intl.DateTimeFormat('zh-CN', {
      weekday: 'long'
    }).format(now)
  }

  const renderWeather = (card, elements, data, animate) => {
    elements.location.textContent = data.location
    elements.symbol.className = `fas ${data.symbol} weather-card__symbol`
    elements.temperature.textContent = data.temperature
    if (elements.summary) elements.summary.textContent = data.summary
    if (elements.wind) elements.wind.textContent = data.wind
    if (elements.humidity) elements.humidity.textContent = data.humidity
    if (elements.uvIndex) elements.uvIndex.textContent = data.uvIndex
    if (elements.airQuality) elements.airQuality.textContent = data.airQuality
    card.setAttribute('aria-busy', 'false')

    const showContent = () => {
      if (!card.isConnected) return
      card.classList.remove('weather-card--loading')
      card.classList.add('weather-card--ready')
    }

    if (animate && !card.classList.contains('weather-card--ready')) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(showContent))
    } else {
      showContent()
    }
  }

  const refreshWeather = async (card, elements, hasCache) => {
    let target

    try {
      target = await requestPosition()
    } catch (error) {
      target = { ...shanghaiFallback, isFallback: true }
    }

    let data

    try {
      data = await fetchWeatherData(target)
    } catch (error) {
      if (weatherRuntime.leaving || !card.isConnected) return
      if (target.isFallback) throw error
      data = await fetchWeatherData({ ...shanghaiFallback, isFallback: true })
    }

    if (weatherRuntime.leaving || !card.isConnected) return
    writeCache(data)
    renderWeather(card, elements, data, !hasCache)
  }

  const initWeather = () => {
    const card = document.querySelector('.dashboard-card--weather')
    if (!card || card.dataset.weatherInitialized === 'true') return

    card.dataset.weatherInitialized = 'true'
    const elements = {
      date: card.querySelector('#weather-date'),
      weekday: card.querySelector('#weather-weekday'),
      symbol: card.querySelector('#weather-symbol'),
      temperature: card.querySelector('#weather-temperature'),
      location: card.querySelector('#weather-location'),
      summary: card.querySelector('#weather-summary'),
      wind: card.querySelector('#weather-wind'),
      humidity: card.querySelector('#weather-humidity'),
      uvIndex: card.querySelector('#weather-uv-index'),
      airQuality: card.querySelector('#weather-air-quality')
    }

    updateDate(elements)
    const cachedData = readCache()

    if (cachedData) renderWeather(card, elements, cachedData, false)
    refreshWeather(card, elements, Boolean(cachedData)).catch(() => {})
  }

  initWeather()

  if (!weatherRuntime.cleanupBound) {
    weatherRuntime.cleanupBound = true
    document.addEventListener('pjax:send', () => {
      weatherRuntime.leaving = true
      weatherRuntime.controllers.forEach(controller => controller.abort())
      weatherRuntime.controllers.clear()
    })
  }

  if (!window.homeWeatherPjaxListener) {
    window.homeWeatherPjaxListener = true
    document.addEventListener('pjax:complete', initWeather)
  }
})()
