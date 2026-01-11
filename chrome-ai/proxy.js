let port = null

export function initPort(messagePort) {
  port = messagePort
  port.start()
}

export function requestAnnotation(blob) {
  return new Promise((resolve) => {
    if (!port) return resolve('')
    const id = crypto.randomUUID()
    const handler = (e) => {
      if (e.data?.id === id) {
        port.removeEventListener('message', handler)
        resolve(e.data.annotation || '')
      }
    }
    port.addEventListener('message', handler)
    port.postMessage({ type: 'ANNOTATE', id, blob })
  })
}

export function requestSearch(query, images) {
  return new Promise((resolve) => {
    if (!port) return resolve([])
    const id = crypto.randomUUID()
    const handler = (e) => {
      if (e.data?.id === id) {
        port.removeEventListener('message', handler)
        resolve((e.data.indices || []).map(i => images[i]).filter(Boolean))
      }
    }
    port.addEventListener('message', handler)
    port.postMessage({ type: 'SEARCH', id, query, tags: images.map(img => img.annotation) })
  })
}
