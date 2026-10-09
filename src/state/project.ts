import type {
  Clip,
  MediaItem,
  Project,
  Subtitle,
  SubtitleStyle,
  TextLayer,
  TrackId,
  Transition,
  TransitionType,
} from '../types';

export const IMAGE_DEFAULT_DURATION = 3;
export const MIN_CLIP_DURATION = 0.1;
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
export const MAX_VOLUME = 2;
export const MIN_SUBTITLE_DURATION = 0.2;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 5.5,
  color: '#ffffff',
  position: 'bottom',
  background: false,
  outline: true,
  bold: true,
};

export const clipDuration = (c: Clip) => (c.out - c.in) / c.speed;
export const clipEnd = (c: Clip) => c.start + clipDuration(c);
export const trackForMedia = (m: MediaItem): TrackId => (m.kind === 'audio' ? 'audio' : 'main');
/** 원본에서 쓸 수 있는 최대 시각. 이미지는 무제한 */
export const mediaLimit = (m: MediaItem | undefined) => (m && m.kind !== 'image' && m.duration ? m.duration : Infinity);
export const projectDuration = (p: Project) => p.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
/** 메인(영상) 트랙이 끝나는 시각 */
export const mainTrackEnd = (p: Project) => p.clips.reduce((t, c) => (c.track === 'main' ? Math.max(t, clipEnd(c)) : t), 0);

/** 클립 길이를 넘지 않도록 줄인 실제 페이드 길이 */
export function effectiveFades(c: Clip) {
  const d = clipDuration(c);
  const fadeIn = Math.min(c.fadeIn, d);
  return { fadeIn, fadeOut: Math.min(c.fadeOut, d - fadeIn) };
}

/** 타임라인 시각 t에서 페이드를 반영한 소리 배율 (0~1) */
export function fadeGain(c: Clip, t: number) {
  const { fadeIn, fadeOut } = effectiveFades(c);
  const sinceStart = t - c.start;
  const untilEnd = clipEnd(c) - t;
  let g = 1;
  if (fadeIn > 0) g = Math.min(g, sinceStart / fadeIn);
  if (fadeOut > 0) g = Math.min(g, untilEnd / fadeOut);
  return Math.max(0, Math.min(1, g));
}

export type ProjectAction =
  | { type: 'add'; clipId: string; media: MediaItem; start?: number; index?: number; track?: TrackId }
  | { type: 'remove'; clipId: string }
  | { type: 'split'; clipId: string; newClipId: string; time: number }
  | { type: 'trim'; clipId: string; in: number; out: number; start: number }
  | { type: 'reorder'; clipId: string; index: number }
  | { type: 'move'; clipId: string; start: number }
  | { type: 'setSpeed'; clipId: string; speed: number }
  | { type: 'setAudio'; clipId: string; volume?: number; fadeIn?: number; fadeOut?: number }
  /** 오디오 클립을 영상(메인 트랙) 끝에 맞춘다. trim: 자르기/늘리기, loop: 반복해서 채우기 */
  | { type: 'fitToVideo'; clipId: string; mode: 'trim' | 'loop'; sourceLimit: number; idPrefix: string }
  /** 자동 자막·SRT 가져오기로 자막 전체를 바꾼다 */
  /** live: 자동 자막이 실시간으로 채워지는 중 — 연달아 오는 변경을 실행취소 기록 하나로 묶는다 */
  | { type: 'setSubtitles'; subtitles: Subtitle[]; live?: boolean }
  | { type: 'addSubtitle'; subtitle: Subtitle }
  | { type: 'updateSubtitle'; id: string; text?: string; start?: number; end?: number }
  | { type: 'removeSubtitle'; id: string }
  | { type: 'setSubtitleStyle'; patch: Partial<SubtitleStyle> }
  /** 클립과 그 앞 클립 사이의 전환. null 이면 없앤다 */
  | { type: 'setTransition'; clipId: string; transition: Transition | null }
  /** 메인 트랙의 모든 클립 사이에 같은 전환을 넣는다 (null 이면 모두 없앤다) */
  | { type: 'setAllTransitions'; transition: Transition | null }
  | { type: 'addText'; layer: TextLayer }
  | { type: 'updateText'; id: string; patch: Partial<Omit<TextLayer, 'id'>> }
  | { type: 'removeText'; id: string };

