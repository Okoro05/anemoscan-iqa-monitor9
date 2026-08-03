# AnemoScan IQA Monitor

AnemoScan IQA Monitor is a responsive medical image quality assessment dashboard for real-time conjunctival capture review (used for non-invasive anemia/hemoglobin screening). It uses the browser camera, calculates brightness, sharpness, contrast, and overall IQA scores every 500 milliseconds, and saves snapped images with their analysis results.

## Key Technologies

- TanStack Start with React and TypeScript
- Tailwind CSS for responsive styling
- Lucide React icons
- Netlify Functions for capture APIs
- Netlify Blobs for persisted image files
- Netlify Database with Drizzle ORM for capture metadata

## Local Development

Install dependencies:

```bash
npm install
```

Run locally through Netlify Dev so the Functions, Blobs, and Database integrations are available:

```bash
netlify dev --port 8889
```

The monitor is available at the local Netlify Dev URL. Camera access requires browser permission and generally needs a secure context or localhost.

## Capture Flow

The browser samples the active camera stream into a canvas, calculates IQA metrics, and updates the UI continuously. Pressing the shutter saves the current frame to Netlify Blobs and writes the score, threshold, status, camera label, and blob key to Netlify Database.

The acceptance threshold is centralized in `src/routes/index.tsx`:

```ts
const qualityThreshold = 60
```

Scores greater than or equal to the threshold are marked `READY`; lower scores are marked `LOW QUALITY`.
