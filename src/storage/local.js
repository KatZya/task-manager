import {
  STORAGE_KEY,
  STORAGE_VERSION,
  MAX_TITLE,
  MAX_TASK,
  MAX_TAGS,
  MAX_TAG,
  PRIORITIES,
  ICON_KEYS,
} from '../constants'

/**
 * localStorage driver. Keeps the whole app state under one key.
 *
 * Driver contract (any driver must implement it):
 *   load(): Promise<object | null> — sanitized state or null when nothing is stored
 *   save(state): Promise<void>     — never rejects; failures are logged, not thrown
 */

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function normalizeTags(values) {
  const seen = new Set()
  const tags = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const tag = value.trim().replace(/^#+/, '').slice(0, MAX_TAG)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function sanitizeTask(value) {
  if (!value || typeof value !== 'object') return null
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (!text) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeId(),
    text: text.slice(0, MAX_TASK),
    done: Boolean(value.done),
    due: isDateKey(value.due) ? value.due : null,
    priority: PRIORITIES.includes(value.priority) ? value.priority : null,
    tags: Array.isArray(value.tags) ? normalizeTags(value.tags) : [],
  }
}

function sanitizeList(value) {
  if (!value || typeof value !== 'object') return null
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (!title) return null
  return {
    id: typeof value.id === 'string' && value.id ? value.id : makeId(),
    title: title.slice(0, MAX_TITLE),
    icon: ICON_KEYS.includes(value.icon) ? value.icon : 'list',
    tasks: Array.isArray(value.tasks) ? value.tasks.map(sanitizeTask).filter(Boolean) : [],
  }
}

/** Validates and normalizes a parsed snapshot. Returns null when unusable. */
export function sanitizeState(parsed, fallbackTheme) {
  // Compatible with the v1/v2 shape: { user, lists } and no theme.
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lists)) return null
  return {
    version: STORAGE_VERSION,
    user: typeof parsed.user === 'string' && parsed.user.trim() ? parsed.user.trim() : null,
    theme: parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : fallbackTheme,
    lists: parsed.lists.map(sanitizeList).filter(Boolean),
  }
}

export function createLocalStorageDriver(fallbackTheme, userId = 'guest') {
  const key = `${STORAGE_KEY}:${userId}`
  return {
    async load() {
      try {
        // Per-user data first; fall back to the legacy shared key so data
        // saved before accounts existed is picked up on first login.
        const raw = localStorage.getItem(key) ?? localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        return sanitizeState(JSON.parse(raw), fallbackTheme)
      } catch {
        return null
      }
    },

    async save(state) {
      try {
        localStorage.setItem(key, JSON.stringify(state))
      } catch {
        /* storage can be full or disabled — the app still works for this session */
      }
    },
  }
}
