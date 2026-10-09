import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clip, MediaItem, Project, TrackId } from '../types';
import {
  applyAction,
  clipDuration,
  effectiveFades,
  MIN_CLIP_DURATION,
  MIN_SUBTITLE_DURATION,
  mediaLimit,
  projectDuration,
  transitionWindows,
  type HistoryAction,
  type ProjectAction,
} from '../state/project';
import { DEFAULT_TRANSITION, TRANSITIONS, transitionLabel } from '../utils/transitions';
import { playback, usePlaybackTime, usePlaying } from '../state/playback';
import { formatTime, PEAKS_PER_SECOND } from '../utils/media';

export const MEDIA_DRAG_TYPE = 'application/x-media-id';

const TRACKS: { id: TrackId; label: string }[] = [
  { id: 'main', label: '🎞 메인' },
  { id: 'audio', label: '🎵 배경음악' },
  { id: 'voice', label: '🎙 녹음' },
];
const DRAG_THRESHOLD = 3;
/** 눈금 간격 후보(초). 화면에서 60px 이상 벌어지는 첫 값을 쓴다 */
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

type DragKind = 'move' | 'trim-l' | 'trim-r';
interface Drag {
  kind: DragKind;
  clip: Clip;
  originX: number;
  dx: number;
  moved: boolean;
}

interface Props {
  project: Project;
  media: Map<string, MediaItem>;
  selectedClipId: string | null;
  selectedSubtitleId: string | null;
  /** 선택한 전환 (전환이 들어오는 클립의 id) */
  selectedTransitionId: string | null;
  onSelectTransition: (clipId: string) => void;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  onAddTextAt: (time: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (a: HistoryAction) => void;
  onSelectClip: (id: string | null) => void;
  onAddMedia: (mediaId: string, at: { start?: number; index?: number; track?: TrackId }) => void;
  onOpenRecorder: () => void;
  onSelectSubtitle: (id: string | null) => void;
  onAddSubtitleAt: (time: number) => void;
  onSplit: () => void;
  onDelete: () => void;
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** 메인 트랙에서 time 위치에 끼워 넣을 순서. exclude는 계산에서 뺄 클립(끌고 있는 클립) */
function mainInsertIndex(project: Project, time: number, exclude?: string) {
  let t = 0;
  let index = 0;
  for (const c of project.clips) {
    if (c.track !== 'main' || c.id === exclude) continue;
    const d = clipDuration(c);
    if (t + d / 2 < time) index++;
    t += d;
  }
  return index;
}

function dragToAction(drag: Drag, project: Project, pps: number, media: Map<string, MediaItem>): ProjectAction {
  const { clip } = drag;
  const dt = drag.dx / pps;
  switch (drag.kind) {
    case 'trim-l': {
      // 오디오 트랙은 오른쪽 끝을 고정한 채 시작점이 0 아래로 가지 않게 한다.
      const minIn = clip.track !== 'main' ? Math.max(0, clip.in - clip.start * clip.speed) : 0;
      const newIn = clamp(clip.in + dt * clip.speed, minIn, clip.out - MIN_CLIP_DURATION * clip.speed);
      const start = clip.start + (newIn - clip.in) / clip.speed;
      return { type: 'trim', clipId: clip.id, in: newIn, out: clip.out, start };
    }
    case 'trim-r': {
      const limit = mediaLimit(media.get(clip.mediaId));
      const newOut = clamp(clip.out + dt * clip.speed, clip.in + MIN_CLIP_DURATION * clip.speed, limit);
      return { type: 'trim', clipId: clip.id, in: clip.in, out: newOut, start: clip.start };
    }
    case 'move':
      if (clip.track !== 'main') return { type: 'move', clipId: clip.id, start: clip.start + dt };
      return {
        type: 'reorder',
        clipId: clip.id,
        index: mainInsertIndex(project, clip.start + dt + clipDuration(clip) / 2, clip.id),
      };
  }
}

function pickTickStep(pps: number) {
  return TICK_STEPS.find((s) => s * pps >= 60) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

export default function Timeline(props: Props) {
  const { project, media, selectedClipId, dispatch, onSelectClip } = props;
  const [pps, setPps] = useState(50); // 1초당 픽셀 (확대/축소)
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const timeAt = (clientX: number) => {
    const left = contentRef.current?.getBoundingClientRect().left ?? 0;
    return Math.max(0, (clientX - left) / pps);
  };

  // 클립 끌기(이동·트림) 중에는 창 전체에서 마우스를 추적한다.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.originX;
      updateDrag({ ...d, dx, moved: d.moved || Math.abs(dx) > DRAG_THRESHOLD });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d?.moved) dispatch(dragToAction(d, project, pps, media));
      updateDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag !== null, project, pps, media, dispatch]);