/**
 * 전환으로 두 클립이 실제로 겹치는 시간.
 * 한 클립 안에서 들어오는·나가는 전환이 겹치지 않도록 각 클립 길이의 절반을 넘지 않게 한다.
 */
export function transitionOverlap(prev: Clip | undefined, cur: Clip) {
  if (!prev || !cur.transition) return 0;
  return Math.max(0, Math.min(cur.transition.duration, clipDuration(prev) / 2, clipDuration(cur) / 2));
}

/** 메인 트랙 클립을 이어 붙인다 (CapCut의 자석 트랙 방식). 전환이 있으면 그만큼 겹친다. */
function layout(clips: Clip[]): Clip[] {
  let t = 0;
  let prev: Clip | undefined;
  return clips.map((c) => {
    if (c.track !== 'main') return c;
    const start = Math.max(0, t - transitionOverlap(prev, c));
    const placed = c.start === start ? c : { ...c, start };
    t = start + clipDuration(c);
    prev = c;
    return placed;
  });
}

export interface TransitionWindow {
  type: TransitionType;
  /** 전환이 시작되는 타임라인 시각 (= 들어오는 클립의 시작) */
  start: number;
  duration: number;
}

/** 클립마다 들어오는(in)·나가는(out) 전환 구간. 미리보기와 내보내기에서 쓴다. */
export function transitionWindows(p: Project) {
  const map = new Map<string, { in?: TransitionWindow; out?: TransitionWindow }>();
  let prev: Clip | undefined;
  for (const c of p.clips) {
    if (c.track !== 'main') continue;
    const overlap = transitionOverlap(prev, c);
    if (prev && c.transition && overlap > 0) {
      const w = { type: c.transition.type, start: c.start, duration: overlap };
      map.set(c.id, { ...map.get(c.id), in: w });
      map.set(prev.id, { ...map.get(prev.id), out: w });
    }
    prev = c;
  }
  return map;
}

function splitTracks(clips: Clip[]) {
  return {
    mains: clips.filter((c) => c.track === 'main'),
    others: clips.filter((c) => c.track !== 'main'),
  };
}

