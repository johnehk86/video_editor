import { useEffect, useState } from 'react';
import type { MediaItem, Project } from '../types';
import {
  attachOverlays,
  buildExportPlan,
  FPS_OPTIONS,
  QUALITY_PRESETS,
  RESOLUTION_PRESETS,
  type ExportSettings,
} from '../utils/exportPlan';
import { projectDuration } from '../state/project';
import { formatTime } from '../utils/media';

interface Props {
  project: Project;
  media: Map<string, MediaItem>;
  onClose: () => void;
}

type Phase =
  | { kind: 'settings' }
  | { kind: 'preparing'; progress: number }
  | { kind: 'running'; progress: number }
  | { kind: 'done'; path: string }
  | { kind: 'error'; message: string };

interface Choice {
  resolution: string;
  quality: string;
  fps: number;
  /** 자막을 영상에 입힌다 */
  burnSubtitles: boolean;
  /** MP4 옆에 .srt 도 저장한다 */
  saveSrt: boolean;
}

const STORAGE_KEY = 'export-settings';
const DEFAULT_CHOICE: Choice = { resolution: '1080p', quality: 'normal', fps: 30, burnSubtitles: true, saveSrt: true };

function loadChoice(): Choice {
  try {
    return { ...DEFAULT_CHOICE, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export default function ExportDialog({ project, media, onClose }: Props) {
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' });
  const running = phase.kind === 'running' || phase.kind === 'preparing';
  const subtitleCount = project.subtitles.filter((s) => s.text.trim()).length;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // 저장하지 못해도 내보내기에는 지장이 없다.
    }
  }, [choice]);

  useEffect(() => window.editorApi.onExportProgress((progress) => setPhase({ kind: 'running', progress })), []);

  const start = async () => {
    const res = RESOLUTION_PRESETS.find((r) => r.id === choice.resolution) ?? RESOLUTION_PRESETS[0];
    const quality = QUALITY_PRESETS.find((q) => q.id === choice.quality) ?? QUALITY_PRESETS[1];
    const settings: ExportSettings = { width: res.width, height: res.height, fps: choice.fps, crf: quality.crf };

    let plan;
    try {
      plan = buildExportPlan(project, media, settings);
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message });
      return;
    }

    const burnSubtitles = subtitleCount > 0 && choice.burnSubtitles;
    const saveSrt = subtitleCount > 0 && choice.saveSrt;
    if (project.texts.length > 0 || burnSubtitles || saveSrt) {
      setPhase({ kind: 'preparing', progress: 0 });
      plan = await attachOverlays(plan, project, { burnSubtitles, srt: saveSrt }, (progress) =>
        setPhase({ kind: 'preparing', progress }),
      );
    }

    setPhase({ kind: 'running', progress: 0 });
    const result = await window.editorApi.exportVideo(plan);
    if (result.status === 'done') setPhase({ kind: 'done', path: result.path });
    else if (result.status === 'error') setPhase({ kind: 'error', message: result.message });
    else setPhase({ kind: 'settings' });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal">
        <h2>영상 내보내기</h2>

        {phase.kind === 'settings' && (
          <>
            <label className="field">
              <span>해상도</span>
              <select value={choice.resolution} onChange={(e) => setChoice({ ...choice, resolution: e.target.value })}>
                {RESOLUTION_PRESETS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>프레임</span>
              <select value={choice.fps} onChange={(e) => setChoice({ ...choice, fps: Number(e.target.value) })}>
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>화질</span>
              <select value={choice.quality} onChange={(e) => setChoice({ ...choice, quality: e.target.value })}>
                {QUALITY_PRESETS.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            {subtitleCount > 0 && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={choice.burnSubtitles}
                    onChange={(e) => setChoice({ ...choice, burnSubtitles: e.target.checked })}
                  />
                  자막 {subtitleCount}개를 영상에 입히기
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={choice.saveSrt}
                    onChange={(e) => setChoice({ ...choice, saveSrt: e.target.checked })}
                  />
                  SRT 자막 파일도 같이 저장 (유튜브 자막으로 따로 올릴 때)
                </label>
              </>
            )}
            <p className="modal-note">영상 길이 {formatTime(projectDuration(project))} · MP4 (H.264 + AAC)</p>
            <div className="modal-actions">
              <button className="btn" onClick={onClose}>
                닫기
              </button>
              <button className="btn primary" onClick={start}>
                저장 위치 선택 후 내보내기
              </button>
            </div>
          </>
        )}

        {phase.kind === 'preparing' && (
          <>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${phase.progress * 100}%` }} />
            </div>
            <p className="modal-note">텍스트·자막 그래픽 준비 중… {Math.floor(phase.progress * 100)}%</p>
          </>
        )}

        {phase.kind === 'running' && (
          <>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${phase.progress * 100}%` }} />
            </div>
            <p className="modal-note">렌더링 중… {Math.floor(phase.progress * 100)}%</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.editorApi.cancelExport()}>
                취소
              </button>
            </div>
          </>
        )}

        {phase.kind === 'done' && (
          <>
            <p>✅ 내보내기가 끝났어요!</p>
            <p className="modal-note path">{phase.path}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.editorApi.showItemInFolder(phase.path)}>
                폴더 열기
              </button>
              <button className="btn primary" onClick={onClose}>
                확인
              </button>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <p>❌ 내보내기에 실패했어요.</p>
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
