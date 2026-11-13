import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import {
  MAX_ATTACHMENTS,
  attachmentUrl,
  listAttachments,
  removeAttachment,
  uploadAttachment,
} from './attachments'

/**
 * Image attachments inside the task details modal: thumbnail grid,
 * add (file picker / camera on mobile), delete. Bucket is private,
 * so thumbnails are loaded through short-lived signed URLs.
 */
export default function AttachmentsSection({ taskId, userId, onChanged }) {
  const [items, setItems] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const rows = await listAttachments(taskId)
      const withUrls = await Promise.all(
        rows.map(async (row) => ({ ...row, url: await attachmentUrl(row.file_path) }))
      )
      setItems(withUrls)
    } catch (loadError) {
      console.warn('[attachments] load failed', loadError)
      setItems([])
      setError('Could not load attachments')
    }
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  const addFiles = async (files) => {
    setError('')
    setBusy(true)
    try {
      let added = 0
      for (const file of files) {
        if ((items?.length ?? 0) + added >= MAX_ATTACHMENTS) {
          setError(`Up to ${MAX_ATTACHMENTS} images per task`)
          break
        }
        await uploadAttachment(userId, taskId, file)
        added += 1
      }
      if (added > 0) {
        await load()
        onChanged?.()
      }
    } catch (uploadError) {
      setError(uploadError.message ?? 'Upload failed')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const remove = async (item) => {
    setError('')
    try {
      await removeAttachment(item.id, item.file_path)
      setItems((current) => (current ?? []).filter((row) => row.id !== item.id))
      onChanged?.()
    } catch (removeError) {
      setError(removeError.message ?? 'Could not delete the attachment')
    }
  }

  const full = (items?.length ?? 0) >= MAX_ATTACHMENTS

  return (
    <div className="field">
      <span className="field-label" id="attachments-label">
        Attachments
      </span>

      <div className="attachments-grid" role="group" aria-labelledby="attachments-label">
        {(items ?? []).map((item) => (
          <figure className="attachment-thumb" key={item.id}>
            <img src={item.url} alt={item.file_name} loading="lazy" />
            <button
              type="button"
              className="attachment-remove"
              onClick={() => remove(item)}
              aria-label={`Delete ${item.file_name}`}
              title="Delete"
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          </figure>
        ))}

        {!full && (
          <button
            type="button"
            className="attachment-add"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="Add image"
            title="Add image"
          >
            <ImagePlus size={20} strokeWidth={1.75} aria-hidden="true" />
            <span>{busy ? 'Uploading…' : 'Add'}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
      />

      {items === null && <span className="field-hint">Loading…</span>}
      {error && (
        <span className="input-error-text" role="alert">
          {error}
        </span>
      )}
      {!error && items !== null && (
        <span className="field-hint">
          {items.length}/{MAX_ATTACHMENTS} images, up to 5 MB each
        </span>
      )}
    </div>
  )
}