  // 끄는 동안에는 결과를 미리 적용한 모습을 보여 준다.
  const shown = drag?.moved ? applyAction(project, dragToAction(drag, project, pps, media)) : project;
  const windows = transitionWindows(shown);
  const textLanes = useMemo(() => assignLanes(project.texts), [project.texts]);

  const commitSubtitle = useCallback(
    (id: string, range: { start: number; end: number }) => {
      dispatch({ type: 'updateSubtitle', id, ...range });
      dispatch({ type: 'endMerge' });
    },
    [dispatch],
  );
  const commitText = useCallback(
    (id: string, range: { start: number; end: number }) => {
      dispatch({ type: 'updateText', id, patch: range });
      dispatch({ type: 'endMerge' });
    },
    [dispatch],
  );
  const lastOverlayEnd = [...project.subtitles, ...project.texts].reduce((t, s) => Math.max(t, s.end), 0);
  const contentWidth = (Math.max(projectDuration(shown), lastOverlayEnd) + 30) * pps;
  const tickStep = pickTickStep(pps);
  const ticks = Array.from({ length: Math.ceil(contentWidth / pps / tickStep) + 1 }, (_, i) => i * tickStep);

  const startDrag = (e: React.PointerEvent, clip: Clip, kind: DragKind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectClip(clip.id);
    updateDrag({ kind, clip, originX: e.clientX, dx: 0, moved: false });
  };

  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    playback.seek(timeAt(e.clientX));
  };

  const onDrop = (e: React.DragEvent) => {
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    const m = media.get(mediaId);
    if (!m) return;
    e.preventDefault();
    const t = timeAt(e.clientX);
    if (m.kind === 'audio') {
      // 녹음 줄에 놓으면 녹음 트랙, 그 외에는 배경음악 트랙
      const row = (e.target as HTMLElement).closest('[data-track]')?.getAttribute('data-track');
      props.onAddMedia(mediaId, { start: t, track: row === 'voice' ? 'voice' : 'audio' });
    }
    else props.onAddMedia(mediaId, { index: mainInsertIndex(project, t) });
  };

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <button className="btn" onClick={() => dispatch({ type: 'undo' })} disabled={!props.canUndo} title="실행취소 (Ctrl+Z)">
          ↶
        </button>
        <button className="btn" onClick={() => dispatch({ type: 'redo' })} disabled={!props.canRedo} title="다시실행 (Ctrl+Y)">
          ↷
        </button>
        <span className="tl-divider" />
        <button className="btn" onClick={props.onSplit} disabled={project.clips.length === 0} title="재생헤드 위치에서 자르기 (S)">
          ✂ 분할
        </button>
        <button
          className="btn"
          onClick={props.onDelete}
          disabled={!selectedClipId && !props.selectedSubtitleId && !props.selectedTransitionId && !props.selectedTextId}
          title="선택한 클립·자막 삭제 (Delete)"
        >
          🗑 삭제
        </button>
        <span className="tl-divider" />
        <button className="btn" onClick={() => props.onAddTextAt(playback.getTime())} title="재생헤드 위치에 텍스트 추가">
          🅣 텍스트
        </button>
        <button className="btn record-open" onClick={props.onOpenRecorder} title="마이크로 바로 녹음">
          🎙 녹음
        </button>
        <TimeDisplay />
        <span className="tl-zoom">
          🔍
          <input type="range" min={10} max={300} value={pps} onChange={(e) => setPps(Number(e.target.value))} />
        </span>
      </div>

      <div className="tl-body">
        <div className="tl-headers">
          <div className="tl-ruler-spacer" />
          <div className="tl-track-header text" style={{ height: textLanes.count * LANE_HEIGHT + 4 }}>
            🅣 텍스트
          </div>
          <div className="tl-track-header subtitle">💬 자막</div>
          {TRACKS.map((t) => (
            <div key={t.id} className={`tl-track-header ${t.id}`}>
              {t.label}
            </div>
          ))}
        </div>

        <div
          className="tl-scroll"
          ref={scrollRef}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) e.preventDefault();
          }}
          onDrop={onDrop}
          onWheel={(e) => {
            if (!e.ctrlKey) return;
            setPps((p) => clamp(Math.round(p * (e.deltaY < 0 ? 1.15 : 1 / 1.15)), 10, 300));
          }}
        >
          <div className="tl-content" ref={contentRef} style={{ width: contentWidth }}>
            <div
              className="tl-ruler"
              onPointerDown={scrub}
              onPointerMove={(e) => {
                if (e.buttons & 1) playback.seek(timeAt(e.clientX));
              }}
            >
              {ticks.map((t) => (
                <span key={t} className="tl-tick" style={{ left: t * pps }}>
                  {formatTime(t).slice(0, 5)}
                </span>
              ))}
            </div>

            <TimedTrack
              kind="text"
              items={project.texts}
              lanes={textLanes}
              pps={pps}
              selectedId={props.selectedTextId}
              emptyLabel="(빈 텍스트)"
              hint="빈 곳을 더블클릭하면 텍스트를 추가해요"
              onSelect={props.onSelectText}
              onCommit={commitText}
              onEmptyPointerDown={(clientX) => {
                props.onSelectText(null);
                playback.seek(timeAt(clientX));
              }}
              onEmptyDoubleClick={(clientX) => props.onAddTextAt(timeAt(clientX))}
            />

            <TimedTrack
              kind="subtitle"
              items={project.subtitles}
              pps={pps}
              selectedId={props.selectedSubtitleId}
              emptyLabel="(빈 자막)"
              hint="빈 곳을 더블클릭하면 자막을 추가해요"
              onSelect={props.onSelectSubtitle}
              onCommit={commitSubtitle}
              onEmptyPointerDown={(clientX) => {
                props.onSelectSubtitle(null);
                playback.seek(timeAt(clientX));
              }}
              onEmptyDoubleClick={(clientX) => props.onAddSubtitleAt(timeAt(clientX))}
            />

            {TRACKS.map((track) => (
              <div
                key={track.id}
                data-track={track.id}
                className={`tl-track ${track.id}`}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget || e.button !== 0) return;
                  onSelectClip(null);
                  playback.seek(timeAt(e.clientX));
                }}
              >
                {shown.clips
                  .filter((c) => c.track === track.id)
                  .map((clip) => {
                    const m = media.get(clip.mediaId);
                    const transitionIn = windows.get(clip.id)?.in;
                    const dragging = drag?.moved && drag.clip.id === clip.id;
                    // 메인 트랙 클립을 옮길 때는 커서를 따라가도록 원래 위치 + 이동량에 그린다.
                    const left = dragging && drag.kind === 'move' && clip.track === 'main' ? drag.clip.start * pps + drag.dx : clip.start * pps;
                    return (
                      <div
                        key={clip.id}
                        className={`tl-clip ${track.id} ${clip.id === selectedClipId ? 'selected' : ''} ${dragging ? 'dragging' : ''} ${m?.missing ? 'missing' : ''}`}
                        style={{
                          left,
                          width: clipDuration(clip) * pps,
                          backgroundImage: m?.thumbnail && m.kind !== 'audio' ? `url(${m.thumbnail})` : undefined,
                        }}
                        onPointerDown={(e) => startDrag(e, clip, 'move')}
                      >
                        {m?.peaks && <Waveform peaks={m.peaks} from={clip.in} to={clip.out} overlay={m.kind === 'video'} />}
                        <FadeMarks clip={clip} pps={pps} />
                        {transitionIn && <div className="tl-overlap" style={{ width: transitionIn.duration * pps }} />}
                        <div className="tl-handle left" onPointerDown={(e) => startDrag(e, clip, 'trim-l')} />
                        <span className="tl-clip-label">
                          {clip.speed !== 1 && <b className="tl-speed">⏩ {Number(clip.speed.toFixed(2))}x</b>}
                          {m?.missing && '⚠ '}
                          {m?.name ?? '(없음)'} · {formatTime(clipDuration(clip))}
                        </span>
                        <div className="tl-handle right" onPointerDown={(e) => startDrag(e, clip, 'trim-r')} />
                      </div>
                    );
                  })}
                {track.id === 'main' && !drag?.moved && (
                  <TransitionMarkers
                    project={shown}
                    windows={windows}
                    pps={pps}
                    selectedId={props.selectedTransitionId}
                    onPick={(clipId, exists) => {
                      if (!exists) {
                        dispatch({ type: 'setTransition', clipId, transition: DEFAULT_TRANSITION });
                        dispatch({ type: 'endMerge' });
                      }
                      props.onSelectTransition(clipId);
                    }}
                  />
                )}
              </div>
            ))}

            <Playhead pps={pps} scrollRef={scrollRef} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** 원본의 from~to 구간 음파를 클립 너비에 맞춰 그린다. */
