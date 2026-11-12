import { createLocalStorageDriver } from './local'
import { createSupabaseDriver } from './supabase'

/**
 * Storage entry point. The app talks only to this driver interface
 * (load/save), so the storage backend can be swapped without touching the UI.
 *
 * When Supabase credentials are present and a user is signed in, data lives
 * in Postgres (mirrored to localStorage as an offline cache); otherwise the
 * app falls back to plain localStorage.
 *
 * Driver contract:
 *   load(): Promise<object | null> — sanitized state or null when nothing is stored
 *   save(state): Promise<void>     — never rejects; failures are logged, not thrown
 */
export function getStorageDriver(fallbackTheme, userId) {
  const hasSupabase = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  )
  if (hasSupabase && userId) {
    return createSupabaseDriver(fallbackTheme, userId)
  }
  return createLocalStorageDriver(fallbackTheme, userId)
}
