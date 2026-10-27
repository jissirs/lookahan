const STALE_HOURS = 6

export function isForecastForTomorrow(forecast, now = Date.now()) {
  // Backend ใช้ UTC+7 แม้ผู้ใช้จะเปิดเว็บจากเขตเวลาอื่น
  const tomorrow = new Date(now + (24 + 7) * 3600 * 1000).toISOString().slice(0, 10)
  return forecast?.daily?.[0]?.date === tomorrow
}

export function isForecastStale(forecast, now = Date.now()) {
  if (!forecast?.generatedAt || !forecast.daily?.length) return true
  const generatedAt = Date.parse(forecast.generatedAt)
  if (!Number.isFinite(generatedAt)) return true
  return !isForecastForTomorrow(forecast, now) || now - generatedAt > STALE_HOURS * 3600 * 1000
}