const Waveform = memo(function Waveform({ peaks, from, to, overlay }: { peaks: Float32Array; from: number; to: number; overlay: boolean }) {
  const { d, width } = useMemo(() => {
    const a = Math.max(0, Math.floor(from * PEAKS_PER_SECOND));
    const b = Math.min(peaks.length, Math.ceil(to * PEAKS_PER_SECOND));
    // 아주 긴 클립도 가볍게 그리도록 점을 최대 1500개로 줄인다.
    const step = Math.max(1, Math.ceil((b - a) / 1500));
    const pts: [number, number][] = [];
    for (let i = a; i < b; i += step) {
      let v = 0;
      for (let j = i; j < Math.min(i + step, b); j++) v = Math.max(v, peaks[j]);
      pts.push([i - a, Math.max(v, 0.02)]);
    }
    const top = pts.map(([x, v]) => `L${x} ${50 - v * 48}`).join('');
    const bottom = pts.reverse().map(([x, v]) => `L${x} ${50 + v * 48}`).join('');
    return { d: `M0 50${top}${bottom}Z`, width: Math.max(1, b - a) };
  }, [peaks, from, to]);

  return (
    <svg className={`tl-wave ${overlay ? 'overlay' : ''}`} viewBox={`0 0 ${width} 100`} preserveAspectRatio="none">
      <path d={d} />
    </svg>
  );
});

