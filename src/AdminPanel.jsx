import { useEffect, useRef, useState } from 'react'
import { X, Shield, ShieldCheck, Ban, CircleCheck } from 'lucide-react'
import { supabase } from './lib/supabaseClient'

/**
 * Admin panel: list of all users with roles, block/unblock and role toggles.
 * Data comes from the `profiles` table (admin RLS policy) and the
 * `admin_user_stats` RPC (per-user counters without task content).
 */
export default function AdminPanel({ currentUserId, onClose }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const dialogRef = useRef(null)

  // Escape to close + scroll lock (same behavior as other dialogs).
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const load = async () => {
    setError('')
    const [{ data: profiles, error: profilesError }, { data: stats, error: statsError }] =
      await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, created_at, role, is_blocked')
          .order('created_at', { ascending: true }),
        supabase.rpc('admin_user_stats'),
      ])
    if (profilesError) {
      setError(profilesError.message)
      return
    }
    if (statsError) {
      // Stats are nice-to-have; show the panel without them.
      console.warn('[admin] stats unavailable', statsError)
    }
    const statsByUser = new Map((stats ?? []).map((row) => [row.user_id, row]))
    setUsers(
      (profiles ?? []).map((profile) => ({
        ...profile,
        listsCount: statsByUser.get(profile.id)?.lists_count ?? 0,
        tasksCount: statsByUser.get(profile.id)?.tasks_count ?? 0,
      }))
    )
  }

  useEffect(() => {
    load()
  }, [])

  const updateUser = async (user, patch) => {
    setBusyId(user.id)
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
    if (updateError) setError(updateError.message)
    else await load()
    setBusyId(null)
  }

  const formatDate = (value) =>
    new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card admin-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-title"
        ref={dialogRef}
      >
        <div className="list-modal-header">
          <h2 className="details-title" id="admin-title">
            <Shield size={20} strokeWidth={2} aria-hidden="true" /> Admin panel
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {error && (
          <p className="input-error-text" role="alert">
            {error}
          </p>
        )}

        {!users ? (
          <p className="admin-loading" role="status">
            Loading users…
          </p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Joined</th>
                  <th>Lists</th>
                  <th>Tasks</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUserId
                  const isAdmin = user.role === 'admin'
                  return (
                    <tr key={user.id} className={user.is_blocked ? 'admin-row-blocked' : ''}>
                      <td className="admin-user-cell" title={user.email}>
                        {user.email}
                        {isSelf && <span className="admin-you">you</span>}
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                      <td>{user.listsCount}</td>
                      <td>{user.tasksCount}</td>
                      <td>
                        <span className={`admin-badge ${isAdmin ? 'admin-badge-admin' : ''}`}>
                          {isAdmin ? 'admin' : 'user'}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-badge ${user.is_blocked ? 'admin-badge-blocked' : 'admin-badge-active'}`}>
                          {user.is_blocked ? 'blocked' : 'active'}
                        </span>
                      </td>
                      <td>
                        <div className="admin-actions">
                          <button
                            type="button"
                            className="admin-action-btn"
                            disabled={isSelf || busyId === user.id}
                            title={isAdmin ? 'Revoke admin' : 'Make admin'}
                            onClick={() => updateUser(user, { role: isAdmin ? 'user' : 'admin' })}
                          >
                            {isAdmin ? <ShieldCheck size={15} /> : <Shield size={15} />}
                          </button>
                          <button
                            type="button"
                            className={`admin-action-btn ${user.is_blocked ? '' : 'admin-action-danger'}`}
                            disabled={isSelf || busyId === user.id}
                            title={user.is_blocked ? 'Unblock user' : 'Block user'}
                            onClick={() => updateUser(user, { is_blocked: !user.is_blocked })}
                          >
                            {user.is_blocked ? <CircleCheck size={15} /> : <Ban size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
