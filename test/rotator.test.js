import test from 'node:test'
import assert from 'node:assert/strict'
import { createStickyRotator } from '../src/rotator.js'

function makeKey(overrides) {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    name: 'key',
    enabled: true,
    cooldownUntil: 0,
    authStatus: 'valid',
    quotaStatus: 'available',
    ...overrides
  }
}

function makeStore(keys, stickyId = null) {
  const store = {
    state: { keys, stickyId },
    enabledKeys: () => store.state.keys.filter((k) => k.enabled),
    async rotateSticky(id) {
      if (store.state.stickyId === id) return false
      const key = store.state.keys.find((k) => k.id === id)
      const callable = key && key.enabled && key.cooldownUntil <= Date.now() && key.authStatus === 'valid' && key.quotaStatus === 'available'
      if (!callable) return false
      store.state.stickyId = id
      return true
    }
  }
  return store
}

test('冷却到期且探针通过时切换 sticky 到其他 Key', async (t) => {
  const sticky = makeKey({ name: '我的' })
  const other = makeKey({ name: '共享账号' })
  const store = makeStore([sticky, other], sticky.id)
  const check = async (key) => { key.authStatus = 'valid'; key.quotaStatus = 'available' }
  const rotator = createStickyRotator({ store, check })

  const changed = await rotator.rotateOnce()
  assert.equal(changed, true)
  assert.equal(store.state.stickyId, other.id)
})

test('探针失败时不切换 sticky', async (t) => {
  const sticky = makeKey({ name: '我的' })
  const other = makeKey({ name: '共享账号' })
  const store = makeStore([sticky, other], sticky.id)
  const check = async (key) => { key.authStatus = 'error'; key.quotaStatus = 'unknown' }
  const rotator = createStickyRotator({ store, check })

  const changed = await rotator.rotateOnce()
  assert.equal(changed, false)
  assert.equal(store.state.stickyId, sticky.id)
})

test('排除名称含 %我的% 的 Key', async (t) => {
  const sticky = makeKey({ name: '账号 A' })
  const mine = makeKey({ name: '账号 %我的%' })
  const store = makeStore([sticky, mine], sticky.id)
  let probed = 0
  const check = async (key) => { probed += 1; key.authStatus = 'valid'; key.quotaStatus = 'available' }
  const rotator = createStickyRotator({ store, check })

  const changed = await rotator.rotateOnce()
  assert.equal(changed, false)
  assert.equal(probed, 0)
  assert.equal(store.state.stickyId, sticky.id)
})

test('冷却未结束的 Key 不切换', async (t) => {
  const sticky = makeKey({ name: '我的' })
  const other = makeKey({ name: '共享账号', cooldownUntil: Date.now() + 60_000, quotaStatus: 'exhausted' })
  const store = makeStore([sticky, other], sticky.id)
  const check = async () => { throw new Error('不应探测') }
  const rotator = createStickyRotator({ store, check })

  const changed = await rotator.rotateOnce()
  assert.equal(changed, false)
  assert.equal(store.state.stickyId, sticky.id)
})

test('无可切换 Key 时返回 false', async (t) => {
  const sticky = makeKey({ name: '我的' })
  const store = makeStore([sticky], sticky.id)
  const check = async () => {}
  const rotator = createStickyRotator({ store, check })

  const changed = await rotator.rotateOnce()
  assert.equal(changed, false)
  assert.equal(store.state.stickyId, sticky.id)
})
