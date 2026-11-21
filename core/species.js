// "Is this your pet" without a key and without a network: a local frame model (CLIP ViT-B/32, ONNX) and a reference —
// 3–5 photos or videos that the owner gave once. Then the model learns from confirmed videos.
// Thresholds are computed from the reference: how similar its frames are to each other (checked on 10 videos of Vova's, test/species.test.js).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export const THRESHOLDS = { mine: 0.92, other: 0.85, animal: 0.4 };
const MAX_REFS = 20;
const JUDGE_K = 12;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.heic']);

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const r4 = (v) => v.map((x) => Math.round(x * 1e4) / 1e4);

/** Similarity score to the reference: each frame gets its nearest reference, the score is the average of the three best frames. */
export function scoreAgainst(frames, refs) {
  if (!frames?.length || !refs?.length) return null;
  const best = frames.map((f) => Math.max(...refs.map((r) => dot(f, r)))).sort((a, b) => b - a).slice(0, 3);
  return best.reduce((s, x) => s + x, 0) / best.length;
}

/** Share of frames where the nearest caption is "animal" (the first labels.animal captions). */
export function animalShare(frames, labels) {
  if (!frames?.length) return 0;
  let n = 0;
  for (const f of frames) {
    let bi = 0, bv = -Infinity;
    labels.vectors.forEach((v, i) => { const d = dot(f, v); if (d > bv) { bv = d; bi = i; } });
    if (bi < labels.animal) n++;
  }
  return n / frames.length;
}

/**
 * Thresholds from the owner's reference: each frame's similarity to the nearest other frame of the reference; we take the worst
 * (within 0.90–0.96). "Mine" — 0.03 lower, "not him" — 0.12 lower. If the reference has fewer than two frames — fallback thresholds.
 */
export function thresholdsFor(refVectors) {
  if (!refVectors || refVectors.length < 2) return THRESHOLDS;
  const loo = refVectors.map((a, i) => Math.max(...refVectors.filter((_, j) => j !== i).map((b) => dot(a, b))));
  const base = Math.min(0.96, Math.max(0.90, Math.min(...loo)));
  return { mine: base - 0.03, other: base - 0.12, animal: THRESHOLDS.animal };
}

/** mine — your pet; other — another animal; empty — there is almost no pet in the frame; unsure — ask the person. */
export function verdictOf({ score, animal }, T = THRESHOLDS) {
  if (score == null) return 'unsure';
  if (animal != null && animal < T.animal) return score >= T.mine ? 'unsure' : 'empty';
  if (score >= T.mine) return 'mine';
  if (score >= T.other) return 'unsure';
  return 'other';
}

let labelsCache = null;
export function loadLabels() {
  if (!labelsCache) labelsCache = JSON.parse(readFileSync(new URL('./clip-labels.json', import.meta.url), 'utf8'));
  return labelsCache;
}

function run(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', () => {});
    p.on('error', () => resolve(Buffer.alloc(0)));
    p.on('close', () => resolve(Buffer.concat(out)));
  });
}

const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
const SIDE = 224;

/**
 * Frame model: file → k normalized vectors (512). ONNX is loaded lazily on the first frame.
 * No model on disk — available false, and the app works the old way (asks the person).
 */