export function applyAction(p: Project, a: ProjectAction): Project {
  const clips = p.clips;
  switch (a.type) {
    case 'add': {
      // 오디오는 배경음악/녹음 트랙 중 고를 수 있고, 영상·이미지는 항상 메인 트랙
      const track = a.media.kind === 'audio' && a.track === 'voice' ? 'voice' : trackForMedia(a.media);
      const out = a.media.kind === 'image' ? IMAGE_DEFAULT_DURATION : (a.media.duration ?? IMAGE_DEFAULT_DURATION);
      const clip: Clip = {
        id: a.clipId,
        mediaId: a.media.id,
        track,
        start: Math.max(0, a.start ?? 0),
        in: 0,
        out,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      };
      if (track !== 'main') return { ...p, clips: [...clips, clip] };
      const { mains, others } = splitTracks(clips);
      mains.splice(a.index ?? mains.length, 0, clip);
      return { ...p, clips: layout([...mains, ...others]) };
    }
    case 'remove':
      return { ...p, clips: layout(clips.filter((c) => c.id !== a.clipId)) };
    case 'split': {
      const i = clips.findIndex((c) => c.id === a.clipId);
      if (i < 0) return p;
      const c = clips[i];
      if (a.time - c.start < MIN_CLIP_DURATION || clipEnd(c) - a.time < MIN_CLIP_DURATION) return p;
      const cut = c.in + (a.time - c.start) * c.speed;
      const next = [...clips];
      // 페이드 인은 앞 조각에, 페이드 아웃은 뒤 조각에 남긴다.
      // 앞 클립과의 전환은 앞 조각에만 남는다. (자른 자리는 그냥 이어진다)
      next.splice(
        i,
        1,
        { ...c, out: cut, fadeOut: 0 },
        { ...c, id: a.newClipId, in: cut, start: a.time, fadeIn: 0, transition: undefined },
      );
      return { ...p, clips: layout(next) };
    }
    case 'trim':
      return {
        ...p,
        clips: layout(clips.map((c) => (c.id === a.clipId ? { ...c, in: a.in, out: a.out, start: a.start } : c))),
      };
    case 'reorder': {
      const { mains, others } = splitTracks(clips);
      const from = mains.findIndex((c) => c.id === a.clipId);
      if (from < 0 || from === a.index) return p;
      const [moved] = mains.splice(from, 1);
      mains.splice(a.index, 0, moved);
      return { ...p, clips: layout([...mains, ...others]) };
    }
    case 'move':
      return { ...p, clips: clips.map((c) => (c.id === a.clipId ? { ...c, start: Math.max(0, a.start) } : c)) };
    case 'setSpeed': {
      const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, a.speed));
      // 메인 트랙은 길이가 바뀌면 뒤 클립이 따라 움직이고, 오디오 트랙은 시작 위치를 유지한다.
      return { ...p, clips: layout(clips.map((c) => (c.id === a.clipId ? { ...c, speed } : c))) };
    }
    case 'setAudio': {
      const patch: Partial<Clip> = {};
      if (a.volume !== undefined) patch.volume = Math.min(MAX_VOLUME, Math.max(0, a.volume));
      if (a.fadeIn !== undefined) patch.fadeIn = Math.max(0, a.fadeIn);
      if (a.fadeOut !== undefined) patch.fadeOut = Math.max(0, a.fadeOut);
      return { ...p, clips: clips.map((c) => (c.id === a.clipId ? { ...c, ...patch } : c)) };
    }
    case 'fitToVideo':
      return fitToVideo(p, a);
    case 'setSubtitles':
      return { ...p, subtitles: sortByStart(a.subtitles.map(normalizeTimed)) };
    case 'addSubtitle':
      return { ...p, subtitles: sortByStart([...p.subtitles, normalizeTimed(a.subtitle)]) };
    case 'updateSubtitle': {
      const { type: _t, id, ...patch } = a;
      return {
        ...p,
        subtitles: sortByStart(p.subtitles.map((s) => (s.id === id ? normalizeTimed({ ...s, ...patch }) : s))),
      };
    }
    case 'removeSubtitle':
      return { ...p, subtitles: p.subtitles.filter((s) => s.id !== a.id) };
    case 'setSubtitleStyle':
      return { ...p, subtitleStyle: { ...p.subtitleStyle, ...a.patch } };
    case 'setTransition':
      return {
        ...p,
        clips: layout(clips.map((c) => (c.id === a.clipId ? { ...c, transition: a.transition ?? undefined } : c))),
      };
    case 'setAllTransitions': {
      const firstMain = clips.find((c) => c.track === 'main');
      return {
        ...p,
        clips: layout(
          clips.map((c) =>
            c.track === 'main' && c !== firstMain ? { ...c, transition: a.transition ?? undefined } : c,
          ),
        ),
      };
    }
    case 'addText':
      return { ...p, texts: sortByStart([...p.texts, normalizeTimed(a.layer)]) };
    case 'updateText':
      return {
        ...p,
        texts: sortByStart(p.texts.map((t) => (t.id === a.id ? normalizeTimed({ ...t, ...a.patch }) : t))),
      };
    case 'removeText':
      return { ...p, texts: p.texts.filter((t) => t.id !== a.id) };
  }
}

/** 시작은 0 이상, 끝은 시작보다 최소 길이만큼 뒤 */
function normalizeTimed<T extends { start: number; end: number }>(item: T): T {
  const start = Math.max(0, item.start);
  return { ...item, start, end: Math.max(start + MIN_SUBTITLE_DURATION, item.end) };
}

const sortByStart = <T extends { start: number }>(items: T[]) => [...items].sort((a, b) => a.start - b.start);

/** 새 텍스트 레이어 기본값: 화면 가운데, 3초 */
export function createTextLayer(id: string, start: number): TextLayer {
  return {
    id,
    start,
    end: start + 3,
    text: '텍스트를 입력하세요',
    x: 0.5,
    y: 0.5,
    font: 'malgun',
    fontSize: 9,
    color: '#ffffff',
    bold: true,
    outline: true,
    background: false,
    animIn: 'pop',
    animOut: 'fade',
  };
}

/** 시각 t에 보여야 하는 자막 */
export const subtitleAt = (p: Project, t: number) => p.subtitles.find((s) => t >= s.start && t < s.end);

