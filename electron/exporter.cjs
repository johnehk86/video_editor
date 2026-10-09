// 타임라인(ExportPlan)을 FFmpeg 명령으로 바꿔 MP4로 렌더링한다.
// Electron에 의존하지 않으므로 node로 단독 테스트할 수 있다.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 패키징된 앱에서는 실행 파일이 asar 밖(app.asar.unpacked)에 있다.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');

const SAMPLE_RATE = 48000;
const AUDIO_FORMAT = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;
const num = (x) => String(Number(x.toFixed(6)));

/** atempo는 한 번에 0.5~2배만 안정적으로 지원하므로 여러 단계로 나눈다. */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) parts.push(`atempo=${num(s)}`);
  return parts;
}

/** 클립 볼륨과 페이드 인/아웃. d는 타임라인 상의 클립 길이 */
function audioEffects(c, d) {
  const parts = [];
  const volume = c.volume ?? 1;
  const fadeIn = c.fadeIn ?? 0;
  const fadeOut = c.fadeOut ?? 0;
  if (Math.abs(volume - 1) > 1e-6) parts.push(`volume=${num(volume)}`);
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
  if (fadeOut > 0) parts.push(`afade=t=out:st=${num(Math.max(0, d - fadeOut))}:d=${num(fadeOut)}`);
  return parts;
}

/** 파일에 오디오 스트림이 있는지 확인한다. */
function probeHasAudio(file) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', file]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', () => resolve(/Stream #\S+.*: Audio:/.test(stderr)));
    proc.on('error', () => resolve(false));
  });
}

/**
 * 타임라인을 FFmpeg 인자로 바꾼다.
 * @param plan { settings: {width,height,fps,crf}, duration, clips: [{path,kind,track,start,in,out,speed,volume,fadeIn,fadeOut}] }
 * @param hasAudio Map<path, boolean>
 * @param opts.audioOnly 음성 인식용: 영상 없이 16kHz 모노 WAV만 만든다
 * @param opts.excludeTracks 섞지 않을 트랙 (예: 음성 인식 때 배경음악 제외)
 * @param opts.overlayList 그래픽 PNG를 이어 붙인 ffconcat 목록 파일 (영상 위에 겹친다)
 */
