// 자동 자막: whisper.cpp로 타임라인의 말소리를 인식해 시간이 붙은 문장 목록을 만든다.
// 실행 파일과 모델은 처음 쓸 때 내려받아 baseDir(앱 데이터 폴더/whisper)에 둔다.
// Electron에 의존하지 않으므로 node로 단독 테스트할 수 있다.
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderSpeechAudio } = require('./exporter.cjs');

// 검증한 버전으로 고정한다. (Windows x64, CPU용)
const WHISPER_BUILD = 'b5454';
const WHISPER_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BUILD}/whisper-bin-x64.zip`;
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

const MODELS = {
  base: { file: 'ggml-base.bin', bytes: 147951465 },
  small: { file: 'ggml-small.bin', bytes: 487601967 },
  turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', bytes: 574041195 },
};

let baseDir = path.join(os.tmpdir(), 'video-editor-whisper');
let current = null;

const engineDir = () => path.join(baseDir, `whisper-${WHISPER_BUILD}`);
const cliPath = () => path.join(engineDir(), 'Release', 'whisper-cli.exe');
const modelPath = (id) => path.join(baseDir, 'models', MODELS[id].file);

function init(dir) {
  baseDir = dir;
}

function getStatus() {
  return {
    engine: fs.existsSync(cliPath()),
    models: Object.fromEntries(Object.keys(MODELS).map((id) => [id, fs.existsSync(modelPath(id))])),
  };
}

function canceledError() {
  return Object.assign(new Error('취소되었습니다.'), { canceled: true });
}

/** 파일을 내려받는다. 다 받기 전에는 .part 이름으로 두었다가 끝나면 바꾼다. */
async function download(url, dest, onProgress, signal) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { signal, redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`다운로드에 실패했습니다 (HTTP ${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  let received = 0;
  try {
    for await (const chunk of res.body) {
      received += chunk.length;
      if (!out.write(chunk)) await once(out, 'drain');
      if (total) onProgress(received / total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw signal?.aborted ? canceledError() : e;
  }
  fs.renameSync(part, dest);
}

/** 프로그램을 실행하고 끝날 때까지 기다린다. onLine으로 출력 줄을 받는다. */
function run(file, args, job, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(file, args, { windowsHide: true });
    job.kill = () => proc.kill();
    let tail = '';
    const onData = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-3000);
      text.split(/\r?\n/).forEach((l) => onLine?.(l));
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (job.canceled) reject(canceledError());
      else if (code === 0) resolve();
      else reject(new Error(tail.trim().split('\n').slice(-6).join('\n') || `종료 코드 ${code}`));
    });
  });
}

async function ensureEngine(job, onProgress) {
  if (fs.existsSync(cliPath())) return;
  const zip = path.join(baseDir, `whisper-${WHISPER_BUILD}.zip`);
  await download(WHISPER_ZIP_URL, zip, (p) => onProgress({ phase: 'engine', progress: p }), job.abort.signal);
  fs.mkdirSync(engineDir(), { recursive: true });
  // Windows 10 이상에 기본으로 있는 tar로 zip을 푼다.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  await run(tar, ['-xf', zip, '-C', engineDir()], job);
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(cliPath())) throw new Error('whisper.cpp 압축을 풀었지만 whisper-cli.exe를 찾지 못했습니다.');
}

async function ensureModel(id, job, onProgress) {
  const dest = modelPath(id);
  if (fs.existsSync(dest)) return dest;
  await download(`${MODEL_BASE_URL}/${MODELS[id].file}`, dest, (p) => onProgress({ phase: 'model', progress: p }), job.abort.signal);
  return dest;
}

/** 16kHz 모노 16비트 WAV의 소리 데이터를 읽는다. */
function readWavSamples(file) {
  const buf = fs.readFileSync(file);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const bytes = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)));
    }
    off += 8 + size + (size & 1);
  }
  return new Int16Array(0);
}

const FRAMES_PER_SECOND = 100; // 10ms 단위로 소리 크기를 잰다

/**
 * whisper는 앞뒤 무음까지 문장에 포함하는 일이 많다.
 * 실제 소리 크기를 보고 각 자막의 시작·끝을 말소리가 있는 곳으로 좁힌다.
 */