function fitToVideo(p: Project, a: Extract<ProjectAction, { type: 'fitToVideo' }>): Project {
  const i = p.clips.findIndex((c) => c.id === a.clipId);
  const c = p.clips[i];
  const end = mainTrackEnd(p);
  if (!c || c.track === 'main' || end - c.start < MIN_CLIP_DURATION) return p;
  const target = end - c.start;

  if (a.mode === 'trim') {
    const out = Math.min(a.sourceLimit, c.in + target * c.speed);
    const next = [...p.clips];
    next[i] = { ...c, out };
    return { ...p, clips: next };
  }

  // 반복: 지금 잘라 둔 구간을 한 단위로 영상 끝까지 이어 붙이고, 마지막 조각은 남는 만큼만 쓴다.
  const unit = clipDuration(c);
  const pieces: Clip[] = [];
  let t = c.start;
  let n = 0;
  while (end - t >= MIN_CLIP_DURATION) {
    const len = Math.min(unit, end - t);
    pieces.push({ ...c, id: n === 0 ? c.id : `${a.idPrefix}-${n}`, start: t, out: c.in + len * c.speed, fadeIn: 0, fadeOut: 0 });
    t += len;
    n++;
  }
  pieces[0].fadeIn = c.fadeIn;
  pieces[pieces.length - 1].fadeOut = c.fadeOut;
  const next = [...p.clips];
  next.splice(i, 1, ...pieces);
  return { ...p, clips: next };
}

function removeMediaFromProject(p: Project, mediaId: string): Project {
  const clips = p.clips.filter((c) => c.mediaId !== mediaId);
  return clips.length === p.clips.length ? p : { ...p, clips: layout(clips) };
}

/* ---------- 실행취소 / 다시실행 ---------- */

/** 슬라이더·글자 입력처럼 연달아 오는 변경을 기록 하나로 묶기 위한 키 */
function mergeKeyFor(a: ProjectAction): string | undefined {
  switch (a.type) {
    case 'setSpeed':
      return `speed:${a.clipId}`;
    case 'setAudio':
      return `audio:${a.clipId}:${Object.keys(a).join()}`;
    case 'updateSubtitle':
      return `sub:${a.id}:${Object.keys(a).join()}`;
    case 'setSubtitleStyle':
      return `substyle:${Object.keys(a.patch).join()}`;
    case 'updateText':
      return `text:${a.id}:${Object.keys(a.patch).join()}`;
    case 'setSubtitles':
      return a.live ? 'auto-subtitles' : undefined;
    case 'setTransition':
      // 길이 슬라이더를 끄는 동안의 변경을 하나로 묶는다. (종류를 바꾸면 새 기록)
      return a.transition ? `trans:${a.clipId}:${a.transition.type}` : undefined;
    default:
      return undefined;
  }
}

export interface History {
  past: Project[];
  present: Project;
  future: Project[];
  /** 연속된 같은 종류의 변경(슬라이더 조절 등)을 기록 하나로 합치기 위한 키 */
  mergeKey?: string;
}

export type HistoryAction =
  | ProjectAction
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'removeMedia'; mediaId: string }
  /** 슬라이더에서 손을 뗐을 때: 이후 변경은 새 기록으로 남긴다 */
  | { type: 'endMerge' }
  /** 프로젝트 열기·새로 만들기: 실행취소 기록을 비우고 통째로 바꾼다 */
  | { type: 'load'; project: Project };

const HISTORY_LIMIT = 100;

export const initialHistory: History = {
  past: [],
  present: { clips: [], subtitles: [], subtitleStyle: DEFAULT_SUBTITLE_STYLE, texts: [] },
  future: [],
};

export function historyReducer(h: History, a: HistoryAction): History {
  switch (a.type) {
    case 'undo':
      if (h.past.length === 0) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    case 'redo':
      if (h.future.length === 0) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    case 'load':
      return { past: [], present: a.project, future: [] };
    case 'endMerge':
      return h.mergeKey ? { ...h, mergeKey: undefined } : h;
    case 'removeMedia': {
      // 미디어 파일이 사라지면 되돌리기 기록 속 클립도 함께 지운다.
      const strip = (p: Project) => removeMediaFromProject(p, a.mediaId);
      return { past: h.past.map(strip), present: strip(h.present), future: h.future.map(strip) };
    }
    default: {
      const next = applyAction(h.present, a);
      if (next === h.present) return h;
      const mergeKey = mergeKeyFor(a);
      if (mergeKey && mergeKey === h.mergeKey) return { ...h, present: next, future: [] };
      return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], mergeKey };
    }
  }
}
