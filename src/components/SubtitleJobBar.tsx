import { useEffect } from 'react';
import type { SubtitleJob, SubtitleJobResult } from '../state/useAutoSubtitles';
import { STEP_LABEL } from '../utils/autoSubtitle';

interface Props {
  job: SubtitleJob | null;
  result: SubtitleJobResult | null;
  onCancel: () => void;
  onDismiss: () => void;
}

/** 화면 위쪽에 자동 자막 진행 상황을 작게 보여 준다. (화면을 가리지 않아 자막이 채워지는 모습을 볼 수 있다) */
export default function SubtitleJobBar({ job, result, onCancel, onDismiss }: Props) {
  // 완료 알림은 잠시 뒤 저절로 사라진다.
  useEffect(() => {
    if (result?.kind !== 'done') return;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [result, onDismiss]);

  if (job) {
    const pct = Math.floor(job.progress * 100);
    return (
      <div className="job-bar running" role="status">
        <span className="job-spinner" />
        <span className="job-label">
          {STEP_LABEL[job.step]}
          {job.step === 'recognize' && job.count > 0 && <b> · {job.count}개</b>}
        </span>
        <span className="job-progress">
          <span className="job-progress-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="job-pct">{pct}%</span>
        <button className="btn job-cancel" onClick={onCancel}>
          취소
        </button>
      </div>
    );
  }

  if (!result) return null;
  const message = {
    done: result.kind === 'done' && `✅ 자막 ${result.count}개를 만들었어요`,
    empty: '🤔 말소리를 찾지 못했어요. 영상 소리가 음소거인지, 언어 설정이 맞는지 확인해 주세요.',
    canceled: result.kind === 'canceled' && `취소했어요. 그때까지 만든 자막 ${result.count}개는 남겨 뒀어요.`,
    error: '❌ 자막을 만들지 못했어요.',
  }[result.kind];

  return (
    <div className={`job-bar ${result.kind}`} role="status">
      <span className="job-label">{message}</span>
      {result.kind === 'error' && (
        <button className="btn job-cancel" onClick={() => alert(result.message)}>
          자세히
        </button>
      )}
      <button className="job-close" onClick={onDismiss} title="닫기">
        ×
      </button>
    </div>
  );
}
