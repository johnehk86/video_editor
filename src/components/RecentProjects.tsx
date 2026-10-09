import { useEffect, useRef, useState } from 'react';

type RecentEntry = Awaited<ReturnType<Window['editorApi']['listRecent']>>[number];

function formatWhen(iso: string) {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}시간 전`;
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

/** 최근 프로젝트 목록. refreshKey 가 바뀌면 다시 읽는다. */
function useRecent(refreshKey: number) {
  const [list, setList] = useState<RecentEntry[]>([]);
  const reload = () => window.editorApi.listRecent().then(setList);
  useEffect(() => {
    reload();
  }, [refreshKey]);
  return { list, reload };
}

interface ListProps {
  list: RecentEntry[];
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

function RecentList({ list, onOpen, onRemove }: ListProps) {
  if (list.length === 0) return <p className="recent-empty">최근에 연 프로젝트가 없어요</p>;
  return (
    <ul className="recent-list">
      {list.map((r) => (
        <li key={r.path} className={r.exists ? '' : 'gone'}>
          <button
            className="recent-open"
            disabled={!r.exists}
            title={r.exists ? r.path : `파일을 찾을 수 없어요: ${r.path}`}
            onClick={() => onOpen(r.path)}
          >
            <span className="recent-name">
              {r.exists ? '🎬' : '⚠'} {r.name}
            </span>
            <span className="recent-when">{formatWhen(r.openedAt)}</span>
          </button>
          <button className="recent-remove" title="목록에서 빼기" onClick={() => onRemove(r.path)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

interface Props {
  refreshKey: number;
  onOpen: (path: string) => void;
}

/** 📂 열기 옆의 ▾ 메뉴 */
export function RecentMenu({ refreshKey, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const { list, reload } = useRecent(refreshKey);
  const ref = useRef<HTMLDivElement>(null);

  // 메뉴 밖을 누르면 닫는다.
  useEffect(() => {
    if (!open) return;
    reload();
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="recent-menu" ref={ref}>
      <button className="btn recent-toggle" onClick={() => setOpen(!open)} title="최근 프로젝트">
        ▾
      </button>
      {open && (
        <div className="recent-popup">
          <div className="recent-title">최근 프로젝트</div>
          <RecentList
            list={list}
            onOpen={(p) => {
              setOpen(false);
              onOpen(p);
            }}
            onRemove={(p) => window.editorApi.removeRecent(p).then(reload)}
          />
        </div>
      )}
    </div>
  );
}

/** 빈 화면에 보여 주는 시작 안내: 영상 넣기(→ 자동 자막) + 최근 프로젝트 */
export function RecentStart({ refreshKey, onOpen, onPickFiles }: Props & { onPickFiles: (files: File[]) => void }) {
  const { list, reload } = useRecent(refreshKey);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="recent-start">
      <div className="start-hero">
        <div className="start-icon">🎬</div>
        <p className="start-title">영상을 여기에 끌어다 놓으세요</p>
        <p className="start-sub">타임라인에 올리고 자막까지 자동으로 만들어 드려요</p>
        <button className="btn primary" onClick={() => inputRef.current?.click()}>
          영상 파일 선택
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onPickFiles(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
      </div>
      {list.length > 0 && (
        <>
          <p className="recent-start-title">최근 프로젝트를 이어서 편집하세요</p>
          <RecentList
            list={list.slice(0, 5)}
            onOpen={onOpen}
            onRemove={(p) => window.editorApi.removeRecent(p).then(reload)}
          />
        </>
      )}
    </div>
  );
}
