import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export class KeyStore {
  constructor(file, cooldownMs) {
    this.file = file
    this.cooldownMs = cooldownMs
    this.state = { keys: [], stickyId: null }
    this.queue = Promise.resolve()
  }

  async init(seedKeys = []) {
    await mkdir(dirname(this.file), { recursive: true })
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const existing = new Set(this.state.keys.map((item) => item.value))
    for (const value of seedKeys.filter(Boolean)) {
      if (!existing.has(value)) this.state.keys.push(this.makeKey(value))
    }
    await this.save()
  }

  makeKey(value, name = '') {
    return {
      id: randomUUID(), name: name.trim() || `Key ${this.state.keys.length + 1}`,
      value: value.trim(), enabled: true, cooldownUntil: 0,
      requests: 0, failures: 0, lastError: '',
      authStatus: 'unknown', quotaStatus: 'unknown', quotaResetAt: 0,
      quotaPeriod: null, lastErrorCode: '', lastCheckedAt: 0
    }
  }

  async locked(action) {
    const next = this.queue.then(action, action)
    this.queue = next.catch(() => {})
    return next
  }

  async save() {
    const temp = `${this.file}.tmp`
    await writeFile(temp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    await rename(temp, this.file)
  }

  publicKeys() {
    const now = Date.now()
    return this.state.keys.map((key) => ({
      id: key.id,
      name: key.name,
      enabled: key.enabled,
      cooldownUntil: key.cooldownUntil,
      requests: key.requests,
      failures: key.failures,
      lastError: key.lastError,
      authStatus: key.authStatus,
      quotaStatus: key.quotaStatus,
      quotaResetAt: key.quotaResetAt,
      quotaPeriod: key.quotaPeriod,
      lastErrorCode: key.lastErrorCode,
      lastCheckedAt: key.lastCheckedAt,
      masked: key.value.length > 8 ? `${key.value.slice(0, 4)}••••${key.value.slice(-4)}` : '••••••••',
      available: key.enabled && key.authStatus === 'valid' && key.quotaStatus === 'available' && key.cooldownUntil <= now
    }))
  }

  keyCounts() {
    const now = Date.now()
    const enabled = this.state.keys.filter((key) => key.enabled)
    return {
      total: enabled.length,
      valid: enabled.filter((key) => key.authStatus === 'valid').length,
      quotaAvailable: enabled.filter((key) => key.authStatus === 'valid' && key.quotaStatus === 'available' && key.cooldownUntil <= now).length
    }
  }

  async add(value, name) {
    return this.locked(async () => {
      const clean = value?.trim()
      if (!clean) throw new Error('Key 不能为空')
      if (this.state.keys.some((key) => key.value === clean)) throw new Error('Key 已存在')
      const key = this.makeKey(clean, name)
      this.state.keys.push(key)
      await this.save()
      return key.id
    })
  }

  async update(id, changes) {
    return this.locked(async () => {
      const key = this.state.keys.find((item) => item.id === id)
      if (!key) return false
      if (typeof changes.enabled === 'boolean') key.enabled = changes.enabled
      if (changes.clearCooldown) {
        key.cooldownUntil = 0
        key.quotaStatus = 'unknown'
      }
      await this.save()
      return true
    })
  }

  async remove(id) {
    return this.locked(async () => {
      const before = this.state.keys.length
      this.state.keys = this.state.keys.filter((item) => item.id !== id)
      await this.save()
      return this.state.keys.length < before
    })
  }

  candidates() {
    const now = Date.now()
    const available = this.state.keys.filter((key) => key.enabled && key.cooldownUntil <= now && key.authStatus !== 'invalid' && key.quotaStatus !== 'subscription_invalid')
    if (!available.length) return []
    const rank = (key) => {
      if (key.id === this.state.stickyId) return 0
      return key.name.includes('%我的%') ? 2 : 1
    }
    return [...available].sort((a, b) => rank(a) - rank(b))
  }

  enabledKeys() {
    return this.state.keys.filter((key) => key.enabled)
  }

  availabilitySummary() {
    const now = Date.now()
    const enabled = this.state.keys.filter((key) => key.enabled)
    const blocked = enabled.filter((key) => key.cooldownUntil > now)
    const resetTimes = blocked.map((key) => key.cooldownUntil)
    return {
      total: enabled.length,
      quotaExhausted: blocked.filter((key) => key.quotaStatus === 'exhausted').length,
      rateLimited: blocked.filter((key) => key.quotaStatus === 'rate_limited').length,
      subscriptionInvalid: enabled.filter((key) => key.quotaStatus === 'subscription_invalid').length,
      invalid: enabled.filter((key) => key.authStatus === 'invalid').length,
      nextResetAt: resetTimes.length ? Math.min(...resetTimes) : 0
    }
  }

  async recordProbe(id, { authStatus, quotaStatus = 'unknown', resetAt = 0, period = null, error = '', errorCode = '' }) {
    return this.locked(async () => {
      const key = this.state.keys.find((item) => item.id === id)
      if (!key) return
      key.authStatus = authStatus
      key.quotaStatus = quotaStatus
      key.lastCheckedAt = Date.now()
      key.lastError = String(error).slice(0, 300)
      key.lastErrorCode = errorCode
      if (period) key.quotaPeriod = period
      if (resetAt) {
        key.quotaResetAt = resetAt
        key.cooldownUntil = resetAt
      } else if (quotaStatus === 'rate_limited' || quotaStatus === 'exhausted') {
        key.cooldownUntil = Date.now() + this.cooldownMs
      } else {
        key.cooldownUntil = 0
      }
      await this.save()
    })
  }

  async recordSuccess(id) {
    return this.locked(async () => {
      const key = this.state.keys.find((item) => item.id === id)
      if (!key) return
      key.requests += 1
      key.lastError = ''
      key.lastErrorCode = ''
      key.authStatus = 'valid'
      key.quotaStatus = 'available'
      key.cooldownUntil = 0
      this.state.stickyId = id
      await this.save()
    })
  }

  async recordFailure(id, { reason, errorCode = '', authStatus, quotaStatus, resetAt = 0, quotaPeriod = null, cooldown = false }) {
    return this.locked(async () => {
      const key = this.state.keys.find((item) => item.id === id)
      if (!key) return
      if (this.state.stickyId === id) this.state.stickyId = null
      key.requests += 1
      key.failures += 1
      key.lastError = String(reason).slice(0, 300)
      key.lastErrorCode = errorCode
      if (authStatus) key.authStatus = authStatus
      if (quotaStatus) key.quotaStatus = quotaStatus
      if (quotaPeriod) key.quotaPeriod = quotaPeriod
      if (resetAt) key.quotaResetAt = resetAt
      if (cooldown || resetAt) key.cooldownUntil = resetAt || Date.now() + this.cooldownMs
      await this.save()
    })
  }
}
