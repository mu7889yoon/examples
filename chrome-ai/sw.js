import { Hono } from 'https://esm.sh/hono@4'
import { getAllImages, getImage, saveImage, updateAnnotation } from './db.js'
import { renderCard, renderList, renderEmpty } from './template.js'
import { initPort, requestAnnotation, requestSearch } from './proxy.js'

const app = new Hono()
const PER_PAGE = 12

function paginate(items, page) {
  const totalPages = Math.ceil(items.length / PER_PAGE)
  const start = (page - 1) * PER_PAGE
  return { items: items.slice(start, start + PER_PAGE), page, totalPages }
}

// Routes
app.get('/api/images', async (c) => {
  const page = parseInt(c.req.query('page') || '1')
  const all = await getAllImages()
  const { items, totalPages } = paginate(all, page)
  return c.html(renderList(items, page, totalPages, '/api/images?'))
})

app.post('/api/images', async (c) => {
  const files = (await c.req.formData()).getAll('file')
  if (!files.length) return c.html(renderEmpty('ファイルがありません'), 400)
  
  for (const file of files) {
    await saveImage(file, await requestAnnotation(file))
  }
  const all = await getAllImages()
  const { items, page, totalPages } = paginate(all, 1)
  return c.html(renderList(items, page, totalPages, '/api/images?'))
})

app.get('/api/blob/:id', async (c) => {
  const img = await getImage(c.req.param('id'))
  if (!img) return c.notFound()
  return new Response(img.blob, { headers: { 'Content-Type': img.mimeType || 'image/jpeg' } })
})

app.post('/api/annotate/:id', async (c) => {
  const img = await getImage(c.req.param('id'))
  if (!img) return c.html(renderEmpty('画像が見つかりません'), 404)
  await updateAnnotation(img.id, await requestAnnotation(img.blob))
  return c.html(renderCard(await getImage(img.id)))
})

app.get('/api/search', async (c) => {
  const query = c.req.query('q') || ''
  const page = parseInt(c.req.query('page') || '1')
  const all = await getAllImages()
  
  if (!query.trim()) {
    const { items, totalPages } = paginate(all, page)
    return c.html(renderList(items, page, totalPages, '/api/images?'))
  }
  
  const annotated = all.filter(img => img.annotation)
  if (!annotated.length) return c.html(renderEmpty('アノテーション済みの画像がありません'))
  
  const results = await requestSearch(query, annotated)
  if (!results.length) return c.html(renderEmpty('該当なし'))
  
  const { items, totalPages } = paginate(results, page)
  return c.html(renderList(items, page, totalPages, `/api/search?q=${encodeURIComponent(query)}&`))
})

// Events
self.addEventListener('message', (e) => {
  if (e.data?.type === 'INIT_PORT') initPort(e.ports[0])
})

self.addEventListener('fetch', (e) => {
  if (new URL(e.request.url).pathname.startsWith('/api')) {
    e.respondWith(app.fetch(e.request))
  }
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
