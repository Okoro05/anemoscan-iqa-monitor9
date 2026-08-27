import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { and, eq, ne } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { captures } from '../../db/schema.js'

const captureStore = getStore('hemovision-captures')
const MAX_NAME_LENGTH = 80

function sanitizeName(rawName: unknown): string | null {
  if (typeof rawName !== 'string') {
    return null
  }

  const trimmed = rawName.trim().slice(0, MAX_NAME_LENGTH)

  if (!trimmed) {
    return null
  }

  // Strip characters that are unsafe in filenames / could break storage keys.
  const cleaned = trimmed.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()

  return cleaned || null
}

// Enforced naming rule: no spaces, no capital letters. Checked server-side
// as the source of truth (the frontend also checks this for instant
// feedback, but this is what actually gets relied on).
function getNameFormatError(name: string): string | null {
  if (/\s/.test(name)) {
    return 'Name cannot contain spaces.'
  }
  if (/[A-Z]/.test(name)) {
    return 'Name cannot contain capital letters.'
  }
  return null
}

function toResponse(row: typeof captures.$inferSelect) {
  return {
    id: row.id,
    blobKey: row.blobKey,
    name: row.name,
    status: row.status,
    cameraLabel: row.cameraLabel,
    threshold: row.threshold,
    brightness: row.brightness,
    sharpness: row.sharpness,
    contrast: row.contrast,
    overall: row.overall,
    imageBytes: row.imageBytes,
    imageUrl: `/api/captures/${encodeURIComponent(row.blobKey)}`,
    createdAt: row.createdAt.toISOString(),
  }
}

function parseId(pathname: string) {
  const raw = pathname.replace('/api/capture-item/', '')
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

async function renameCapture(id: number, req: Request) {
  const payload = (await req.json()) as { name?: string }
  const name = sanitizeName(payload.name)

  if (!name) {
    return Response.json({ error: 'A valid name is required' }, { status: 400 })
  }

  const formatError = getNameFormatError(name)
  if (formatError) {
    return Response.json({ error: formatError }, { status: 400 })
  }

  // Check for a duplicate name against every OTHER capture (excluding this
  // one, so renaming to the name it already has doesn't falsely conflict).
  const [existing] = await db
    .select()
    .from(captures)
    .where(and(eq(captures.name, name), ne(captures.id, id)))

  if (existing) {
    return Response.json(
      { error: 'This name is already used by another snapshot. Choose a different name.' },
      { status: 409 },
    )
  }

  const [row] = await db
    .update(captures)
    .set({ name })
    .where(eq(captures.id, id))
    .returning()

  if (!row) {
    return Response.json({ error: 'Capture not found' }, { status: 404 })
  }

  return Response.json({ capture: toResponse(row) })
}

async function deleteCapture(id: number) {
  const [row] = await db.select().from(captures).where(eq(captures.id, id))

  if (!row) {
    return Response.json({ error: 'Capture not found' }, { status: 404 })
  }

  // Remove the row first: if something goes wrong deleting the blob, we'd
  // rather have an orphaned blob (harmless, just unreferenced storage) than
  // a db row pointing at a blob that's already gone.
  await db.delete(captures).where(eq(captures.id, id))
  await captureStore.delete(row.blobKey)

  return Response.json({ deleted: true, id })
}

export default async (req: Request) => {
  const url = new URL(req.url)
  const id = parseId(url.pathname)

  if (id === null) {
    return Response.json({ error: 'Invalid capture id' }, { status: 400 })
  }

  try {
    if (req.method === 'PATCH') {
      return renameCapture(id, req)
    }

    if (req.method === 'DELETE') {
      return deleteCapture(id)
    }

    return new Response('Method not allowed', { status: 405 })
  } catch {
    return Response.json({ error: 'Capture item operation failed' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/capture-item/*',
}
