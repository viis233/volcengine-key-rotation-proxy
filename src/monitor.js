import { parseUpstreamError } from './quota.js'

export function createKeyChecker({ store, upstreamBaseUrl, probeModel }) {
  let running = false

  async function check(key) {
    try {
      // 真实的最小生成同时验证鉴权、订阅和当前额度。
      const response = await fetch(`${upstreamBaseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key.value}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: probeModel, input: '仅回复 1', max_output_tokens: 16, temperature: 0 }),
        signal: AbortSignal.timeout(15_000)
      })
      if (response.ok) {
        await response.body?.cancel()
        return store.recordProbe(key.id, { authStatus: 'valid', quotaStatus: 'available' })
      }

      const error = parseUpstreamError((await response.text()).slice(0, 1000))
      const reason = `${response.status}: ${error.message}`
      if (response.status === 401 || response.status === 403) {
        return store.recordProbe(key.id, { authStatus: 'invalid', error: reason, errorCode: error.code })
      }
      if (response.status === 429) {
        return store.recordProbe(key.id, {
          authStatus: 'valid',
          quotaStatus: error.code === 'AccountQuotaExceeded' ? 'exhausted' : 'rate_limited',
          resetAt: error.resetAt,
          period: error.quotaPeriod,
          error: reason,
          errorCode: error.code
        })
      }
      if (error.code === 'InvalidSubscription') {
        return store.recordProbe(key.id, {
          authStatus: 'valid', quotaStatus: 'subscription_invalid', error: reason, errorCode: error.code
        })
      }
      return store.recordProbe(key.id, {
        authStatus: response.status < 500 ? 'valid' : 'error',
        error: `探针未完成：${reason}`,
        errorCode: error.code
      })
    } catch (error) {
      return store.recordProbe(key.id, { authStatus: 'error', error: `探测失败：${error.message}` })
    }
  }

  return async function checkAll() {
    if (running) return false
    running = true
    try {
      for (const key of store.enabledKeys()) await check(key)
      return true
    } finally {
      running = false
    }
  }
}
