/** 자동 자막 설정 (다음 실행 때도 기억한다) */

export type SttModel = 'base' | 'small' | 'turbo';
export type SttStep = 'engine' | 'model' | 'audio' | 'recognize';

export interface AutoSubtitleSettings {
  model: SttModel;
  language: string;
  /** 빈 프로젝트에 영상을 넣으면 바로 자막 만들기 */
  autoOnImport: boolean;
  /** 사용자가 한 번이라도 설정을 고르고 시작했는지 (처음에는 설정 창을 먼저 보여 준다) */
  chosen: boolean;
}

/*
 * 속도 추정. GPU 없는 노트북(i7-1185G7)에서 2분 28초 한국어 음성으로 잰 "실제 시간 대비 배속"
 * (압축 모델 + 단순 탐색 기준). 인식에 쓰는 스레드 수(코어−1, 최대 8)에 따라 사이를 이어 붙인다.
 */
const MEASURED_SPEED: Record<SttModel, { threads2: number; threads7: number }> = {
  base: { threads2: 8.3, threads7: 12.5 },
  small: { threads2: 2.2, threads7: 4.0 },
  turbo: { threads2: 0.5, threads7: 1.1 },
};

/** 메인 프로세스(transcriber.cjs)와 같은 규칙으로 정한 인식 스레드 수 */
const recognitionThreads = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

/** 이 PC에서 10분짜리 영상의 자막을 만드는 데 걸릴 대략적인 시간(분) */
export function estimateMinutesFor10Min(model: SttModel) {
  const { threads2, threads7 } = MEASURED_SPEED[model];
  const t = Math.min(Math.max(recognitionThreads(), 2), 7);
  const speed = threads2 + ((threads7 - threads2) * (t - 2)) / 5;
  return 10 / speed;
}

/** 코어가 적은 노트북에는 빠른 모델을 권한다 */
export const recommendedModel = (): SttModel => (recognitionThreads() <= 3 ? 'base' : 'small');

const KEY = 'auto-subtitle-settings';

export function loadAutoSubtitleSettings(): AutoSubtitleSettings {
  const defaults: AutoSubtitleSettings = { model: recommendedModel(), language: 'ko', autoOnImport: true, chosen: false };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function saveAutoSubtitleSettings(settings: AutoSubtitleSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 저장하지 못해도 자막 만들기에는 지장이 없다.
  }
}

export const STEP_LABEL: Record<SttStep, string> = {
  engine: '인식 프로그램 내려받는 중 (처음 한 번만)',
  model: '인식 모델 내려받는 중 (처음 한 번만)',
  audio: '영상에서 말소리 추출 중',
  recognize: '자막 만드는 중',
};
