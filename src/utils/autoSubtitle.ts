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

const KEY = 'auto-subtitle-settings';
const DEFAULTS: AutoSubtitleSettings = { model: 'small', language: 'ko', autoOnImport: true, chosen: false };

export function loadAutoSubtitleSettings(): AutoSubtitleSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
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
