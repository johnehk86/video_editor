import type { MediaItem, MediaKind, Project, TrackId, TransitionType } from '../types';
import { effectiveFades, projectDuration, transitionWindows } from '../state/project';
import { toSrt } from './subtitles';
import { blankPng, renderOverlaySegments, type OverlaySegment } from './graphics';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  /** x264 화질 값. 낮을수록 고화질·대용량 */
  crf: number;
}

export interface ExportClip {
  path: string;
  kind: MediaKind;
  track: TrackId;
  start: number;
  in: number;
  out: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** 메인 트랙에서 앞 클립과 겹치는 전환 (실제로 적용되는 길이) */
  transitionIn?: { type: TransitionType; duration: number };
}

/** electron/exporter.cjs 가 받는 형식 */
export interface ExportPlan {
  settings: ExportSettings;
  duration: number;
  clips: ExportClip[];
  /** 영상 위에 겹칠 그래픽(텍스트 레이어·자막). 구간마다 영상 크기의 투명 PNG */
  overlays?: OverlaySegment[];
  /** 그래픽이 없는 구간에 쓸 투명 PNG */
  overlayBlank?: Uint8Array;
  /** 있으면 MP4 옆에 같은 이름의 .srt 로 저장 */
  srt?: string;
}

export type ExportResult = { status: 'done'; path: string } | { status: 'canceled' } | { status: 'error'; message: string };

export const RESOLUTION_PRESETS = [
  { id: '1080p', label: '1080p 가로 (유튜브 권장)', width: 1920, height: 1080 },
  { id: '720p', label: '720p 가로', width: 1280, height: 720 },
  { id: '4k', label: '4K 가로', width: 3840, height: 2160 },
  { id: 'shorts', label: '1080×1920 세로 (쇼츠)', width: 1080, height: 1920 },
] as const;

export const QUALITY_PRESETS = [
  { id: 'high', label: '높음', crf: 18 },
  { id: 'normal', label: '보통', crf: 21 },
  { id: 'small', label: '작은 용량', crf: 25 },
] as const;

export const FPS_OPTIONS = [24, 30, 60] as const;

export function buildExportPlan(project: Project, media: Map<string, MediaItem>, settings: ExportSettings): ExportPlan {
  const transitions = transitionWindows(project);
  const clips = project.clips.map((c): ExportClip => {
    const m = media.get(c.mediaId);
    if (!m?.path || m.missing) {
      throw new Error(`'${m?.name ?? c.mediaId}' 파일을 찾을 수 없어요. 미디어 탭에서 ⚠ 표시된 파일을 눌러 다시 연결해 주세요.`);
    }
    return {
      path: m.path,
      kind: m.kind,
      track: c.track,
      start: c.start,
      in: c.in,
      out: c.out,
      speed: c.speed,
      volume: c.volume,
      ...effectiveFades(c),
      transitionIn: transitions.get(c.id)?.in,
    };
  });
  return { settings, duration: projectDuration(project), clips };
}

/**
 * 텍스트 레이어와 (burnSubtitles 면) 자막을 영상 크기의 PNG 구간들로 그려 계획에 붙인다.
 * srt 면 자막을 SRT 글로도 붙인다. onProgress(0~1)
 */
export async function attachOverlays(
  plan: ExportPlan,
  project: Project,
  options: { burnSubtitles: boolean; srt: boolean },
  onProgress: (p: number) => void,
): Promise<ExportPlan> {
  const next = { ...plan };
  const subs = project.subtitles
    .filter((s) => s.text.trim() && s.start < plan.duration)
    .map((s) => ({ ...s, end: Math.min(s.end, plan.duration) }));
  if (options.srt && subs.length > 0) next.srt = toSrt(subs);

  const { width, height, fps } = plan.settings;
  const overlays = await renderOverlaySegments(
    project,
    plan.duration,
    { width, height, fps },
    { subtitles: options.burnSubtitles },
    onProgress,
  );
  if (overlays.length > 0) {
    next.overlays = overlays;
    next.overlayBlank = await blankPng(width, height);
  }
  return next;
}
