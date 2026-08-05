import { getStore } from '@netlify/blobs'
import type { Config } from '@netlify/functions'
import * as ort from 'onnxruntime-node'
import path from 'node:path'
import sharp from 'sharp'

const captureStore = getStore('hemovision-captures')

const IMAGE_SIZE = 224
const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD = [0.229, 0.224, 0.225]

let sessionPromise: Promise<ort.InferenceSession> | null = null

function getSession() {
  if (!sessionPromise) {
    const modelPath = path.join(process.cwd(), 'netlify', 'functions', 'model', 'model.onnx')
    sessionPromise = ort.InferenceSession.create(modelPath)
  }
  return sessionPromise
}

function classifySeverity(hb: number): string {
  if (hb >= 12) return 'Normal'
  if (hb >= 10) return 'Mild Anemia'
  if (hb >= 7) return 'Moderate Anemia'
  return 'Severe Anemia'
}

async function preprocessImage(buffer: Buffer): Promise<Float32Array> {
  const { data } = await sharp(buffer)
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixelCount = IMAGE_SIZE * IMAGE_SIZE
  const chw = new Float32Array(3 * pixelCount)

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 3] / 255
    const g = data[i * 3 + 1] / 255
    const b = data[i * 3 + 2] / 255
    chw[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0]
    chw[pixelCount + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1]
    chw[pixelCount * 2 + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2]
  }

  return chw
}

export default async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const payload = (await req.json()) as { blobKey?: string }

    if (!payload.blobKey) {
      return Response.json({ error: 'blobKey is required' }, { status: 400 })
    }

    const imageData = await captureStore.get(payload.blobKey, { type: 'arrayBuffer' })

    if (!imageData) {
      return Response.json({ error: 'Image not found in store' }, { status: 404 })
    }

    const buffer = Buffer.from(imageData)
    const inputData = await preprocessImage(buffer)
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, IMAGE_SIZE, IMAGE_SIZE])

    const session = await getSession()
    const results = await session.run({ input: inputTensor })
    const predictedHb = Number(results.predicted_hb.data[0])

    return Response.json({
      predictedHb: Math.round(predictedHb * 100) / 100,
      status: classifySeverity(predictedHb),
    })
  } catch (error) {
    console.error('Prediction failed:', error)
    return Response.json({ error: 'Prediction failed' }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/predict',
}
