const $ = (selector) => document.querySelector(selector)
const dialog = $('#addDialog')
const OPEN_CODE_MODELS = {
  auto: { name: 'Auto' },
  'ark-code-latest': { name: 'Ark Code Latest' },
  'doubao-seed-2.1-turbo': { name: 'Doubao Seed 2.1 Turbo' },
  'doubao-seed-evolving': { name: 'Doubao Seed Evolving' },
  'doubao-seed-2.0-lite': { name: 'Doubao Seed 2.0 Lite' },
  'minimax-m3': { name: 'MiniMax M3' },
  'kimi-k2.7-code': { name: 'Kimi K2.7 Code' },
  'kimi-k3': { name: 'Kimi K3' },
  'glm-5.3': { name: 'GLM 5.3' },
  'glm-5.3-flash': { name: 'GLM 5.3 Flash' },
  'deepseek-v4-flash': { name: 'DeepSeek V4 Flash' },
  'deepseek-v4-pro': { name: 'DeepSeek V4 Pro' }
}

function toast(message) {
  $('#toast').textContent = message
  $('#toast').classList.add('show')
  setTimeout(() => $('#toast').classList.remove('show'), 1800)
}

async function api(path, options) {
  const request = { ...(options || {}) }
  if (request.body != null) request.headers = { 'content-type': 'application/json', ...(request.headers || {}) }
  const response = await fetch(path, request)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `请求失败 (${response.status})`)
  }
  return response.status === 204 ? null : response.json()
}

function authStatusOf(key) {
  if (!key.enabled) return ['disabled', '已停用']
  const labels = { valid:'鉴权有效', invalid:'Key 无效', error:'检测异常', unknown:'鉴权待验证' }
  return [key.authStatus || 'unknown', labels[key.authStatus] || labels.unknown]
}

function quotaStatusOf(key) {
  if (!key.enabled || key.authStatus === 'invalid') return null
  if (key.cooldownUntil > Date.now()) {
    const remaining = formatDuration(key.cooldownUntil - Date.now())
    if (key.quotaStatus === 'exhausted') return ['quota_exhausted', `额度耗尽 · ${remaining}`]
    return ['rate_limited', `临时限流 · ${remaining}`]
  }
  const labels = { available:'额度可用', exhausted:'待恢复验证', rate_limited:'待恢复验证', subscription_invalid:'套餐不可用', unknown:'调用待验证' }
  return [key.quotaStatus || 'unknown', labels[key.quotaStatus] || labels.unknown]
}

function formatDuration(milliseconds) {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days) return `${days}天${hours ? ` ${hours}小时` : ''}`
  if (hours) return `${hours}小时 ${minutes % 60}分钟`
  return `${minutes}分钟`
}

function formatTime(value) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle:'short', timeStyle:'medium' }).format(value) : '—'
}

function renderOpenCodeConfig() {
  const model = $('#configModel').value
  const baseURL = `${location.origin}/api/coding/v3`
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      'volcengine-plan': {
        npm: '@ai-sdk/openai',
        name: 'Volcano Engine (Responses API via proxy)',
        options: { baseURL, apiKey: 'proxy-managed' },
        models: OPEN_CODE_MODELS
      }
    },
    model: `volcengine-plan/${model}`
  }
  $('#openCodeConfig').textContent = JSON.stringify(config, null, 2)
}

async function load() {
  try {
    const [{ keys }, health] = await Promise.all([api('/admin/api/keys'), api('/health')])
    $('#health').classList.add('ok'); $('#health').lastChild.textContent = '服务正常'
    $('#totalCount').textContent = health.keys.total
    $('#validCount').textContent = health.keys.valid
    $('#quotaCount').textContent = health.keys.quotaAvailable
    $('#empty').hidden = keys.length > 0
    renderCurrent(keys)
    $('#keyList').replaceChildren(...keys.map(renderKey))
  } catch (error) {
    $('#health').classList.remove('ok'); $('#health').lastChild.textContent = '连接异常'
  }
}

function renderCurrent(keys) {
  const current = keys.find((key) => key.sticky)
  const nameEl = $('#currentKeyName')
  const detailEl = $('#currentKeyDetail')
  const statusEl = $('#currentKeyStatus')
  if (!current) {
    nameEl.textContent = '无'
    detailEl.textContent = '尚无 sticky Key（尚未有成功请求）'
    statusEl.className = 'status disabled'
    statusEl.textContent = '未指定'
    return
  }
  const [authClass, authLabel] = authStatusOf(current)
  const quotaStatus = quotaStatusOf(current)
  nameEl.textContent = current.name
  detailEl.textContent = `请求 ${current.requests} 次 · 最近检测 ${formatTime(current.lastCheckedAt)}`
  statusEl.className = `status ${current.available ? 'available' : authClass}`
  statusEl.textContent = quotaStatus ? `${authLabel} · ${quotaStatus[1]}` : authLabel
}

