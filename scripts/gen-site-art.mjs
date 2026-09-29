// Generates site artwork through the local ComfyUI server (127.0.0.1:8188).
// Run: node scripts/gen-site-art.mjs
// Each entry below is queued as an SDXL-turbo txt2img job; the finished PNG is
// fetched from /view and written to the target path.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = 'http://127.0.0.1:8188'
const CLIENT_ID = 'site-art'
const CKPT = 'sd_xl_turbo_1.0_fp16.safetensors'

// House look shared with the carousel pipeline: wire-photo realism, dark-teal
// night grade to sit inside the site's palette, never any rendered text.
const LOOK = 'AP/Reuters wire photo aesthetic, documentary photography, dark teal and cyan night color grading, cinematic but neutral, high detail, sharp focus, no text, no letters, no watermarks, no logos'
const NEG = 'text, letters, numbers, typography, captions, watermark, signature, logo, cartoon, illustration, oversaturated, low quality, blurry, deformed'

const JOBS = [
  {
    out: 'src/assets/hero.png',
    width: 1216,
    height: 832,
    seed: 20260919,
    prompt: `Aerial night view of a glowing city intersection, dense crowd crossing under bright street lights, a large public news screen glowing teal on a tower in the background, light trails from traffic, ${LOOK}`,
  },
  {
    out: 'public/favicon.png',
    width: 1024,
    height: 1024,
    seed: 60417,
    prompt: `A single glossy teal planet with a thin luminous orbital ring, floating in dark space, subtle stars, centered composition, simple bold iconic shape, macro studio lighting, ${LOOK}`,
  },
]

function workflow({ prompt, width, height, seed }) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: CKPT } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: NEG, clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed, steps: 6, cfg: 1.5, sampler_name: 'euler_ancestral', scheduler: 'karras', denoise: 1,
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { filename_prefix: 'site_art', images: ['6', 0] } },
  }
}

async function generate(job) {
  const response = await fetch(`${HOST}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow(job), client_id: CLIENT_ID }),
  })
  if (!response.ok) throw new Error(`/prompt failed: ${response.status} ${await response.text()}`)
  const { prompt_id: id } = await response.json()

  // Wait for the job to finish (history entry appears with outputs when done).
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const history = await fetch(`${HOST}/history/${id}`).then((r) => r.json())
    const entry = history[id]
    if (!entry) continue
    if (entry.status?.status_str === 'error') throw new Error(`ComfyUI reported an error for ${job.out}`)
    const outputs = entry.outputs || {}
    const save = Object.values(outputs).find((o) => o.images?.length)
    if (save) {
      const img = save.images[0]
      const url = `${HOST}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`
      const bytes = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()))
      const target = join(root, job.out)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      console.log(`wrote ${job.out} (${Math.round(bytes.length / 1024)}KB, seed ${job.seed})`)
      return
    }
  }
  throw new Error(`Timed out waiting for ${job.out}`)
}

for (const job of JOBS) await generate(job)
