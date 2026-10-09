import type {
  Clip,
  MediaItem,
  MediaKind,
  Project,
  Subtitle,
  TextAnimation,
  TextLayer,
  Transition,
  TransitionType,
} from '../types';
import { createTextLayer, DEFAULT_SUBTITLE_STYLE } from './project';

const TEXT_ANIMATIONS: TextAnimation[] = ['none', 'fade', 'pop', 'slide'];

/*
 * 프로젝트 파일(.vproj) 형식. 영상 자체는 넣지 않고 원본 파일 경로와 편집 내용만 저장한다.
 * (상대 경로 relPath 는 저장할 때 electron/projectFiles.cjs 가 붙인다)
 */

export const PROJECT_FILE_VERSION = 1;

export interface SavedMedia {
  id: string;
  name: string;
  kind: MediaKind;
  path: string;
  duration?: number;
  width?: number;
  height?: number;
  /** 영상 썸네일 (data URL). 열 때 다시 만들지 않아도 되도록 저장해 둔다 */
  thumbnail?: string;
}

export interface ProjectFileData {
  app: 'video-editor';
  version: number;
  savedAt: string;
  media: SavedMedia[];
  project: Project;
}

/** 열기 결과: 메인 프로세스가 파일을 찾았는지(missing)와 크기를 붙여 준다 */
export interface OpenedMedia extends SavedMedia {
  missing: boolean;
  size: number;
}

export function serializeProject(project: Project, media: MediaItem[]): ProjectFileData {
  return {
    app: 'video-editor',
    version: PROJECT_FILE_VERSION,
    savedAt: new Date().toISOString(),
    media: media.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      path: m.path,
      duration: m.duration,
      width: m.width,
      height: m.height,
      thumbnail: m.thumbnail?.startsWith('data:') ? m.thumbnail : undefined,
    })),
    project,
  };
}

/** 저장 안 한 변경이 있는지 비교하는 용도. 음파·썸네일처럼 파일에서 다시 만드는 값은 뺀다. */
export function projectSnapshot(project: Project, media: MediaItem[]): string {
  return JSON.stringify({ project, media: media.map((m) => [m.id, m.name, m.path]) });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

class ProjectFileError extends Error {}

const TRANSITION_TYPES: TransitionType[] = [
  'fade',
  'fadeblack',
  'fadewhite',
  'slideleft',
  'slideright',
  'wipeleft',
  'wiperight',
  'circleopen',
];

function parseTransition(v: unknown): Transition | undefined {
  if (!isObject(v) || !TRANSITION_TYPES.includes(v.type as TransitionType)) return undefined;
  const duration = num(v.duration, 0);
  return duration > 0 ? { type: v.type as TransitionType, duration } : undefined;
}

/** 열어 온 JSON을 검사하고, 예전 버전에 없던 값은 기본값으로 채운다. */
export function parseProjectFile(data: unknown): { project: Project; media: OpenedMedia[] } {
  if (!isObject(data) || data.app !== 'video-editor' || !isObject(data.project)) {
    throw new ProjectFileError('영상 편집기 프로젝트 파일이 아니에요.');
  }
  if (num(data.version, 0) > PROJECT_FILE_VERSION) {
    throw new ProjectFileError('더 새로운 버전의 편집기에서 저장한 프로젝트예요. 편집기를 업데이트해 주세요.');
  }

  const media = (Array.isArray(data.media) ? data.media : []).filter(isObject).map(
    (m): OpenedMedia => ({
      id: String(m.id),
      name: String(m.name ?? ''),
      kind: m.kind === 'audio' || m.kind === 'image' ? m.kind : 'video',
      path: String(m.path ?? ''),
      duration: typeof m.duration === 'number' ? m.duration : undefined,
      width: typeof m.width === 'number' ? m.width : undefined,
      height: typeof m.height === 'number' ? m.height : undefined,
      thumbnail: typeof m.thumbnail === 'string' ? m.thumbnail : undefined,
      missing: m.missing === true,
      size: num(m.size, 0),
    }),
  );
  const mediaIds = new Set(media.map((m) => m.id));

  const p = data.project;
  const clips = (Array.isArray(p.clips) ? p.clips : [])
    .filter(isObject)
    .filter((c) => mediaIds.has(String(c.mediaId)))
    .map(
      (c): Clip => ({
        id: String(c.id),
        mediaId: String(c.mediaId),
        track: c.track === 'audio' || c.track === 'voice' ? c.track : 'main',
        start: num(c.start, 0),
        in: num(c.in, 0),
        out: num(c.out, 0),
        speed: num(c.speed, 1),
        volume: num(c.volume, 1),
        fadeIn: num(c.fadeIn, 0),
        fadeOut: num(c.fadeOut, 0),
        transition: parseTransition(c.transition),
      }),
    );
  const subtitles = (Array.isArray(p.subtitles) ? p.subtitles : []).filter(isObject).map(
    (s): Subtitle => ({ id: String(s.id), start: num(s.start, 0), end: num(s.end, 0), text: String(s.text ?? '') }),
  );
  const subtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, ...(isObject(p.subtitleStyle) ? p.subtitleStyle : {}) };
  const texts = (Array.isArray(p.texts) ? p.texts : []).filter(isObject).map((t): TextLayer => {
    const base = createTextLayer(String(t.id), num(t.start, 0));
    const anim = (v: unknown) => (TEXT_ANIMATIONS.includes(v as TextAnimation) ? (v as TextAnimation) : 'none');
    return {
      ...base,
      end: num(t.end, base.end),
      text: String(t.text ?? ''),
      x: num(t.x, base.x),
      y: num(t.y, base.y),
      font: typeof t.font === 'string' ? t.font : base.font,
      fontSize: num(t.fontSize, base.fontSize),
      color: typeof t.color === 'string' ? t.color : base.color,
      bold: t.bold !== false,
      outline: t.outline !== false,
      background: t.background === true,
      animIn: anim(t.animIn),
      animOut: anim(t.animOut),
    };
  });

  return { project: { clips, subtitles, subtitleStyle, texts }, media };
}
