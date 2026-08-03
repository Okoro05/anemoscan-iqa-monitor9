# AnemoScan IQA Monitor Architecture

This project is a TanStack Start React application deployed on Netlify. The main UI lives in `src/routes/index.tsx` and the global visual system lives in `src/styles.css`.

## Key Directories

- `src/routes/`: TanStack Start routes. The root monitor page contains the live camera UI and client-side IQA analyzer.
- `netlify/functions/`: Netlify Functions used for persisted capture APIs.
- `db/`: Drizzle ORM schema and Netlify Database client.
- `netlify/database/migrations/`: SQL migrations applied by Netlify Database.

## Persistence

Captured image files are stored in Netlify Blobs under the `hemovision-captures` store. Structured metadata is stored in Netlify Database in the `captures` table. Do not replace this with local JSON files or in-memory state for saved captures.

## IQA Logic

The client samples the video feed into a hidden canvas every 500 milliseconds. Brightness is average luminance, contrast is grayscale standard deviation, and sharpness is a Laplacian-style variance estimate. Overall score uses:

```text
brightness * 0.30 + sharpness * 0.40 + contrast * 0.30
```

The default quality threshold is `60`, constrained by product requirements to the 55-65 acceptance band.

## Coding Conventions

- Keep UI changes responsive across mobile, tablet, and desktop.
- Keep the cyber-medical aesthetic consistent with the existing cyan, green, amber, and red palette.
- Keep camera and canvas APIs inside client-only effects or event handlers.
- Use Netlify Functions for server persistence and avoid exposing storage details directly in client code.
