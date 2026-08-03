import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'

const captureStore = getStore('hemovision-captures')

export default async (req: Request) => {
  const url = new URL(req.url)
  const key = decodeURIComponent(url.pathname.replace('/api/captures/', ''))

  if (!key.startsWith('captures/')) {
    return new Response('Not found', { status: 404 })
  }

  const image = await captureStore.get(key, { type: 'arrayBuffer' })

  if (!image) {
    return new Response('Not found', { status: 404 })
  }

  const contentType = key.endsWith('.png')
    ? 'image/png'
    : key.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'

  return new Response(image, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': contentType,
    },
  })
}

export const config: Config = {
  path: '/api/captures/*',
}
