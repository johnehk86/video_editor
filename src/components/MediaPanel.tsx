import { useRef, useState } from 'react';
import type { MediaItem } from '../types';
import { ACCEPTED_TYPES, formatTime } from '../utils/media';
import { MEDIA_DRAG_TYPE } from './Timeline';

interface Props {
  media: MediaItem[];
  selectedId: string | null;
  /** 파일 가져오기 (빈 프로젝트면 타임라인에 올리고 자동 자막까지) */
  onImport: (files: File[]) => Promise<void>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddToTimeline: (id: string) => void;
  /** 찾지 못한 파일을 사용자가 고른 파일로 다시 연결 */
  onRelink: (id: string, file: File) => void;
}

const KIND_ICON = { video: '🎞️', audio: '🎵', image: '🖼️' } as const;

export default function MediaPanel({ media, selectedId, onImport, onSelect, onRemove, onAddToTimeline, onRelink }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const relinkTarget = useRef<string | null>(null);
  const missingCount = media.filter((m) => m.missing).length;

  const startRelink = (id: string) => {
    relinkTarget.current = id;
    relinkRef.current?.click();
  };
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      await onImport(Array.from(files));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      className={`panel media-panel ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        importFiles(e.dataTransfer.files);
      }}
    >
      <div className="panel-header">
        <h2>미디어</h2>
        <button className="btn" onClick={() => inputRef.current?.click()}>
          + 가져오기
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          hidden
          onChange={(e) => {
            importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={relinkRef}
          type="file"
          accept={ACCEPTED_TYPES}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && relinkTarget.current) onRelink(relinkTarget.current, file);
            e.target.value = '';
          }}
        />
      </div>

      {missingCount > 0 && (
        <div className="missing-banner">
          ⚠ 찾지 못한 파일 {missingCount}개 — 빨간 카드를 눌러 다시 연결하세요. 같은 폴더의 나머지 파일은 자동으로 찾아요.
        </div>
      )}

      {media.length === 0 ? (
        <div className="empty-drop">
          <p>영상·음악·이미지 파일을</p>
          <p>여기에 끌어다 놓으세요</p>
        </div>
      ) : (
        <ul className="media-grid">
          {media.map((m) => (
            <li
              key={m.id}
              className={`media-card ${m.id === selectedId ? 'selected' : ''} ${m.missing ? 'missing' : ''}`}
              title={m.missing ? `파일을 찾을 수 없어요: ${m.path}
눌러서 다시 연결하세요.` : '더블클릭하거나 타임라인으로 끌어다 놓으세요'}
              draggable={!m.missing}
              onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => (m.missing ? startRelink(m.id) : onSelect(m.id))}
              onDoubleClick={() => !m.missing && onAddToTimeline(m.id)}
            >
              <div className="thumb">
                {m.thumbnail ? <img src={m.thumbnail} alt="" draggable={false} /> : <span className="thumb-icon">{KIND_ICON[m.kind]}</span>}
                {m.duration !== undefined && <span className="duration">{formatTime(m.duration)}</span>}
                {m.missing && <span className="missing-badge">⚠ 다시 연결</span>}
                <button
                  className="add"
                  title="타임라인에 추가"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToTimeline(m.id);
                  }}
                >
                  +
                </button>
                <button
                  className="remove"
                  title="삭제"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(m.id);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="media-name" title={m.name}>
                {m.name}
              </div>
            </li>
          ))}
        </ul>
      )}
      {loading && <div className="loading">불러오는 중…</div>}
    </aside>
  );
}
