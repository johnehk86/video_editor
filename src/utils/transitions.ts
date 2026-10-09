import type { CSSProperties } from 'react';
import type { TransitionType } from '../types';

/*
 * 전환 효과 목록과 미리보기용 모양.
 * 내보내기는 FFmpeg xfade 로 만들고, 미리보기는 같은 모양이 되도록 CSS로 흉내 낸다.
 * (방향·곡선은 xfade 결과를 프레임별로 재서 맞췄다)
 */

export const TRANSITIONS: { type: TransitionType; label: string; icon: string }[] = [
  { type: 'fade', label: '디졸브', icon: '◐' },
  { type: 'fadeblack', label: '검은 화면', icon: '■' },
  { type: 'fadewhite', label: '흰 화면', icon: '□' },
  { type: 'slideleft', label: '왼쪽 밀기', icon: '⇠' },
  { type: 'slideright', label: '오른쪽 밀기', icon: '⇢' },
  { type: 'wipeleft', label: '왼쪽 닦기', icon: '◧' },
  { type: 'wiperight', label: '오른쪽 닦기', icon: '◨' },
  { type: 'circleopen', label: '원형 열기', icon: '◉' },
];

export const DEFAULT_TRANSITION = { type: 'fade' as TransitionType, duration: 0.5 };
export const MIN_TRANSITION = 0.1;
export const MAX_TRANSITION = 2;

export const transitionLabel = (type: TransitionType) => TRANSITIONS.find((t) => t.type === type)?.label ?? type;

/** 0~1 사이 표를 선형 보간 (10% 간격으로 잰 값) */
function sampleCurve(table: number[], q: number) {
  const x = Math.min(Math.max(q, 0), 1) * (table.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  return i >= table.length - 1 ? table[table.length - 1] : table[i] * (1 - t) + table[i + 1] * t;
}

// 검은/흰 화면 거치기: 앞 화면은 처음 20% 안에 사라지고, 뒤 화면은 30%부터 서서히 나타난다.
const THROUGH_OUT = [1, 0.4, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const THROUGH_IN = [0, 0, 0, 0.01, 0.13, 0.28, 0.46, 0.64, 0.78, 0.88, 0.96];

export interface TransitionLook {
  /** 나가는(앞) 클립 */
  out: CSSProperties;
  /** 들어오는(뒤) 클립 */
  in: CSSProperties;
  /** 두 화면 아래에 깔리는 바탕색 */
  matte?: string;
}

/** 진행률 q(0→1)에서 두 클립의 모양 */
export function transitionLook(type: TransitionType, q: number): TransitionLook {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  switch (type) {
    case 'fade':
      return { out: {}, in: { opacity: q } };
    case 'fadeblack':
    case 'fadewhite':
      return {
        out: { opacity: sampleCurve(THROUGH_OUT, q) },
        in: { opacity: sampleCurve(THROUGH_IN, q) },
        matte: type === 'fadeblack' ? '#000' : '#fff',
      };
    case 'slideleft':
      return { out: { transform: `translateX(${pct(-q)})` }, in: { transform: `translateX(${pct(1 - q)})` } };
    case 'slideright':
      return { out: { transform: `translateX(${pct(q)})` }, in: { transform: `translateX(${pct(q - 1)})` } };
    case 'wipeleft':
      return { out: {}, in: { clipPath: `inset(0 0 0 ${pct(1 - q)})` } };
    case 'wiperight':
      return { out: {}, in: { clipPath: `inset(0 ${pct(1 - q)} 0 0)` } };
    case 'circleopen': {
      // 반지름 = max(0, 3q-1) × (대각선의 절반). CSS circle()의 %는 대각선/√2 기준이라 0.7071을 곱한다.
      const r = Math.max(0, 3 * q - 1) * 70.71;
      return { out: {}, in: { clipPath: `circle(${r.toFixed(2)}% at 50% 50%)` } };
    }
  }
}
