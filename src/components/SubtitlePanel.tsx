import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Subtitle } from '../types';
import type { HistoryAction } from '../state/project';
import { playback, usePlaying } from '../state/playback';
import { formatTime } from '../utils/media';
import { parseSrt, toSrt } from '../utils/subtitles';

interface Props {
  subtitles: Subtitle[];
  selectedId: string | null;
  dispatch: (a: HistoryAction) => void;
  onSelect: (id: string) => void;
  onAddAtPlayhead: () => void;
  onOpenAuto: () => void;
}

/** 재생 위치의 자막 id. 바뀔 때만 다시 그리도록 id만 구독한다. */
function useActiveSubtitleId(subtitles: Subtitle[]) {
  return useSyncExternalStore(playback.subscribe, () => {
    const t = playback.getTime();
    return subtitles.find((s) => t >= s.start && t < s.end)?.id ?? null;
  });
}

export default function SubtitlePanel({ subtitles, selectedId, dispatch, onSelect, onAddAtPlayhead, onOpenAuto }: Props) {
  const activeId = useActiveSubtitleId(subtitles);
  const playing = usePlaying();
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 재생 중에는 지금 나오는 자막을, 선택이 바뀌면 선택한 자막을 보이게 스크롤한다.
  const followId = playing ? activeId : selectedId;
  useEffect(() => {
    if (!followId) return;
    listRef.current?.querySelector(`[data-id="${followId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [followId]);

  // 방금 추가한 빈 자막은 바로 입력할 수 있게 한다.
  useEffect(() => {
    const textarea = listRef.current?.querySelector<HTMLTextAreaElement>(`[data-id="${selectedId}"] textarea`);
    if (textarea && textarea.value === '') textarea.focus();
  }, [selectedId]);

  const importSrt = async (file: File | undefined) => {
    if (!file) return;
    const subs = parseSrt(await file.text());
    if (subs.length === 0) {
      alert('SRT 파일에서 자막을 찾지 못했어요.');
      return;
    }
    if (subtitles.length > 0 && !confirm(`지금 있는 자막 ${subtitles.length}개를 불러온 자막 ${subs.length}개로 바꿀까요?`)) return;
    dispatch({ type: 'setSubtitles', subtitles: subs });
  };

  return (
    <div className="panel subtitle-panel">
      <div className="panel-header">
        <h2>자막 {subtitles.length > 0 && <span className="muted-count">{subtitles.length}</span>}</h2>
        <button className="btn" onClick={onAddAtPlayhead} title="재생헤드 위치에 자막 추가">
          + 추가
        </button>
      </div>

      <div className="sub-toolbar">
        <button className="btn primary sub-auto" onClick={onOpenAuto}>
          🤖 자동 자막 만들기
        </button>
        <div className="sub-file-actions">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            SRT 불러오기
          </button>
          <button
            className="btn"
            disabled={subtitles.length === 0}
            onClick={() => window.editorApi.saveSrt(toSrt(subtitles))}
          >
            SRT 저장
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".srt"
          hidden
          onChange={(e) => {
            importSrt(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {subtitles.length === 0 ? (
        <div className="empty-drop">
          <p>🤖 자동 자막으로 만들거나</p>
          <p>+ 추가 / 타임라인 자막 줄 더블클릭</p>
        </div>
      ) : (
        <ul className="sub-list" ref={listRef}>
          {subtitles.map((s) => (
            <li
              key={s.id}
              data-id={s.id}
              className={`sub-item ${s.id === selectedId ? 'selected' : ''} ${s.id === activeId ? 'active' : ''}`}
              onPointerDown={() => onSelect(s.id)}
            >
              <div className="sub-item-head">
                <button className="sub-time" title="이 자막으로 이동" onClick={() => playback.seek(s.start)}>
                  {formatTime(s.start)} → {formatTime(s.end)}
                </button>
                <button
                  className="sub-remove"
                  title="자막 삭제"
                  onClick={() => dispatch({ type: 'removeSubtitle', id: s.id })}
                >
                  ×
                </button>
              </div>
              <textarea
                value={s.text}
                rows={2}
                placeholder="자막 내용을 입력하세요"
                onChange={(e) => dispatch({ type: 'updateSubtitle', id: s.id, text: e.target.value })}
                onBlur={() => dispatch({ type: 'endMerge' })}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
