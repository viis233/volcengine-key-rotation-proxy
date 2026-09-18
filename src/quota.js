export function parseUpstreamError(text) {
  let json
  try { json = JSON.parse(text) } catch {}
  const code = json?.error?.code || json?.error?.type || ''
  const message = json?.error?.message || text || ''
  let resetAt = null
  let quotaPeriod = null
  if (code === 'AccountQuotaExceeded') {
    if (/monthly|月/i.test(message)) quotaPeriod = 'monthly'
    else if (/weekly|week|周/i.test(message)) quotaPeriod = 'weekly'
    else if (/5\s*-?\s*hour|5\s*小时/i.test(message)) quotaPeriod = 'five_hour'
    const match = message.match(/reset at (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})/i)
    if (match) {
      const [, date, time, offset] = match
      const timestamp = Date.parse(`${date}T${time}${offset.slice(0, 3)}:${offset.slice(3)}`)
      if (Number.isFinite(timestamp)) resetAt = timestamp
    }
  }
  return { code, message: String(message).slice(0, 1000), resetAt, quotaPeriod }
}
