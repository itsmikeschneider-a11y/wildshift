// WildShift — test version server
// Upload a clip -> trim the chosen moment -> AI morphs the person into an animal
// from the chosen morph point -> stitch real footage + morph -> watermark preview.

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');
const FFMPEG = process.env.FFMPEG_PATH || require('ffmpeg-static');
const FFPROBE = process.env.FFPROBE_PATH || require('ffprobe-static').path;
const { fal } = require('@fal-ai/client');

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY || '';
const MODEL = process.env.FAL_MODEL || 'fal-ai/kling-video/v3/standard/image-to-video';
const MOCK_AI = !FAL_KEY || process.env.MOCK_AI === '1';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 400);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);
const KEEP_HOURS = Number(process.env.KEEP_HOURS || 24);

if (FAL_KEY) fal.config({ credentials: FAL_KEY });
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'jobs'), { recursive: true });

const ANIMALS = {
  cheetah: { name: 'cheetah', coat: 'golden spotted fur', action: 'sprinting forward at incredible speed' },
  wolf: { name: 'wolf', coat: 'thick grey fur', action: 'bounding forward with powerful strides' },
  eagle: { name: 'eagle', coat: 'brown and white feathers', action: 'spreading huge wings and soaring forward' },
  bear: { name: 'bear', coat: 'shaggy brown fur', action: 'charging forward with huge power' },
  dolphin: { name: 'dolphin', coat: 'sleek grey skin', action: 'leaping and gliding forward gracefully' },
  kangaroo: { name: 'kangaroo', coat: 'reddish-brown fur', action: 'hopping forward in giant bounds' },
};
const STYLES = {
  toon: 'expressive, stylized 3D animated character (feature-film animation quality, big expressive eyes) — an anthropomorphic',
  real: 'photorealistic',
};
const MORPH_AT = { early: 0.25, mid: 0.5, late: 0.75 };

// ---------- helpers ----------
function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`${path.basename(bin)} exited ${code}: ${err.slice(-1500)}`)));
  });
}
const ff = (args) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

async function probe(file) {
  const j = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { duration: parseFloat(j.format && j.format.duration) || 0, hasVideo: !!v, hasAudio: !!a, width: v && v.width, height: v && v.height };
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];

function buildPrompt(animalKey, styleKey) {
  const a = ANIMALS[animalKey];
  const style = STYLES[styleKey];
  return [
    `The person in this shot magically transforms into a ${style} ${a.name} in one fluid morph during the first second and a half:`,
    `${a.coat} ripples across their body, the face reshapes, and the body fully becomes the ${a.name}.`,
    `The ${a.name} keeps doing the exact same action in the same direction of travel as the person — ${a.action} — full of energy.`,
    `Same location, same background, same lighting, same camera angle and camera movement as the original footage. Only one subject. No text.`,
  ].join(' ');
}

// ---------- job queue ----------
const jobs = new Map();
let running = 0;
const waiting = [];
function enqueue(job) { waiting.push(job); pump(); }
function pump() {
  while (running < MAX_CONCURRENT && waiting.length) {
    const job = waiting.shift();
    running++;
    processJob(job)
      .catch((e) => { console.error(`[job ${job.id}]`, e); job.status = 'error'; job.error = friendlyError(e); })
      .finally(() => { running--; fs.rm(job.upload, { force: true }, () => {}); pump(); });
  }
  waiting.forEach((j, i) => { j.stage = i === 0 ? 'Next in line…' : `In line (${i + 1} ahead)`; });
}
function friendlyError(e) {
  const m = String(e && e.message || e);
  if (/credentials|401|403|Unauthorized/i.test(m)) return 'The AI service rejected our key. Check FAL_KEY.';
  if (/balance|credit|payment|402/i.test(m)) return 'The AI service account is out of credit.';
  return 'Something went wrong making your clip. Please try again.';
}