function tightenToSpeech(segments, wavFile, sampleRate = 16000) {
  const samples = readWavSamples(wavFile);
  const frameLen = sampleRate / FRAMES_PER_SECOND;
  const frames = Math.floor(samples.length / frameLen);
  const rms = new Float32Array(frames);
  let max = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = i * frameLen; j < (i + 1) * frameLen; j++) sum += (samples[j] / 32768) ** 2;
    rms[i] = Math.sqrt(sum / frameLen);
    max = Math.max(max, rms[i]);
  }
  const threshold = Math.max(0.003, max * 0.05);
  return segments.map((seg) => {
    const from = Math.max(0, Math.floor(seg.start * FRAMES_PER_SECOND));
    const to = Math.min(frames, Math.ceil(seg.end * FRAMES_PER_SECOND));
    let first = -1;
    let last = -1;
    for (let i = from; i < to; i++) {
      if (rms[i] > threshold) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return seg;
    const start = Math.max(seg.start, first / FRAMES_PER_SECOND - 0.1);
    const end = Math.min(seg.end, (last + 1) / FRAMES_PER_SECOND + 0.15);
    return end - start >= 0.3 ? { ...seg, start, end } : seg;
  });
}

/**
 * 타임라인의 말소리를 인식한다.
 * @param plan 내보내기와 같은 형식 (클립 목록·길이). 배경음악 트랙은 빼고 듣는다.
 * @param model 'base' | 'small' | 'turbo'
 * @param language 'ko' | 'en' | 'ja' | 'auto' ...
 * @param onProgress ({ phase: 'engine'|'model'|'audio'|'recognize', progress: 0~1 })
 * @returns [{ start, end, text }] (초)
 */
async function transcribe({ plan, model, language }, onProgress) {
  if (current) throw new Error('이미 자막을 만들고 있습니다.');
  if (!MODELS[model]) throw new Error(`알 수 없는 모델: ${model}`);
  const job = { canceled: false, abort: new AbortController(), kill: () => {} };
  current = job;

  const work = path.join(os.tmpdir(), `video-editor-stt-${process.pid}-${Date.now()}`);
  try {
    await ensureEngine(job, onProgress);
    const modelFile = await ensureModel(model, job, onProgress);
    if (job.canceled) throw canceledError();

    fs.mkdirSync(work, { recursive: true });
    const wav = path.join(work, 'speech.wav');
    onProgress({ phase: 'audio', progress: 0 });
    const ffmpeg = await renderSpeechAudio(plan, wav, (p) => onProgress({ phase: 'audio', progress: p }));
    job.kill = ffmpeg.kill;
    await ffmpeg.promise;
    if (job.canceled) throw canceledError();

    onProgress({ phase: 'recognize', progress: 0 });
    const threads = Math.max(1, Math.min(8, os.cpus().length - 1));
    const outBase = path.join(work, 'result');
    // -ml/-sow: 자막으로 쓰기 좋게 문장을 적당한 길이로 끊는다. -oj: 시간 정보가 있는 JSON
    const args = ['-m', modelFile, '-f', wav, '-l', language, '-t', String(threads), '-ml', '40', '-sow', '-oj', '-of', outBase, '-np', '-pp'];
    await run(cliPath(), args, job, (line) => {
      const m = /progress\s*=\s*(\d+)%/.exec(line);
      if (m) onProgress({ phase: 'recognize', progress: Number(m[1]) / 100 });
    });

    const result = JSON.parse(fs.readFileSync(`${outBase}.json`, 'utf8'));
    const segments = (result.transcription ?? [])
      .map((seg) => ({ start: seg.offsets.from / 1000, end: seg.offsets.to / 1000, text: String(seg.text).trim() }))
      .filter((s) => s.text && s.end > s.start);
    return tightenToSpeech(segments, wav);
  } catch (e) {
    if (job.canceled || job.abort.signal.aborted) throw canceledError();
    throw e;
  } finally {
    current = null;
    fs.rm(work, { recursive: true, force: true }, () => {});
  }
}

function cancelTranscribe() {
  if (!current) return;
  current.canceled = true;
  current.abort.abort();
  current.kill();
}

module.exports = { init, getStatus, transcribe, cancelTranscribe, MODELS };
