import { useEffect, useState } from 'react';
import type { MediaItem, Project } from '../types';
import type { AutoSubtitleSettings, SttModel } from '../utils/autoSubtitle';

interface Props {
  project: Project;
  media: Map<string, MediaItem>;
  initial: AutoSubtitleSettings;
  /** 처음 영상을 넣었을 때 열린 경우 안내 문구를 바꾼다 */
  firstRun: boolean;
  onStart: (settings: AutoSubtitleSettings) => void;
  onClose: () => void;
}

type Status = Awaited<ReturnType<Window['editorApi']['getSttStatus']>>;

const MODELS: { id: SttModel; label: string; size: string; note: string }[] = [
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

/** 자동 자막 설정을 고르고 시작한다. (진행 상황은 화면 위쪽 진행 표시에 나온다) */
export default function AutoSubtitleDialog({ project, media, initial, firstRun, onStart, onClose }: Props) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    window.editorApi.getSttStatus().then(setStatus);
  }, []);

  const hasSpeechSource = project.clips.some((c) => c.track !== 'audio' && media.get(c.mediaId)?.kind !== 'image');
  const downloadNote = !status
    ? ''
    : [
        !status.engine && '인식 프로그램 9MB',
        !status.models[settings.model] && `모델 ${MODELS.find((m) => m.id === settings.model)?.size}`,
      ]
        .filter(Boolean)
        .join(' + ');

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>🤖 자동 자막 만들기</h2>
        {firstRun && <p className="modal-lead">영상을 넣으셨네요! 자막을 어떻게 만들지 한 번만 골라 주세요.</p>}

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

        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoOnImport}
            onChange={(e) => setSettings({ ...settings, autoOnImport: e.target.checked })}
          />
          새 프로젝트에 영상을 넣으면 이 설정으로 바로 자막 만들기
        </label>

        <ul className="modal-bullets">
          <li>자막은 만들어지는 대로 바로바로 채워져요. 기다리는 동안 영상을 봐도 돼요.</li>
          <li>영상 소리와 🎙 녹음 트랙을 듣고, 🎵 배경음악은 빼고 들어요.</li>
          <li>모든 처리는 이 PC 안에서 하며, 영상은 밖으로 나가지 않아요.</li>
          {downloadNote && <li>처음 한 번 {downloadNote}를 내려받아요.</li>}
          {project.subtitles.length > 0 && (
            <li className="warn">
              지금 있는 자막 {project.subtitles.length}개는 새 자막으로 바뀌어요. (Ctrl+Z로 되돌릴 수 있어요)
            </li>
          )}
          {!hasSpeechSource && <li className="warn">타임라인에 말소리가 있는 영상이나 녹음이 없어요.</li>}
        </ul>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {firstRun ? '나중에' : '닫기'}
          </button>
          <button
            className="btn primary"
            disabled={!hasSpeechSource}
            onClick={() => onStart({ ...settings, chosen: true })}
          >
            자막 만들기
          </button>
        </div>
      </div>
    </div>
  );
}
