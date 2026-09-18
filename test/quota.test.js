import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUpstreamError } from '../src/quota.js'

test('解析配额周期和重置时间', () => {
  const body = JSON.stringify({ error: { code: 'AccountQuotaExceeded', message: 'You have exceeded the monthly usage quota. It will reset at 2026-09-22 23:59:59 +0800 CST.' } })
  const result = parseUpstreamError(body)
  assert.equal(result.code, 'AccountQuotaExceeded')
  assert.equal(result.quotaPeriod, 'monthly')
  assert.equal(new Date(result.resetAt).toISOString(), '2026-09-22T15:59:59.000Z')
})
