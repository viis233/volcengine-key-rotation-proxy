import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KeyStore } from './key-store.js'
import { createProxyHandler } from './proxy.js'
import { createKeyChecker } from './monitor.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT || 8787)
const host = process.env.HOST || '0.0.0.0'
const upstreamBaseUrl = (process.env.UPSTREAM_BASE_URL || 'https://ark.cn-beijing.volces.com/api/coding/v3').replace(/\/$/, '')
const cooldownMs = Number(process.env.KEY_COOLDOWN_SECONDS || 300) * 1000
const probeModel = process.env.HEALTHCHECK_MODEL || 'doubao-seed-2.0-lite'

const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 })
const store = new KeyStore(join(root, 'data', 'keys.json'), cooldownMs)
await store.init((process.env.VOLCENGINE_API_KEYS || '').split(',').map((key) => key.trim()))
const checkKeys = createKeyChecker({ store, upstreamBaseUrl, probeModel })

await app.register(fastifyStatic, { root: join(root, 'public'), prefix: '/' })

app.get('/health', async () => ({ ok: true, keys: store.keyCounts() }))
app.get('/admin/api/keys', async () => ({ keys: store.publicKeys() }))
app.post('/admin/api/check', async (request, reply) => {
  const started = await checkKeys()
  return started ? { ok: true, keys: store.publicKeys() } : reply.code(409).send({ error: '检测正在进行中' })
})
app.post('/admin/api/keys', async (request, reply) => {
  try {
    const id = await store.add(request.body?.value, request.body?.name)
    return reply.code(201).send({ id })
  } catch (error) {
    return reply.code(400).send({ error: error.message })
  }
})
app.patch('/admin/api/keys/:id', async (request, reply) => {
  const found = await store.update(request.params.id, request.body || {})
  return found ? { ok: true } : reply.code(404).send({ error: 'Key 不存在' })
})
app.delete('/admin/api/keys/:id', async (request, reply) => {
  const found = await store.remove(request.params.id)
  return found ? reply.code(204).send() : reply.code(404).send({ error: 'Key 不存在' })
})

const proxy = createProxyHandler({ store, upstreamBaseUrl })
app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: '/api/coding/v3', handler: proxy })
app.route({ method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], url: '/api/coding/v3/*', handler: proxy })

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/admin/api/')) return reply.code(404).send({ error: '接口不存在' })
  return reply.sendFile('index.html')
})

try {
  await app.listen({ port, host })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
