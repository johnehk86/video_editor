import { useRef, useState } from 'react';
import type { Subtitle } from '../types';
import type { HistoryAction } from './project';
import type { ExportPlan } from '../utils/exportPlan';
import type { AutoSubtitleSettings, SttStep } from '../utils/autoSubtitle';

/** 자막을 만드는 중의 상태 (화면 위쪽 진행 표시에 쓴다) */
export interface SubtitleJob {
  step: SttStep;
  progress: number;
  /** 지금까지 채워진 자막 수 */
  count: number;
}

export type SubtitleJobResult =
  | { kind: 'done'; count: number }
  | { kind: 'empty' }
  | { kind: 'canceled'; count: number }
  | { kind: 'error'; message: string };

/**
 * 자동 자막 실행. 인식된 문장이 오는 대로 자막 목록·타임라인에 바로 채워 넣는다.
 * 실시간으로 채운 변경은 실행취소 기록 하나로 묶여서 Ctrl+Z 한 번에 되돌릴 수 있다.
 */
export function useAutoSubtitles(dispatch: (a: HistoryAction) => void) {
  const [job, setJob] = useState<SubtitleJob | null>(null);
  const [result, setResult] = useState<SubtitleJobResult | null>(null);
  const running = useRef(false);

  /** firstStep: 엔진·모델이 이미 있으면 audio, 없으면 engine/model 부터 */
  const start = async (plan: ExportPlan, settings: AutoSubtitleSettings, firstStep: SttStep) => {
    if (running.current) return;
    running.current = true;
    setResult(null);
    setJob({ step: firstStep, progress: 0, count: 0 });

    const live: Subtitle[] = [];
    const offSegment = window.editorApi.onSttSegment((seg) => {
      live.push({ ...seg, id: crypto.randomUUID() });
      dispatch({ type: 'setSubtitles', subtitles: [...live], live: true });
      setJob((j) => j && { ...j, count: live.length });
    });
    const offProgress = window.editorApi.onSttProgress(({ phase, progress }) =>
      setJob((j) => j && { ...j, step: phase, progress }),
    );

    try {
      const r = await window.editorApi.transcribe({ plan, model: settings.model, language: settings.language });
      if (r.status === 'done' && r.segments.length > 0) {
        // 최종 결과로 한 번 더 맞춘다 (실시간으로 받은 것과 같지만, 빠진 줄이 없도록)
        dispatch({
          type: 'setSubtitles',
          subtitles: r.segments.map((s) => ({ ...s, id: crypto.randomUUID() })),
          live: true,
        });
        setResult({ kind: 'done', count: r.segments.length });
      } else if (r.status === 'done') {
        setResult({ kind: 'empty' });
      } else if (r.status === 'canceled') {
        setResult({ kind: 'canceled', count: live.length });
      } else {
        setResult({ kind: 'error', message: r.message });
      }
    } finally {
      offSegment();
      offProgress();
      dispatch({ type: 'endMerge' });
      setJob(null);
      running.current = false;
    }
  };

  return {
    job,
    result,
    start,
    cancel: () => window.editorApi.cancelTranscribe(),
    dismissResult: () => setResult(null),
  };
}