export function createClipEmbedder({ modelDir, ffmpeg, ffprobe, ortModule = 'onnxruntime-node' } = {}) {
  const modelFile = modelDir ? join(modelDir, 'vision_model_quantized.onnx') : null;
  const available = Boolean(modelFile && existsSync(modelFile) && ffmpeg);
  let session = null;
  async function load() {
    if (session) return session;
    const ort = await import(ortModule);
    const s = await (ort.InferenceSession ?? ort.default.InferenceSession).create(modelFile);
    session = { s, Tensor: ort.Tensor ?? ort.default.Tensor };
    return session;
  }
  async function duration(file) {
    if (!ffprobe) return 10;
    const out = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    return parseFloat(out.toString()) || 10;
  }
  async function frame(file, ts) {
    const args = ['-v', 'error'];
    if (ts != null) args.push('-ss', String(ts));
    args.push('-i', file, '-frames:v', '1', '-vf', `scale=${SIDE}:${SIDE}:force_original_aspect_ratio=increase,crop=${SIDE}:${SIDE}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
    const b = await run(ffmpeg, args);
    return b.length === SIDE * SIDE * 3 ? b : null;
  }
  /** Vectors of a batch of RGB SIDE×SIDE frames (in batches, so that not everything is held in model memory). */
  async function vectors(shots) {
    const { s, Tensor } = await load();
    const P = SIDE * SIDE;
    const res = [];
    for (let at = 0; at < shots.length; at += 32) {
      const part = shots.slice(at, at + 32);
      const data = new Float32Array(part.length * 3 * P);
      part.forEach((b, n) => {
        const o = n * 3 * P;
        for (let i = 0; i < P; i++) for (let c = 0; c < 3; c++) data[o + c * P + i] = (b[i * 3 + c] / 255 - MEAN[c]) / STD[c];
      });
      const out = await s.run({ [s.inputNames[0]]: new Tensor('float32', data, [part.length, 3, SIDE, SIDE]) });
      const t = out.image_embeds ?? out[s.outputNames[0]];
      const D = t.dims[1];
      for (let n = 0; n < part.length; n++) {
        const v = Array.from(t.data.slice(n * D, (n + 1) * D));
        const len = Math.hypot(...v) || 1;
        res.push(v.map((x) => x / len));
      }
    }
    return res;
  }
  return {
    available,
    /**
     * A frame every step seconds in full, without cropping the edges: the short side is SIDE·grid, squares of SIDE
     * with overlap cover the whole frame. For the privacy filter: a person may be at the edge.
     * Returns [{ t, v }] — one vector per square.
     */
    async embedAt(file, { step = 1, grid = 1 } = {}) {
      if (!available) throw new Error('модели нет');
      const d = await duration(file);
      const short = SIDE * grid;
      const probe = await run(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${short}:-2`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
      let w = short, h = probe.length / (short * 3);
      if (!(h >= short)) { h = short; w = 0; }
      if (!w) { const p2 = await run(ffmpeg, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=-2:${short}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']); w = p2.length / (short * 3); }
      if (!(w >= SIDE && h >= SIDE) || !Number.isInteger(w) || !Number.isInteger(h)) return [];
      const at = (len) => { const n = Math.ceil((len - SIDE) / (SIDE * 0.75)) + 1; return Array.from({ length: n }, (_, i) => Math.round(i * (len - SIDE) / Math.max(1, n - 1))); };
      const xs = at(w), ys = at(h);
      const res = [];
      for (let from = 0; from < d; from += 30) {
        const len = Math.min(30, d - from);
        const raw = await run(ffmpeg, ['-v', 'error', '-ss', String(from), '-t', String(len), '-i', file, '-vf', `fps=1/${step},scale=${w}:${h}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
        const F = w * h * 3, shots = [], ts = [];
        for (let k = 0; (k + 1) * F <= raw.length; k++) {
          const t = +(from + k * step).toFixed(3);
          if (t >= d) break;
          for (const y of ys) for (const x of xs) {
            const b = Buffer.alloc(SIDE * SIDE * 3);
            for (let r = 0; r < SIDE; r++) raw.copy(b, r * SIDE * 3, k * F + ((y + r) * w + x) * 3, k * F + ((y + r) * w + x + SIDE) * 3);
            shots.push(b); ts.push(t);
          }
        }
        const vs = shots.length ? await vectors(shots) : [];
        vs.forEach((v, i) => res.push({ t: ts[i], v }));
      }
      return res;
    },
    async embed(file, { k = JUDGE_K } = {}) {
      if (!available) throw new Error('модели нет');
      const image = IMAGE_EXT.has(extname(file).toLowerCase());
      const shots = [];
      if (image) { const b = await frame(file, null); if (b) shots.push(b); } else {
        const d = await duration(file);
        for (let i = 0; i < k; i++) { const b = await frame(file, d * (i + 0.5) / k); if (b) shots.push(b); }
      }
      if (!shots.length) throw new Error('кадры не читаются');
      return vectors(shots);
    },
  };
}

const safeName = (id) => `${String(id).replace(/[\\/:*?"<>|\s]+/g, '_').slice(-60)}-${createHash('sha1').update(String(id)).digest('hex').slice(0, 10)}.json`;

/**
 * Recognizes your pet: the reference is stored in dataRoot/.species, the video frames — in the cache,
 * so the verdict is recalculated against the new reference without re-running the model.
 */
export function createSpecies({ dataRoot, embedder, labels = null, thresholds = null } = {}) {
  const dir = join(dataRoot, '.species');
  const framesDir = join(dir, 'frames');
  const file = join(dir, 'species.json');
  let db = { refs: [] };
  try { db = { refs: [], ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  const available = Boolean(embedder?.available);
  let lbl = labels;
  const getLabels = () => { if (!lbl) { try { lbl = loadLabels(); } catch { lbl = { vectors: [], animal: 0 }; } } return lbl; };

  function save() {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify(db)); renameSync(tmp, file);
  }
  const cachePath = (id) => join(framesDir, safeName(id));
  function cached(id) { try { return JSON.parse(readFileSync(cachePath(id), 'utf8')).v; } catch { return null; } }
  async function framesOf(path, id) {
    const c = cached(id); if (c) return c;
    const v = (await embedder.embed(path, { k: JUDGE_K })).map(r4);
    mkdirSync(framesDir, { recursive: true });
    writeFileSync(cachePath(id), JSON.stringify({ v }));
    return v;
  }

  return {
    available,
    hasReference: () => db.refs.length > 0,
    refCount: () => db.refs.length,
    refs: () => db.refs.map((r) => ({ ...r })),

    /**
     * Reference from the owner: from a video we look at 12 frames and take 3 where the pet is best visible; a photo — 1 frame.
     * Shots without the pet — into noAnimal, unreadable ones — into failed. If together with the previous reference there are fewer than 3 shots
     * with the pet — we save nothing (needMore), so that the reference is not built from an empty room.
     */
    async addReference(files) {
      const failed = []; const noAnimal = []; const picked = [];
      const L = getLabels();
      const margin = (v) => {
        let a = -Infinity, o = -Infinity;
        L.vectors.forEach((x, i) => { const d = dot(v, x); if (i < L.animal) a = Math.max(a, d); else o = Math.max(o, d); });
        return a - o;
      };
      for (const f of files) {
        const image = IMAGE_EXT.has(extname(f).toLowerCase());
        let vs;
        try { vs = await embedder.embed(f, { k: image ? 1 : JUDGE_K }); } catch { failed.push(basename(f)); continue; }
        const take = image ? 1 : 3;
        const good = L.vectors.length && L.animal
          ? vs.map((v) => ({ v, m: margin(v) })).filter((x) => x.m > 0).sort((a, b) => b.m - a.m).slice(0, take).map((x) => x.v)
          : vs.slice(0, take);
        if (!good.length) { noAnimal.push(basename(f)); continue; }
        for (const v of good) picked.push({ from: 'user', id: basename(f), v: r4(v) });
      }
      const users = db.refs.filter((r) => r.from === 'user').length;
      if (users + picked.length < 3) return { added: 0, found: picked.length, needMore: true, failed, noAnimal };
      db.refs.push(...picked);
      save();
      return { added: picked.length, found: picked.length, failed, noAnimal };
    },

    /** Verdict for a video. Without the model, without a reference, or if the frames cannot be read — "not sure". */
    async judge(path, id = basename(path)) {
      if (!available) return { verdict: 'unsure', score: null, animal: null };
      let frames;
      try { frames = await framesOf(path, id); } catch { return { verdict: 'unsure', score: null, animal: null }; }
      const score = scoreAgainst(frames, db.refs.map((r) => r.v));
      const L = getLabels();
      const animal = L.vectors.length ? animalShare(frames, L) : null;
      const T = thresholds ?? thresholdsFor(db.refs.filter((r) => r.from === 'user').map((r) => r.v));
      return { verdict: verdictOf({ score, animal }, T), score: score == null ? null : Math.round(score * 1e4) / 1e4, animal };
    },

    /** The owner confirmed "mine" — the most similar frame of the video goes into the reference (no more than 20; the owner's own shots are not pushed out). */
    learn(id) {
      const frames = cached(id);
      if (!frames?.length || db.refs.some((r) => r.id === id)) return false;
      const users = db.refs.filter((r) => r.from === 'user').length;
      if (users >= MAX_REFS) return false;
      const rv = db.refs.map((r) => r.v);
      const best = rv.length ? frames.reduce((a, f) => (Math.max(...rv.map((r) => dot(f, r))) > Math.max(...rv.map((r) => dot(a, r))) ? f : a)) : frames[0];
      db.refs.push({ from: 'auto', id, v: best });
      while (db.refs.length > MAX_REFS) db.refs.splice(db.refs.findIndex((r) => r.from !== 'user'), 1);
      save();
      return true;
    },
  };
}