function renderKey(key) {
  const row = document.createElement('div'); row.className = 'key-row'
  const [authClass, authLabel] = authStatusOf(key)
  const quotaStatus = quotaStatusOf(key)
  const periodLabels = { monthly:'月额度', weekly:'周额度', five_hour:'5 小时额度' }
  const checkedText = `检测：${formatTime(key.lastCheckedAt)}`
  let quotaDetail = key.authStatus === 'invalid' ? '请更换或删除此 Key' : '等待检测或真实请求'
  if (key.quotaStatus === 'available') quotaDetail = '最小探针调用成功'
  if (key.quotaStatus === 'subscription_invalid') quotaDetail = '订阅无效、已过期或未分配席位'
  if (key.quotaResetAt) {
    const resetLabel = key.quotaResetAt > Date.now() ? '预计恢复' : '最近重置记录'
    const period = key.quotaPeriod ? `${periodLabels[key.quotaPeriod] || key.quotaPeriod} · ` : ''
    quotaDetail = `${period}${resetLabel} ${formatTime(key.quotaResetAt)}`
  }
  const errorCode = key.lastErrorCode ? '<br><span class="key-error-code"></span>' : ''
  const quotaBadge = quotaStatus ? `<span class="status ${quotaStatus[0]}">${quotaStatus[1]}</span>` : ''
  const stickyBadge = key.sticky ? '<span class="status sticky-badge">当前使用</span>' : ''
  row.innerHTML = `<div><div class="key-name">${stickyBadge}</div><div class="key-value"></div></div><div class="status-stack"><span class="status ${authClass}">${authLabel}</span>${quotaBadge}</div><div class="key-details">${quotaDetail}${errorCode}</div><div class="key-details">${key.requests} 次请求 · ${key.failures} 次失败<br>${checkedText}</div><div class="row-actions"><button class="secondary toggle">${key.enabled ? '停用' : '启用'}</button><button class="delete">删除</button></div>`
  row.querySelector('.key-name').appendChild(document.createTextNode(key.name))
  row.querySelector('.key-value').textContent = key.masked
  if (key.lastErrorCode) row.querySelector('.key-error-code').textContent = key.lastErrorCode
  if (key.lastError) row.title = key.lastError
  row.querySelector('.toggle').onclick = async () => { await api(`/admin/api/keys/${key.id}`, { method:'PATCH', body:JSON.stringify({ enabled:!key.enabled, clearCooldown:!key.enabled }) }); load() }
  row.querySelector('.delete').onclick = async () => { if (confirm(`确定删除“${key.name}”吗？`)) { await api(`/admin/api/keys/${key.id}`, { method:'DELETE' }); load() } }
  return row
}

$('#showAdd').onclick = () => dialog.showModal()
async function checkAllKeys(showToast = true) {
  const button = $('#checkNow')
  button.disabled = true; button.textContent = '检测中…'
  try { await api('/admin/api/check', { method:'POST', body:'{}' }); if (showToast) toast('检测完成'); await load() }
  catch (error) { if (showToast) toast(error.message) }
  finally { button.disabled = false; button.textContent = '检查所有 Key' }
}
$('#checkNow').onclick = () => checkAllKeys(true)
$('#closeDialog').onclick = $('#cancel').onclick = () => dialog.close()
$('#copy').onclick = async () => { await navigator.clipboard.writeText($('#endpoint').textContent); toast('代理地址已复制') }
$('#configModel').onchange = renderOpenCodeConfig
$('#copyConfig').onclick = async () => {
  await navigator.clipboard.writeText($('#openCodeConfig').textContent)
  toast('OpenCode 配置已复制')
}
$('#addForm').onsubmit = async (event) => {
  event.preventDefault(); $('#formError').textContent = ''
  const data = Object.fromEntries(new FormData(event.target))
  try { await api('/admin/api/keys', { method:'POST', body:JSON.stringify(data) }); event.target.reset(); dialog.close(); toast('Key 已添加'); load() }
  catch (error) { $('#formError').textContent = error.message }
}

async function initialize() {
  for (const [value, model] of Object.entries(OPEN_CODE_MODELS)) {
    $('#configModel').add(new Option(model.name, value))
  }
  $('#configModel').value = 'ark-code-latest'
  $('#endpoint').textContent = `${location.origin}/api/coding/v3`
  renderOpenCodeConfig()
  await load()
  await checkAllKeys(false)
}

initialize()
setInterval(load, 5000)