function FadeMarks({ clip, pps }: { clip: Clip; pps: number }) {
  const { fadeIn, fadeOut } = effectiveFades(clip);
  return (
    <>
      {fadeIn > 0 && <div className="tl-fade in" style={{ width: fadeIn * pps }} />}
      {fadeOut > 0 && <div className="tl-fade out" style={{ width: fadeOut * pps }} />}
    </>
  );
}

interface TransitionMarkersProps {
  project: Project;
  windows: ReturnType<typeof transitionWindows>;
  pps: number;
  selectedId: string | null;
  /** exists: 이미 전환이 있는 경계인지 */
  onPick: (clipId: string, exists: boolean) => void;
}

/** 메인 트랙 클립 사이마다 전환 버튼을 둔다. 없으면 +, 있으면 효과 아이콘 */
function TransitionMarkers({ project, windows, pps, selectedId, onPick }: TransitionMarkersProps) {
  const mains = project.clips.filter((c) => c.track === 'main');
  return (
    <>
      {mains.slice(1).map((clip) => {
        const w = windows.get(clip.id)?.in;
        const center = (clip.start + (w?.duration ?? 0) / 2) * pps;
        const icon = w ? (TRANSITIONS.find((t) => t.type === w.type)?.icon ?? '⇄') : '+';
        return (
          <button
            key={clip.id}
            className={`tl-transition ${w ? 'on' : ''} ${selectedId === clip.id ? 'selected' : ''}`}
            style={{ left: center }}
            title={w ? `${transitionLabel(w.type)} · ${w.duration.toFixed(1)}초 (눌러서 바꾸기)` : '전환 효과 넣기'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPick(clip.id, !!w)}
          >
            {icon}
          </button>
        );
      })}
    </>
  );
}

/* ---------- 자막·텍스트 줄: 시작·끝만 있는 항목들 ---------- */

interface TimedItem {
  id: string;
  start: number;
  end: number;
  text: string;
}

/** 텍스트 줄 한 칸의 높이(px) */
const LANE_HEIGHT = 26;

