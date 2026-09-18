import { Readable } from 'node:stream'
import { parseUpstreamError } from './quota.js'

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length'])
const ROTATE_STATUSES = new Set([401, 402, 403, 429])
const ROTATE_ERROR_CODES = new Set(['AccountQuotaExceeded', 'InvalidSubscription'])

function outboundHeaders(headers, apiKey) {
  const result = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(name.toLowerCase()) && value !== undefined) result[name] = value
  }
  result.authorization = `Bearer ${apiKey}`
  return result
}

export function createProxyHandler({ store, upstreamBaseUrl }) {
  return async function proxy(request, reply) {
    const candidates = store.candidates()
    if (!candidates.length) {
      const summary = store.availabilitySummary()
      const allLimited = summary.total > 0 && summary.quotaExhausted + summary.rateLimited + summary.subscriptionInvalid > 0
      const resetHint = summary.nextResetAt ? `，最早预计恢复时间：${new Date(summary.nextResetAt).toISOString()}` : ''
      const message = allLimited
        ? `所有 Key 当前均无额度或处于限流状态${resetHint}`
        : '没有可用的 API Key，请在管理页面添加或启用有效 Key'
      return reply.code(allLimited ? 429 : 503).send({
        error: { message, type: allLimited ? 'proxy_all_keys_quota_exhausted' : 'proxy_no_available_key', details: summary }
      })
    }

    const body = request.body == null
      ? undefined
      : Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body)
    let lastError = '上游请求失败'

    for (const key of candidates) {
      let response
      try {
        const suffix = request.url.replace(/^\/api\/coding\/v3/, '') || '/'
        response = await fetch(`${upstreamBaseUrl}${suffix}`, {
          method: request.method,
          headers: outboundHeaders(request.headers, key.value),
          body,
          redirect: 'manual'
        })
      } catch (error) {
        lastError = error.message
        await store.recordFailure(key.id, { reason: lastError })
        continue
      }

      let error
      if (response.status >= 400 && response.status < 500) {
        const text = await response.clone().text()
        error = { text: text.slice(0, 1000), ...parseUpstreamError(text) }
      }
      if (ROTATE_STATUSES.has(response.status) || ROTATE_ERROR_CODES.has(error?.code)) {
        await response.body?.cancel()
        lastError = error.text
        const authFailure = response.status === 401 || response.status === 403
        const quotaStatus = error.code === 'AccountQuotaExceeded'
          ? 'exhausted'
          : error.code === 'InvalidSubscription' ? 'subscription_invalid'
            : response.status === 429 ? 'rate_limited' : undefined
        await store.recordFailure(key.id, {
          reason: `${response.status}: ${lastError}`,
          errorCode: error.code,
          authStatus: authFailure ? 'invalid' : 'valid',
          quotaStatus,
          resetAt: error.resetAt,
          quotaPeriod: error.quotaPeriod,
          cooldown: !authFailure && quotaStatus !== 'subscription_invalid'
        })
        continue
      }

      await store.recordSuccess(key.id)
      reply.code(response.status)
      for (const [name, value] of response.headers) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) reply.header(name, value)
      }
      if (!response.body) return reply.send()
      return reply.send(Readable.fromWeb(response.body))
    }

    const summary = store.availabilitySummary()
    const resetHint = summary.nextResetAt ? `，最早预计恢复时间：${new Date(summary.nextResetAt).toISOString()}` : ''
    return reply.code(429).send({
      error: {
        message: `所有 Key 均请求失败、无额度或不可使用${resetHint}。最后一个上游错误：${lastError}`,
        type: 'proxy_all_keys_unavailable',
        details: summary
      }
    })
  }
}
