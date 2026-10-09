export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  /** 미리보기용 blob URL */
  url: string;
  /** 디스크 상의 실제 경로 (FFmpeg 내보내기에서 사용) */
  path: string;
  /** 초 단위 길이. 이미지는 undefined */
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  /** 음파 모양 (초당 PEAKS_PER_SECOND개, 0~1) */
  peaks?: Float32Array;
  /** 프로젝트를 열었는데 원본 파일을 찾지 못함 → 다시 연결이 필요 */
  missing?: boolean;
}

/** main: 영상·이미지가 빈틈없이 이어지는 트랙, audio: 배경음악, voice: 녹음(내레이션). audio·voice는 자유 배치 */
export type TrackId = 'main' | 'audio' | 'voice';

export interface Clip {
  id: string;
  mediaId: string;
  track: TrackId;
  /** 타임라인 상의 시작 시각(초) */
  start: number;
  /** 원본 미디어에서 사용할 구간(초) */
  in: number;
  out: number;
  /** 재생 배속 (1 = 원래 속도) */
  speed: number;
  /** 소리 크기 (1 = 100%, 최대 2) */
  volume: number;
  /** 소리가 서서히 커지고/작아지는 시간(초, 타임라인 기준) */
  fadeIn: number;
  fadeOut: number;
  /** 메인 트랙에서 바로 앞 클립과 이어지는 전환 효과 (첫 클립에서는 쓰이지 않음) */
  transition?: Transition;
}

/** FFmpeg xfade 의 전환 이름을 그대로 쓴다 */
export type TransitionType =
  | 'fade'
  | 'fadeblack'
  | 'fadewhite'
  | 'slideleft'
  | 'slideright'
  | 'wipeleft'
  | 'wiperight'
  | 'circleopen';

export interface Transition {
  type: TransitionType;
  /** 두 클립이 겹치는 시간(초) */
  duration: number;
}

export interface Subtitle {
  id: string;
  /** 타임라인 시각(초) */
  start: number;
  end: number;
  text: string;
}

export type SubtitlePosition = 'bottom' | 'middle' | 'top';

/** 모든 자막에 함께 적용되는 모양 */
export interface SubtitleStyle {
  /** 글자 크기 (영상 높이의 %) */
  fontSize: number;
  color: string;
  position: SubtitlePosition;
  /** 반투명 검은 상자 */
  background: boolean;
  /** 검은 외곽선 */
  outline: boolean;
  bold: boolean;
}

export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide';

/** 화면 위 원하는 위치·시간에 띄우는 글자 (제목, 강조 문구 등) */
export interface TextLayer {
  id: string;
  start: number;
  end: number;
  /** 줄바꿈(\n) 가능 */
  text: string;
  /** 글자 덩어리 가운데의 위치 (화면 너비·높이에 대한 0~1) */
  x: number;
  y: number;
  /** utils/graphics.ts 의 FONTS id */
  font: string;
  /** 글자 크기 (영상 높이의 %) */
  fontSize: number;
  color: string;
  bold: boolean;
  outline: boolean;
  background: boolean;
  animIn: TextAnimation;
  animOut: TextAnimation;
}

export interface Project {
  /** 메인 트랙 클립은 배열 순서가 곧 재생 순서 */
  clips: Clip[];
  /** 시작 시각 순으로 정렬 */
  subtitles: Subtitle[];
  subtitleStyle: SubtitleStyle;
  /** 시작 시각 순으로 정렬. 뒤에 있을수록 위에 그린다 */
  texts: TextLayer[];
}

/** transition 의 id 는 전환이 들어오는(뒤) 클립의 id */
export type Selection = { type: 'media' | 'clip' | 'subtitle' | 'transition' | 'text'; id: string } | null;
