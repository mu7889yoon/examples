const DB_NAME = 'image-db'
const STORE_NAME = 'images'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAllImages() {
  const db = await openDB()
  const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getImage(id) {
  const db = await openDB()
  const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveImage(file, annotation = '') {
  const db = await openDB()
  db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add({
    id: crypto.randomUUID(),
    fileName: file.name,
    mimeType: file.type,
    blob: file,
    annotation,
    createdAt: Date.now(),
  })
}

export async function updateAnnotation(id, annotation) {
  const db = await openDB()
  const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.get(id)
    req.onsuccess = () => {
      if (req.result) {
        req.result.annotation = annotation
        store.put(req.result).onsuccess = () => resolve()
      } else reject(new Error('Not found'))
    }
    req.onerror = () => reject(req.error)
  })
}
