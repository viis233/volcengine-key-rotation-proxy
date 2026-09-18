import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KeyStore } from '../src/key-store.js'

async function createStore(t, keys) {
  const dir = await mkdtemp(join(tmpdir(), 'key-store-'))
  t.after(() => rm(dir, { recursive: true }))
  const store = new KeyStore(join(dir, 'keys.json'), 60_000)
  await store.init(keys)
  return store
}

test('轮询 Key 且不公开密钥', async (t) => {
  const store = await createStore(t, ['abcdefgh12345678', 'ijklmnop87654321'])
  assert.deepEqual(store.candidates().map((key) => key.value), ['abcdefgh12345678', 'ijklmnop87654321'])
  assert.deepEqual(store.candidates().map((key) => key.value), ['ijklmnop87654321', 'abcdefgh12345678'])
  assert.equal(store.publicKeys()[0].masked, 'abcd••••5678')
  assert.equal('value' in store.publicKeys()[0], false)
})

test('仅路由当前可调用的 Key 并正确统计状态', async (t) => {
  const store = await createStore(t, ['available', 'exhausted', 'invalid', 'no-subscription'])
  const [available, exhausted, invalid, noSubscription] = store.candidates()
  const resetAt = Date.now() + 60_000

  await store.recordProbe(available.id, { authStatus: 'valid', quotaStatus: 'available' })
  await store.recordProbe(exhausted.id, { authStatus: 'valid', quotaStatus: 'exhausted', resetAt, period: 'monthly' })
  await store.recordProbe(invalid.id, { authStatus: 'invalid' })
  await store.recordProbe(noSubscription.id, { authStatus: 'valid', quotaStatus: 'subscription_invalid' })

  assert.deepEqual(store.candidates().map((key) => key.id), [available.id])
  assert.deepEqual(store.keyCounts(), { total: 4, valid: 3, quotaAvailable: 1 })
  assert.deepEqual(store.availabilitySummary(), {
    total: 4,
    quotaExhausted: 1,
    rateLimited: 0,
    subscriptionInvalid: 1,
    invalid: 1,
    nextResetAt: resetAt
  })
})

test('代理结果更新请求统计和冷却状态', async (t) => {
  const store = await createStore(t, ['key-one'])
  const key = store.candidates()[0]
  const resetAt = Date.now() + 60_000

  await store.recordFailure(key.id, {
    reason: 'quota', errorCode: 'AccountQuotaExceeded', authStatus: 'valid',
    quotaStatus: 'exhausted', resetAt, quotaPeriod: 'five_hour'
  })
  let state = store.publicKeys()[0]
  assert.equal(state.available, false)
  assert.equal(state.requests, 1)
  assert.equal(state.failures, 1)
  assert.equal(state.quotaResetAt, resetAt)

  await store.recordSuccess(key.id)
  state = store.publicKeys()[0]
  assert.equal(state.available, true)
  assert.equal(state.requests, 2)
  assert.equal(state.cooldownUntil, 0)
})