/** 시간이 겹치는 항목은 서로 다른 줄에 놓는다. */
function assignLanes(items: TimedItem[]) {
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let lane = laneEnds.findIndex((end) => end <= it.start + 1e-6);
    if (lane < 0) lane = laneEnds.push(it.end) - 1;
    else laneEnds[lane] = it.end;
    lanes.set(it.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

type TimedDragKind = 'move' | 'trim-l' | 'trim-r';
interface TimedDrag {
  kind: TimedDragKind;
  item: TimedItem;
  originX: number;
  dx: number;
  moved: boolean;
}

function timedDragResult(d: TimedDrag, pps: number) {
  const dt = d.dx / pps;
  const { start, end } = d.item;
  switch (d.kind) {
    case 'move': {
      const s = Math.max(0, start + dt);
      return { start: s, end: s + (end - start) };
    }
    case 'trim-l':
      return { start: clamp(start + dt, 0, end - MIN_SUBTITLE_DURATION), end };
    case 'trim-r':
      return { start, end: Math.max(start + MIN_SUBTITLE_DURATION, end + dt) };
  }
}

interface TimedTrackProps {
  kind: 'subtitle' | 'text';
  items: TimedItem[];
  /** 텍스트 줄처럼 겹침을 여러 줄로 나눌 때 */
  lanes?: ReturnType<typeof assignLanes>;
  pps: number;
  selectedId: string | null;
  emptyLabel: string;
  hint: string;
  onSelect: (id: string) => void;
  /** 끌어서 옮기거나 길이를 바꾼 결과 */
  onCommit: (id: string, range: { start: number; end: number }) => void;
  onEmptyPointerDown: (clientX: number) => void;
  onEmptyDoubleClick: (clientX: number) => void;
}

/** 블록을 끌어 옮기고 양 끝을 끌어 시간을 맞춘다. 빈 곳을 더블클릭하면 새 항목 */
function TimedTrack(props: TimedTrackProps) {
  const { kind, items, lanes, pps, selectedId, onSelect, onCommit } = props;
  const [drag, setDrag] = useState<TimedDrag | null>(null);
  const dragRef = useRef<TimedDrag | null>(null);
  const update = (d: TimedDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.originX;
      update({ ...d, dx, moved: d.moved || Math.abs(dx) > DRAG_THRESHOLD });
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d?.moved) onCommit(d.item.id, timedDragResult(d, pps));
      update(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag !== null, pps, onCommit]);

  const startDrag = (e: React.PointerEvent, item: TimedItem, dragKind: TimedDragKind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelect(item.id);
    update({ kind: dragKind, item, originX: e.clientX, dx: 0, moved: false });
  };

  return (
    <div
      className={`tl-track ${kind}`}
      data-track={kind}
      style={lanes ? { height: lanes.count * LANE_HEIGHT + 4 } : undefined}
      title={props.hint}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && e.button === 0) props.onEmptyPointerDown(e.clientX);
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) props.onEmptyDoubleClick(e.clientX);
      }}
    >
      {items.map((item) => {
        const { start, end } = drag?.moved && drag.item.id === item.id ? timedDragResult(drag, pps) : item;
        const lane = lanes?.lanes.get(item.id);
        const laneStyle = lane === undefined ? {} : { top: lane * LANE_HEIGHT + 2, bottom: 'auto', height: LANE_HEIGHT - 4 };
        return (
          <div
            key={item.id}
            className={`tl-clip ${kind} ${item.id === selectedId ? 'selected' : ''}`}
            style={{ left: start * pps, width: (end - start) * pps, ...laneStyle }}
            onPointerDown={(e) => startDrag(e, item, 'move')}
            title={item.text}
          >
            <div className="tl-handle left" onPointerDown={(e) => startDrag(e, item, 'trim-l')} />
            <span className="tl-sub-text">{item.text.split('\n')[0] || props.emptyLabel}</span>
            <div className="tl-handle right" onPointerDown={(e) => startDrag(e, item, 'trim-r')} />
          </div>
        );
      })}
    </div>
  );
}

function Playhead({ pps, scrollRef }: { pps: number; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const time = usePlaybackTime();
  const playing = usePlaying();
  const x = time * pps;

  // 재생 중 재생헤드가 화면 밖으로 나가면 따라간다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = x - 40;
  }, [x, playing, scrollRef]);

  return (
    <div className="tl-playhead" style={{ transform: `translateX(${x}px)` }}>
      <div className="tl-playhead-head" />
    </div>
  );
}

function TimeDisplay() {
  const time = usePlaybackTime();
  return (
    <span className="tl-time">
      {formatTime(time)} / {formatTime(playback.getDuration())}
    </span>
  );
}
