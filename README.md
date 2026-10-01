# WildShift — test version

Upload a clip (≤ 60 s) → pick the 5–10 s moment and when the morph hits → pick an animal and style →
the app keeps your real footage up to the morph point, then an AI video model turns you into the animal
and keeps the action going. The free preview gets a big watermark; "paying" (mocked in this version)
unlocks the clean HD file.

## How it works

1. **Trim**: ffmpeg cuts the chosen moment and normalizes it to 720p / 30 fps.
2. **Morph frame**: grabs the frame at the morph point (25 / 50 / 75 % into the moment).
3. **AI**: sends that frame plus a prompt to the video model on fal.ai (default: Kling v3 Standard image-to-video).
   It starts as you and transforms into the animal while carrying on the motion.
4. **Stitch**: real footage up to the morph point plus the AI clip, with the original audio underneath.
5. **Watermark**: a tiled "WildShift" pattern and a "FREE PREVIEW" badge are burned into the preview.
   The clean file is served only after unlock.

Clips are deleted after 24 hours (`KEEP_HOURS`).

## Run it on your computer

Requires Node 20 or newer.

```bash
npm install
npm start                 # no key = MOCK mode (a stand-in effect, costs nothing)
FAL_KEY=xxx npm start     # real AI morphs
```

Then open http://localhost:3000.

## Settings (environment variables)

| Name | What it does |
|---|---|
| `FAL_KEY` | fal.ai API key. Leave it unset to use mock mode. |
| `ACCESS_CODE` | If set, testers must enter this code. **Set it when hosting publicly** so strangers can't spend your AI credit. |
| `FAL_MODEL` | Swap the AI model, e.g. `fal-ai/kling-video/v3/pro/image-to-video` or `fal-ai/veo3.1/fast/image-to-video`. |
| `MAX_CONCURRENT` | Number of clips processed at once (default 2). |
| `KEEP_HOURS` | How long clips are kept (default 24). |

## Put it online (Render)

1. Push this folder to a GitHub repo.
2. On render.com, choose New → Blueprint and pick the repo. It reads `render.yaml`.
3. Enter `FAL_KEY` and `ACCESS_CODE` when asked, then deploy.

## Not in the test version yet

- Real payments (Stripe), accounts, and enforcing one free clip per person. Pack credits are stored only in the browser.
- Privacy policy and terms, plus parental consent wording for kids' videos.
- Durable storage. Jobs live in memory, so a restart forgets in-progress jobs.
