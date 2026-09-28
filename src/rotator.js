export function createStickyRotator({ store, check }) {
  let running = false

  async function rotateOnce() {
    if (running) return false
    running = true
    try {
      const now = Date.now()
      const mineMarker = '%我的%'
      const candidates = store.enabledKeys().filter((key) => {
        if (key.id === store.state.stickyId) return false
        if (key.name.includes(mineMarker)) return false
        if (!key.enabled || key.cooldownUntil > now) return false
        if (key.authStatus !== 'valid' || key.quotaStatus !== 'available') return false
        return true
      })
      for (const key of candidates) {
        await check(key)
        const refreshed = store.enabledKeys().find((item) => item.id === key.id)
        const callable = refreshed && refreshed.enabled && refreshed.cooldownUntil <= Date.now() && refreshed.authStatus === 'valid' && refreshed.quotaStatus === 'available'
        if (callable && await store.rotateSticky(key.id)) {
          console.log(`[rotator] sticky 切换至 "${key.name}"（${key.id}）`)
          return true
        }
      }
      return false
    } finally {
      running = false
    }
  }

  function start(intervalMs) {
    const timer = setInterval(() => {
      rotateOnce().catch((error) => console.error(`[rotator] 轮换检查失败：${error.message}`))
    }, intervalMs)
    timer.unref?.()
    return timer
  }

  return { rotateOnce, start }
}