async function processJob(job) {
  const dir = job.dir;
  const p = (f) => path.join(dir, f);
  job.status = 'working';
  job.stage = 'Finding you in the clip';
  job.progress = 5;

  // 1. Trim the chosen moment, normalize to 720p / 30fps, always with an audio track.
  const src = await probe(job.upload);
  const len = Math.min(job.length, src.duration - job.start);
  await ff([
    '-ss', String(job.start), '-t', String(len), '-i', job.upload,
    '-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=44100:cl=stereo',
    '-map', '0:v:0', '-map', src.hasAudio ? '0:a:0' : '1:a:0',
    '-vf', "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)',fps=30,setsar=1",
    ...H264, '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', p('seg.mp4'),
  ]);
  const seg = await probe(p('seg.mp4'));
  const W = seg.width, H = seg.height;
  const tm = Math.max(0.5, seg.duration * MORPH_AT[job.morph]);
  job.progress = 12;

  // 2. Real footage up to the morph point + the frame the AI starts from.
  await ff(['-i', p('seg.mp4'), '-t', tm.toFixed(3), '-an', ...H264, p('real.mp4')]);
  await ff(['-ss', tm.toFixed(3), '-i', p('seg.mp4'), '-frames:v', '1', '-q:v', '2', p('frame.jpg')]);
  job.progress = 18;

  // 3. AI morph clip starting from that frame.
  const aiSeconds = clamp(Math.round(seg.duration - tm), 4, 10);
  job.stage = 'Tracking your motion';
  const ticker = setInterval(() => {
    job.progress = Math.min(90, job.progress + (90 - job.progress) * 0.035);
    if (job.progress > 45) job.stage = `Morphing into ${/^[aeiou]/.test(ANIMALS[job.animal].name) ? 'an' : 'a'} ${ANIMALS[job.animal].name}`;
  }, 2000);
  try {
    if (MOCK_AI) await mockMorph(p('frame.jpg'), aiSeconds, p('ai_raw.mp4'));
    else await falMorph(job, p('frame.jpg'), aiSeconds, p('ai_raw.mp4'));
  } finally { clearInterval(ticker); }
  job.stage = 'Putting it all together';
  job.progress = 92;

  // 4. Match the AI clip to the original frame size, then stitch with original audio underneath.
  await ff([
    '-i', p('ai_raw.mp4'), '-an',
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,setsar=1`,
    ...H264, p('ai.mp4'),
  ]);
  const total = ((await probe(p('real.mp4'))).duration + (await probe(p('ai.mp4'))).duration).toFixed(3);
  await ff([
    '-i', p('real.mp4'), '-i', p('ai.mp4'), '-i', p('seg.mp4'),
    '-filter_complex', `[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a]apad=whole_dur=${total},atrim=0:${total}[a]`,
    '-map', '[v]', '-map', '[a]', '-t', total, ...H264, '-c:a', 'aac', '-movflags', '+faststart', p('clean.mp4'),
  ]);
  job.progress = 96;

  // 5. Big fat watermark for the free preview.
  const P = Math.ceil(Math.hypot(W, H));
  const BW = even(W * 0.62), BH = even(BW * 110 / 868); // badge png is 868x110
  await ff([
    '-i', p('clean.mp4'), '-i', path.join(__dirname, 'assets/wm_pattern.png'), '-i', path.join(__dirname, 'assets/wm_badge.png'),
    '-filter_complex', `[1]scale=${P}:${P}[pat];[2]scale=${BW}:${BH}[bad];[0:v][pat]overlay=(W-w)/2:(H-h)/2[t];[t][bad]overlay=(W-w)/2:H-h-H*0.05[v]`,
    '-map', '[v]', '-map', '0:a', ...H264, '-c:a', 'copy', '-movflags', '+faststart', p('preview.mp4'),
  ]);

  for (const f of ['seg.mp4', 'real.mp4', 'ai.mp4', 'ai_raw.mp4']) fs.rm(p(f), { force: true }, () => {});
  job.status = 'done';
  job.stage = 'Ready';
  job.progress = 100;
  job.finishedAt = Date.now();
}

async function falMorph(job, framePath, seconds, outPath) {
  const buf = await fsp.readFile(framePath);
  const imageUrl = await fal.storage.upload(new Blob([buf], { type: 'image/jpeg' }));
  const input = {
    start_image_url: imageUrl,
    prompt: buildPrompt(job.animal, job.style),
    duration: String(seconds),
    generate_audio: false,
    negative_prompt: 'blur, distort, low quality, extra limbs, two animals, duplicate subject, text, watermark, frozen, static',
  };
  const result = await fal.subscribe(MODEL, { input, logs: false });
  const url = result && result.data && result.data.video && result.data.video.url;
  if (!url) throw new Error('AI returned no video: ' + JSON.stringify(result).slice(0, 500));
  job.aiRequestId = result.requestId;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download of AI video failed: ' + res.status);
  await fsp.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
}

// Without an API key: a stand-in "morph" (slow zoom + orange tint) so the whole flow can be tested for free.
async function mockMorph(framePath, seconds, outPath) {
  await new Promise((r) => setTimeout(r, 4000));
  await ff([
    '-loop', '1', '-i', framePath, '-t', String(seconds),
    '-vf', `scale=1280:-2,zoompan=z='min(zoom+0.0025,1.4)':d=${seconds * 30}:s=1280x720:fps=30,colorchannelmixer=rr=1.1:gg=0.75:bb=0.4,eq=saturation=1.6`,
    ...H264, outPath,
  ]);
}

// ---------- web ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/api/config', (req, res) => res.json({ needsCode: !!ACCESS_CODE, mock: MOCK_AI, animals: Object.keys(ANIMALS) }));

app.use('/api', (req, res, next) => {
  if (!ACCESS_CODE) return next();
  const code = req.get('x-access-code') || req.query.code;
  if (code === ACCESS_CODE) return next();
  res.status(401).json({ error: 'Access code needed' });
});

const upload = multer({ dest: path.join(DATA, 'uploads'), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

app.post('/api/jobs', upload.single('video'), async (req, res) => {
  const f = req.file;
  const bad = (msg) => { if (f) fs.rm(f.path, { force: true }, () => {}); res.status(400).json({ error: msg }); };
  try {
    if (!f) return bad('No video uploaded.');
    const animal = String(req.body.animal || '');
    const style = String(req.body.style || 'toon');
    const morph = String(req.body.morph || 'mid');
    if (!ANIMALS[animal]) return bad('Pick an animal.');
    if (!STYLES[style]) return bad('Pick a style.');
    if (!MORPH_AT[morph]) return bad('Pick when the morph happens.');
    const info = await probe(f.path).catch(() => null);
    if (!info || !info.hasVideo || !info.duration) return bad("We couldn't read that video. Try an MP4 or MOV.");
    if (info.duration > 61) return bad(`That clip is ${Math.round(info.duration)} seconds. Please keep it to 60 seconds or less.`);
    if (info.duration < 3) return bad('That clip is too short. It needs at least 3 seconds.');
    const length = clamp(Number(req.body.length) || 8, 3, Math.min(10, info.duration));
    const start = clamp(Number(req.body.start) || 0, 0, Math.max(0, info.duration - length));

    const id = crypto.randomBytes(16).toString('hex');
    const dir = path.join(DATA, 'jobs', id);
    await fsp.mkdir(dir, { recursive: true });
    const job = { id, dir, upload: f.path, start, length, morph, animal, style, status: 'queued', stage: 'Getting ready', progress: 2, paid: false, createdAt: Date.now() };
    jobs.set(id, job);
    enqueue(job);
    res.json({ id });
  } catch (e) {
    console.error(e);
    bad('Upload failed. Please try again.');
  }
});

function getJob(req, res) {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: 'Not found' }); return null; }
  return job;
}

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req, res); if (!job) return;
  res.json({
    status: job.status, stage: job.stage, progress: Math.round(job.progress), error: job.error || null,
    paid: job.paid, animal: job.animal, style: job.style, mock: MOCK_AI,
  });
});

app.get('/api/jobs/:id/preview.mp4', (req, res) => {
  const job = getJob(req, res); if (!job) return;
  if (job.status !== 'done') return res.status(409).end();
  res.sendFile(path.join(job.dir, 'preview.mp4'));
});

// TEST MODE: "payment" just flips the flag. Replace with Stripe before launch.
app.post('/api/jobs/:id/unlock', (req, res) => {
  const job = getJob(req, res); if (!job) return;
  if (job.status !== 'done') return res.status(409).json({ error: 'Not ready yet' });
  job.paid = true;
  res.json({ paid: true });
});

app.get('/api/jobs/:id/clean.mp4', (req, res) => {
  const job = getJob(req, res); if (!job) return;
  if (!job.paid) return res.status(402).json({ error: 'Payment required' });
  if (req.query.download) res.attachment(`wildshift-${job.animal}.mp4`);
  res.sendFile(path.join(job.dir, 'clean.mp4'));
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `That file is over ${MAX_UPLOAD_MB} MB. Try a shorter or lower-resolution clip.` });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Delete old clips (they're kids' videos — don't keep them around).
setInterval(() => {
  const cutoff = Date.now() - KEEP_HOURS * 3600 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== 'working') { fs.rm(job.dir, { recursive: true, force: true }, () => {}); jobs.delete(id); }
  }
}, 30 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`WildShift running on http://localhost:${PORT}`);
  console.log(MOCK_AI ? '  AI: MOCK mode (no FAL_KEY) — morphs are a stand-in effect' : `  AI: ${MODEL}`);
  if (ACCESS_CODE) console.log('  Access code required');
});

module.exports = { buildPrompt };
