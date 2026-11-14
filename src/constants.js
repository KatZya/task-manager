/* Shared limits and enums used by both the UI and the storage layer. */

export const STORAGE_KEY = 'task-manager-app-v1'
export const STORAGE_VERSION = 3

export const MAX_TITLE = 40
export const MAX_TASK = 200
export const MAX_TAGS = 6
export const MAX_TAG = 24

export const PRIORITIES = ['low', 'medium', 'high']

export const ICON_KEYS = ['home', 'search', 'music', 'radio', 'smile', 'list']

/** A list icon is either one of the built-in Lucide keys or a short emoji. */
export function isEmojiIcon(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  // Covers single emoji, emoji with modifiers/ZWJ sequences, keycap digits.
  return trimmed.length > 0 && trimmed.length <= 11 && /\p{Extended_Pictographic}/u.test(trimmed)
}

export function isValidIcon(value) {
  return ICON_KEYS.includes(value) || isEmojiIcon(value)
}
