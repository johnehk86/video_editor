import { useEffect, useState } from 'react';
import type { MediaItem, Project, Subtitle } from '../types';
import { buildExportPlan, RESOLUTION_PRESETS } from '../utils/exportPlan';

interface Props {
  project: Project;
  media: Map<string, MediaItem>;
  onDone: (subtitles: Subtitle[]) => void;
  onClose: () => void;
}

type ModelId = 'base' | 'small' | 'turbo';
type Status = Awaited<ReturnType<Window['editorApi']['getSttStatus']>>;
type Phase =
  | { kind: 'settings' }
  | { kind: 'running'; step: 'engine' | 'model' | 'audio' | 'recognize'; progress: number }
  | { kind: 'error'; message: string }
  | { kind: 'empty' };

const MODELS: { id: ModelId; label: string; size: string; note: string }[] = [
  { id: 'base', label: '빠름', size: '148MB', note: '짧은 영상을 빨리 확인할 때' },
  { id: 'small', label: '보통 (추천)', size: '488MB', note: '속도와 정확도의 균형' },
  { id: 'turbo', label: '가장 정확', size: '574MB', note: '시간이 더 걸리지만 가장 잘 알아들어요' },
];

const LANGUAGES = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: '영어' },
  { id: 'ja', label: '일본어' },
  { id: 'auto', label: '자동 감지' },
];

const STEP_LABEL = {
  engine: '인식 프로그램 내려받는 중 (처음 한 번만)',
  model: '인식 모델 내려받는 중 (처음 한 번만)',
  audio: '영상에서 말소리 추출 중',
  recognize: '말소리를 글자로 바꾸는 중',
};

const SETTINGS_KEY = 'auto-subtitle-settings';

function loadSettings(): { model: ModelId; language: string } {
  try {
    return { model: 'small', language: 'ko', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return { model: 'small', language: 'ko' };
  }
}

export default function AutoSubtitleDialog({ project, media, onDone, onClose }: Props) {
  const [settings, setSettings] = useState(loadSettings);
  const [status, setStatus] = useState<Status | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' });
  const running = phase.kind === 'running';

  useEffect(() => {
    window.editorApi.getSttStatus().then(setStatus);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 자막 만들기에는 지장이 없다.
    }
  }, [settings]);

  useEffect(
    () =>
      window.editorApi.onSttProgress(({ phase: step, progress }) => setPhase({ kind: 'running', step, progress })),
    [],
  );

  const hasSpeechSource = project.clips.some((c) => c.track !== 'audio' && media.get(c.mediaId)?.kind !== 'image');

  const start = async () => {
    let plan;
    try {
      // 소리만 쓰므로 해상도는 아무 값이나 괜찮다.
      const { width, height } = RESOLUTION_PRESETS[0];
      plan = buildExportPlan(project, media, { width, height, fps: 30, crf: 23 });
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
      return;
    }
    setPhase({ kind: 'running', step: status?.engine ? 'audio' : 'engine', progress: 0 });
    const result = await window.editorApi.transcribe({ plan, model: settings.model, language: settings.language });
    if (result.status === 'done') {
      if (result.segments.length === 0) {
        setPhase({ kind: 'empty' });
        return;
      }
      onDone(result.segments.map((s) => ({ ...s, id: crypto.randomUUID() })));
    } else if (result.status === 'error') {
      setPhase({ kind: 'error', message: result.message });
    } else {
      setPhase({ kind: 'settings' });
    }
  };

  const downloadNote = !status
    ? ''
    : [!status.engine && '인식 프로그램 9MB', !status.models[settings.model] && `모델 ${MODELS.find((m) => m.id === settings.model)?.size}`]
        .filter(Boolean)
        .join(' + ');

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal">
        <h2>🤖 자동 자막 만들기</h2>

        {phase.kind === 'settings' && (
          <>
            <div className="model-list">
              {MODELS.map((m) => (
                <label key={m.id} className={`model-option ${settings.model === m.id ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="model"
                    checked={settings.model === m.id}
                    onChange={() => setSettings({ ...settings, model: m.id })}
                  />
                  <span className="model-text">
                    <strong>{m.label}</strong>
                    <small>{m.note}</small>
                  </span>
                  <span className="model-size">{status?.models[m.id] ? '✓ 준비됨' : m.size}</span>
                </label>
              ))}
            </div>

            <label className="field">
              <span>언어</span>
              <select value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>

            <ul className="modal-bullets">
              <li>영상 소리와 🎙 녹음 트랙을 듣고, 🎵 배경음악은 빼고 들어요.</li>
              <li>모든 처리는 이 PC 안에서 하며, 영상은 밖으로 나가지 않아요.</li>
              {downloadNote && <li>처음 한 번 {downloadNote}를 내려받아요.</li>}
              {project.subtitles.length > 0 && (
                <li className="warn">지금 있는 자막 {project.subtitles.length}개는 새 자막으로 바뀌어요. (Ctrl+Z로 되돌릴 수 있어요)</li>
              )}
              {!hasSpeechSource && <li className="warn">타임라인에 말소리가 있는 영상이나 녹음이 없어요.</li>}
            </ul>

            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                닫기
              </button>
              <button className="btn primary" onClick={start} disabled={!hasSpeechSource}>
                자막 만들기
              </button>
            </div>
          </>
        )}

        {phase.kind === 'running' && (
          <>
            <p>{STEP_LABEL[phase.step]}…</p>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${phase.progress * 100}%` }} />
            </div>
            <p className="modal-note">{Math.floor(phase.progress * 100)}%</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.editorApi.cancelTranscribe()}>
                취소
              </button>
            </div>
          </>
        )}

        {phase.kind === 'empty' && (
          <>
            <p>말소리를 찾지 못했어요. 영상 소리가 음소거되어 있지 않은지, 언어 설정이 맞는지 확인해 주세요.</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setPhase({ kind: 'settings' })}>
                돌아가기
              </button>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <p>❌ 자막을 만들지 못했어요.</p>
            <pre className="error-log">{phase.message}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                닫기
              </button>
              <button className="btn primary" onClick={() => setPhase({ kind: 'settings' })}>
                다시 시도
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
