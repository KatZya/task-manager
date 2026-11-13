import { supabase } from './lib/supabaseClient'

/**
 * Task attachments: images stored in a private Supabase Storage bucket,
 * metadata in the `attachments` table. Files live at <userId>/<taskId>/<file>
 * so the storage RLS policies can isolate users by path.
 */

const BUCKET = 'attachments'
export const MAX_ATTACHMENTS = 5
export const MAX_FILE_MB = 5
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.85
const SIGNED_URL_TTL = 3600 // seconds

/** Downscale big photos (a phone shot is 5–10 MB) and convert to JPEG. */
export async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Could not compress the image')
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
}

export async function listAttachments(taskId) {
  const { data, error } = await supabase
    .from('attachments')
    .select('id, task_id, file_path, file_name, size_bytes, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Short-lived signed URL — the bucket is private, public URLs don't exist. */
export async function attachmentUrl(filePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_TTL)
  if (error) throw error
  return data.signedUrl
}

/** Uploads a compressed image and registers it in the attachments table. */
export async function uploadAttachment(userId, taskId, file) {
  if (!file.type.startsWith('image/')) throw new Error('Only images are supported')
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`File is larger than ${MAX_FILE_MB} MB`)
  }

  const compressed = await compressImage(file)
  const path = `${userId}/${taskId}/${crypto.randomUUID()}.jpg`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, compressed, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError

  const { data, error: insertError } = await supabase
    .from('attachments')
    .insert({
      task_id: taskId,
      user_id: userId,
      file_path: path,
      file_name: file.name,
      size_bytes: compressed.size,
    })
    .select('id, task_id, file_path, file_name, size_bytes, created_at')
    .single()
  if (insertError) {
    // Best effort: don't leave an unreferenced file behind.
    await supabase.storage.from(BUCKET).remove([path])
    throw insertError
  }
  return data
}

export async function removeAttachment(id, filePath) {
  const { error: dbError } = await supabase.from('attachments').delete().eq('id', id)
  if (dbError) throw dbError
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([filePath])
  if (storageError) console.warn('[attachments] file cleanup failed', storageError)
}

/** task_id → count map for the paperclip badges in task rows. */
export async function fetchAttachmentCounts() {
  const { data, error } = await supabase.from('attachments').select('task_id')
  if (error) throw error
  const counts = {}
  for (const row of data ?? []) {
    counts[row.task_id] = (counts[row.task_id] ?? 0) + 1
  }
  return counts
}
