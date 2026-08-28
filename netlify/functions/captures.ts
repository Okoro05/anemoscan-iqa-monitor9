import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import { desc, eq } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { captures } from '../../db/schema.js'

type CapturePayload = {
  imageData?: string
  name?: string
  metrics?: {
    brightness?: number
    sharpness?: number
    contrast?: number
    overall?: number
  }
  threshold?: number
  cameraLabel?: string
  status?: string
}

const MAX_NAME_LENGTH = 80
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 24

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

const captureStore = getStore('hemovision-captures')

function numberValue(value: unknown) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, numeric))
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/)

  if (!match) {
    throw new Error('Invalid image data')
  }

  return {
    contentType: match[1] === 'image/jpg' ? 'image/jpeg' : match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
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

async function listCaptures(req: Request) {
  const url = new URL(req.url)

  const limitParam = Number(url.searchParams.get('limit'))
  const limit =
    Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  const offsetParam = Number(url.searchParams.get('offset'))
  const offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0

  const rows = await db
    .select()
    .from(captures)
    .orderBy(desc(captures.createdAt))
    .limit(limit)
    .offset(offset)

  return Response.json({
    captures: rows.map(toResponse),
    hasMore: rows.length === limit,
  })
}

async function saveCapture(req: Request) {
  const payload = (await req.json()) as CapturePayload

  if (!payload.imageData) {
    return Response.json({ error: 'Missing image data' }, { status: 400 })
  }

  const name = sanitizeName(payload.name)

  if (!name) {
    return Response.json({ error: 'A valid name is required' }, { status: 400 })
  }

  const formatError = getNameFormatError(name)
  if (formatError) {
    return Response.json({ error: formatError }, { status: 400 })
  }

  const [existing] = await db.select().from(captures).where(eq(captures.name, name))
  if (existing) {
    return Response.json(
      { error: 'This name is already used by another snapshot. Choose a different name.' },
      { status: 409 },
    )
  }

  const { contentType, buffer } = decodeDataUrl(payload.imageData)
  const now = new Date()
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const slug = name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40)
  const keyPrefix = slug ? `${slug}-` : ''
  const blobKey = `captures/${keyPrefix}${now.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.${extension}`

  await captureStore.set(blobKey, buffer)

  const metrics = payload.metrics ?? {}
  const [row] = await db
    .insert(captures)
    .values({
      blobKey,
      name,
      status: payload.status === 'READY' ? 'READY' : 'LOW QUALITY',
      cameraLabel:
        payload.cameraLabel === 'FRONT' || payload.cameraLabel === 'IMPORT'
          ? payload.cameraLabel
          : 'BACK',
      threshold: Math.min(65, Math.max(55, Number(payload.threshold) || 60)),
      brightness: numberValue(metrics.brightness),
      sharpness: numberValue(metrics.sharpness),
      contrast: numberValue(metrics.contrast),
      overall: numberValue(metrics.overall),
      imageBytes: buffer.byteLength,
    })
    .returning()

  return Response.json({ capture: toResponse(row) }, { status: 201 })
}

export default async (req: Request) => {
  try {
    if (req.method === 'GET') {
      return listCaptures(req)
    }

    if (req.method === 'POST') {
      return saveCapture(req)
    }

    return new Response('Method not allowed', { status: 405 })
  } catch {
    return Response.json({ error: 'Capture service failed' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/captures',
}