function buildFfmpegArgs(plan, hasAudio, outPath, filterScriptPath, opts = {}) {
  const { audioOnly = false, excludeTracks = [], overlayList } = opts;
  const { width: W, height: H, fps, crf } = plan.settings;
  const inputs = [];
  const filters = [];
  let inputCount = 0;
  const addInput = (args) => {
    inputs.push(...args);
    return inputCount++;
  };

  // 화면 비율이 달라도 잘리지 않게 맞추고 남는 부분은 검은 여백으로 채운다.
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p`;
  // 각 구간을 정확한 길이로 맞춰야 이어 붙여도 영상과 소리가 어긋나지 않는다.
  const exactVideo = (d) => `tpad=stop_mode=clone:stop_duration=1,trim=duration=${num(d)},setpts=PTS-STARTPTS`;
  const exactAudio = (d) => `apad,atrim=duration=${num(d)},asetpts=PTS-STARTPTS`;
  const silence = (d, label) => `anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=duration=${num(d)}[${label}]`;

  // 1) 메인 트랙: 클립을 순서대로 이어 붙인다. 빈 구간은 검은 화면 + 무음.
  //    segments: { i, d(길이), overlap(앞 구간과 겹치는 전환 길이), type(전환 종류) }
  const segments = [];
  const pushGap = (d) => {
    const i = segments.length;
    if (!audioOnly) filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${num(d)},format=yuv420p,setsar=1[v${i}]`);
    filters.push(silence(d, `a${i}`));
    segments.push({ i, d, overlap: 0 });
  };

  const mains = plan.clips.filter((c) => c.track === 'main').sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const c of mains) {
    if (c.start - cursor > 0.01) pushGap(c.start - cursor);
    const d = (c.out - c.in) / c.speed;
    const i = segments.length;
    if (c.kind === 'image') {
      if (!audioOnly) {
        const k = addInput(['-loop', '1', '-framerate', String(fps), '-t', num(d), '-i', c.path]);
        filters.push(`[${k}:v]${fit},${exactVideo(d)}[v${i}]`);
      }
      filters.push(silence(d, `a${i}`));
    } else {
      const withAudio = hasAudio.get(c.path) && !excludeTracks.includes('main');
      // 음성 인식용일 때는 소리가 있는 영상만 입력으로 넣는다 (영상 화면은 해석하지 않는다).
      const k = !audioOnly || withAudio ? addInput(['-i', c.path]) : -1;
      if (!audioOnly) {
        filters.push(
          `[${k}:v]trim=start=${num(c.in)}:end=${num(c.out)},setpts=(PTS-STARTPTS)/${num(c.speed)},${fit},${exactVideo(d)}[v${i}]`,
        );
      }
      if (withAudio) {
        const chain = [...atempoChain(c.speed), AUDIO_FORMAT, exactAudio(d), ...audioEffects(c, d)].join(',');
        filters.push(`[${k}:a]atrim=start=${num(c.in)}:end=${num(c.out)},asetpts=PTS-STARTPTS,${chain}[a${i}]`);
      } else {
        filters.push(silence(d, `a${i}`));
      }
    }
    const t = segments.length > 0 ? (c.transitionIn?.duration ?? 0) : 0;
    segments.push({ i, d, overlap: t, type: c.transitionIn?.type });
    cursor = c.start + d;
  }
  // 오디오 트랙이 메인 트랙보다 길면 끝에 검은 화면을 덧붙인다.
  if (plan.duration - cursor > 0.01) pushGap(plan.duration - cursor);

  // 구간을 하나씩 이어 붙인다. 전환이 있으면 xfade(화면)·acrossfade(소리)로 겹치고, 없으면 그냥 붙인다.
  let vLabel = `v${segments[0].i}`;
  let aLabel = `a${segments[0].i}`;
  let length = segments[0].d;
  segments.slice(1).forEach((s, k) => {
    const vNext = `vx${k}`;
    const aNext = `ax${k}`;
    if (s.overlap > 0) {
      if (!audioOnly) {
        filters.push(
          `[${vLabel}][v${s.i}]xfade=transition=${s.type}:duration=${num(s.overlap)}:offset=${num(length - s.overlap)}[${vNext}]`,
        );
      }
      filters.push(`[${aLabel}][a${s.i}]acrossfade=d=${num(s.overlap)}[${aNext}]`);
      length += s.d - s.overlap;
    } else {
      if (audioOnly) filters.push(`[${aLabel}][a${s.i}]concat=n=2:v=0:a=1[${aNext}]`);
      else filters.push(`[${vLabel}][${aLabel}][v${s.i}][a${s.i}]concat=n=2:v=1:a=1[${vNext}][${aNext}]`);
      length += s.d;
    }
    vLabel = vNext;
    aLabel = aNext;
  });
  filters.push(`[${aLabel}]anull[abase]`);

  if (!audioOnly) {
    filters.push(`[${vLabel}]null[vmain]`);
    if (overlayList) {
      // 그래픽 PNG 묶음을 시간에 맞춰 영상 위에 겹친다.
      const k = addInput(['-f', 'concat', '-safe', '0', '-i', overlayList]);
      filters.push(`[${k}:v]format=rgba,setpts=PTS-STARTPTS[subs]`);
      filters.push('[vmain][subs]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[vout]');
    } else {
      filters.push('[vmain]null[vout]');
    }
  }

  // 2) 배경음악·녹음 트랙: 각 클립을 시작 시각만큼 늦춘 뒤 메인 소리와 섞는다.
  const extra = [];
  plan.clips
    .filter((c) => c.track !== 'main' && !excludeTracks.includes(c.track) && hasAudio.get(c.path))
    .forEach((c, j) => {
      const k = addInput(['-i', c.path]);
      const d = (c.out - c.in) / c.speed;
      const chain = [...atempoChain(c.speed), AUDIO_FORMAT, ...audioEffects(c, d)].join(',');
      const delayMs = Math.round(c.start * 1000);
      filters.push(
        `[${k}:a]atrim=start=${num(c.in)}:end=${num(c.out)},asetpts=PTS-STARTPTS,${chain},adelay=${delayMs}:all=1[b${j}]`,
      );
      extra.push(`[b${j}]`);
    });

  let audioOut = 'abase';
  if (extra.length > 0) {
    filters.push(`[abase]${extra.join('')}amix=inputs=${extra.length + 1}:duration=first:normalize=0[aout]`);
    audioOut = 'aout';
  }

  fs.writeFileSync(filterScriptPath, filters.join(';\n'));

  const common = ['-y', '-hide_banner', ...inputs, '-filter_complex_script', filterScriptPath];
  const progress = ['-progress', 'pipe:1', '-nostats'];
  if (audioOnly) {
    // whisper.cpp는 16kHz 모노 WAV를 받는다.
    return [...common, '-map', `[${audioOut}]`, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', ...progress, outPath];
  }
  return [
    ...common,
    '-map', '[vout]',
    '-map', `[${audioOut}]`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', String(SAMPLE_RATE),
    '-movflags', '+faststart',
    ...progress,
    outPath,
  ];
}

/** ffconcat 목록의 file 줄. 작은따옴표는 '\'' 로 바꿔 넣는다. */
function concatEntry(filePath) {
  const escaped = filePath.replace(/\\/g, '/').split("'").join("'\\''");
  return `file '${escaped}'`;
}

/**
 * 그래픽 PNG들을 임시 폴더에 쓰고 시간 순서대로 이어 붙이는 ffconcat 목록을 만든다.
 * @param subs [{start, end, png: Uint8Array}] 시작 순 정렬
 * @param blankPng 그래픽이 없는 구간에 쓸 투명 PNG
 */
