import type { Project } from './types.ts'
import { clone, now } from './types.ts'
let pendingDb: Promise<IDBDatabase> | undefined
export function database() {
  return (pendingDb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('camera-brush', 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id' })
      req.result.createObjectStore('assets')
      req.result.createObjectStore('drafts')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}
export async function readAllProjects(): Promise<Project[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const req = db.transaction('projects').objectStore('projects').getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export class ConflictError extends Error {
  constructor() {
    super('另一个标签页已保存新版本。本地副本已保留，请重新加载或另存为新项目。')
  }
}
export async function saveProject(project: Project, expectedVersion: number): Promise<number> {
  const db = await database(),
    data = clone(project)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'drafts'], 'readwrite'),
      store = tx.objectStore('projects')
    const req = store.get(data.id)
    let conflict = false
    req.onsuccess = () => {
      if ((req.result?.version ?? 0) !== expectedVersion) {
        conflict = true
        tx.abort()
        return
      }
      data.version = expectedVersion + 1
      data.updated_at = now()
      store.put(data)
      tx.objectStore('drafts').delete(data.id)
    }
    tx.oncomplete = () => resolve(data.version)
    tx.onabort = () => reject(conflict ? new ConflictError() : tx.error)
    tx.onerror = () => reject(tx.error)
  })
}
export async function putData(store: 'assets' | 'drafts', key: string, value: unknown) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
export async function getData<T>(store: 'assets' | 'drafts', key: string): Promise<T | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key)
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
export async function deleteDraft(key: string) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    tx.objectStore('drafts').delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
export async function sha256(data: Blob | string) {
  const buffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