function writeOverlayList(dir, subs, blankPng) {
  fs.mkdirSync(dir, { recursive: true });
  const blank = path.join(dir, 'blank.png');
  fs.writeFileSync(blank, blankPng);
  const lines = ['ffconcat version 1.0'];
  let cursor = 0;
  subs.forEach((s, i) => {
    const start = Math.max(s.start, cursor);
    if (s.end - start < 0.01) return;
    if (start - cursor > 0.001) lines.push(concatEntry(blank), `duration ${num(start - cursor)}`);
    const file = path.join(dir, `sub${i}.png`);
    fs.writeFileSync(file, s.png);
    lines.push(concatEntry(file), `duration ${num(s.end - start)}`);
    cursor = s.end;
  });
  // 마지막 항목의 길이가 무시되지 않도록 빈 화면을 하나 덧붙인다.
  lines.push(concatEntry(blank), 'duration 1');
  const listPath = path.join(dir, 'list.txt');
  fs.writeFileSync(listPath, lines.join('\n') + '\n');
  return listPath;
}

/** 녹음(WebM)을 위치 이동이 정확한 WAV로 바꾼다. */
function transcodeToWav(input, output) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-y', '-hide_banner', '-v', 'error', '-i', input, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', output]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg 종료 코드 ${code}`))));
  });
}

/** FFmpeg를 실행한다. 진행률은 duration(초) 기준 0~1로 알린다. 돌려준 kill()로 멈출 수 있다. */
function spawnFfmpeg(args, duration, onProgress) {
  const proc = spawn(ffmpegPath, args);
  let killed = false;
  const promise = new Promise((resolve, reject) => {
    let stderrTail = '';
    proc.stdout.on('data', (chunk) => {
      const m = /out_time_us=(\d+)/.exec(String(chunk));
      if (m && duration > 0) onProgress?.(Math.min(1, Number(m[1]) / 1e6 / duration));
    });
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
    });
    const fail = (message) => {
      const e = new Error(killed ? '취소되었습니다.' : message);
      e.canceled = killed;
      reject(e);
    };
    proc.on('error', (e) => fail(`FFmpeg를 실행하지 못했습니다: ${e.message}`));
    proc.on('close', (code) => (code === 0 ? resolve() : fail(stderrTail.trim().split('\n').slice(-8).join('\n'))));
  });
  return {
    promise,
    kill() {
      killed = true;
      proc.kill();
    },
  };
}

async function probeAll(plan) {
  const paths = [...new Set(plan.clips.map((c) => c.path))];
  return new Map(await Promise.all(paths.map(async (p) => [p, await probeHasAudio(p)])));
}

const tempPath = (name) => path.join(os.tmpdir(), `video-editor-${name}-${process.pid}-${Date.now()}`);

let current = null;

/**
 * 내보내기를 실행한다. onProgress(0~1)
 * plan.overlays: [{start, end, png}] / plan.overlayBlank: 투명 PNG — 있으면 영상 위에 그래픽(텍스트·자막)을 겹친다.
 */
async function runExport(plan, outPath, onProgress) {
  if (current) throw new Error('이미 내보내기가 진행 중입니다.');
  const job = { kill: () => {}, canceled: false };
  current = job;

  const filterScriptPath = tempPath('filter') + '.txt';
  const overlayDir = tempPath('overlay');
  try {
    const hasAudio = await probeAll(plan);
    const overlayList =
      plan.overlays?.length > 0 ? writeOverlayList(overlayDir, plan.overlays, plan.overlayBlank) : undefined;
    const args = buildFfmpegArgs(plan, hasAudio, outPath, filterScriptPath, { overlayList });
    if (job.canceled) throw Object.assign(new Error('취소되었습니다.'), { canceled: true });
    const ffmpeg = spawnFfmpeg(args, plan.duration, onProgress);
    job.kill = ffmpeg.kill;
    await ffmpeg.promise;
    onProgress(1);
  } catch (e) {
    fs.rm(outPath, { force: true }, () => {});
    throw e;
  } finally {
    current = null;
    fs.rm(filterScriptPath, { force: true }, () => {});
    fs.rm(overlayDir, { recursive: true, force: true }, () => {});
  }
}

function cancelExport() {
  if (!current) return;
  current.canceled = true;
  current.kill();
}

/**
 * 음성 인식용으로 타임라인 소리를 16kHz 모노 WAV로 뽑는다. (배경음악 트랙은 빼서 말소리만 남긴다)
 * @returns { promise, kill }
 */
async function renderSpeechAudio(plan, outWav, onProgress) {
  const hasAudio = await probeAll(plan);
  const filterScriptPath = tempPath('speech-filter') + '.txt';
  const args = buildFfmpegArgs(plan, hasAudio, outWav, filterScriptPath, { audioOnly: true, excludeTracks: ['audio'] });
  const ffmpeg = spawnFfmpeg(args, plan.duration, onProgress);
  return {
    promise: ffmpeg.promise.finally(() => fs.rm(filterScriptPath, { force: true }, () => {})),
    kill: ffmpeg.kill,
  };
}

module.exports = {
  runExport,
  cancelExport,
  renderSpeechAudio,
  transcodeToWav,
  buildFfmpegArgs,
  atempoChain,
  ffmpegPath,
};
