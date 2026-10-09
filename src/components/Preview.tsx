import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Clip, MediaItem, Project } from '../types';
import { clipEnd, fadeGain, transitionWindows, type HistoryAction, type TransitionWindow } from '../state/project';
import { drawOverlay, type Box } from '../utils/graphics';
import { transitionLook } from '../utils/transitions';
import { playback, useMuted, usePlaybackTime, usePlaying } from '../state/playback';
import { formatTime } from '../utils/media';

interface Props {
  project: Project;
  media: Map<string, MediaItem>;
  /** 타임라인이 비었을 때 화면에 보여 줄 내용 */
  emptyContent?: React.ReactNode;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  dispatch: (a: HistoryAction) => void;
  /** 미리보기 화면에 파일을 끌어다 놓았을 때 */
  onDropFiles?: (files: File[]) => void;
}

/** 재생 중 원본 위치가 이만큼 어긋나면 다시 맞춘다 */
const DRIFT_TOLERANCE = 0.3;
/** 다음 클립을 미리 원하는 위치로 옮겨 둘 시간 */
const PRELOAD_AHEAD = 1;

const isActive = (c: Clip, t: number) => t >= c.start && t < clipEnd(c);

interface ClipLook {
  style: CSSProperties;
  /** 전환 중 소리 배율 (앞 클립은 줄고 뒤 클립은 커진다) */
  gain: number;
  matte?: string;
}

/** 시각 t에서 전환이 적용된 클립의 모양과 소리 배율 */
function clipLook(t: number, w?: { in?: TransitionWindow; out?: TransitionWindow }): ClipLook {
  const look: ClipLook = { style: {}, gain: 1 };
  if (w?.in && t < w.in.start + w.in.duration) {
    const q = (t - w.in.start) / w.in.duration;
    const l = transitionLook(w.in.type, q);
    Object.assign(look.style, l.in);
    look.gain *= q;
    look.matte = l.matte;
  }
  if (w?.out && t >= w.out.start) {
    const q = (t - w.out.start) / w.out.duration;
    const l = transitionLook(w.out.type, q);
    Object.assign(look.style, l.out);
    look.gain *= 1 - q;
    look.matte ??= l.matte;
  }
  return look;
}

export default function Preview({
  project,
  media,
  emptyContent,
  selectedTextId,
  onSelectText,
  dispatch,
  onDropFiles,
}: Props) {
  const [dropping, setDropping] = useState(false);
  const time = usePlaybackTime();
  const playing = usePlaying();
  const muted = useMuted();
  const [volume, setVolume] = useState(1);
  const elements = useRef(new Map<string, HTMLMediaElement>());

  const duration = playback.getDuration();
  const visualClips = project.clips.filter((c) => c.track === 'main');
  const audioClips = project.clips.filter((c) => c.track !== 'main');
  const windows = useMemo(() => transitionWindows(project), [project]);
  const looks = new Map(visualClips.filter((c) => isActive(c, time)).map((c) => [c.id, clipLook(time, windows.get(c.id))]));
  const matte = [...looks.values()].find((l) => l.matte)?.matte;

  // 재생 시계에 맞춰 각 클립의 <video>/<audio>를 재생·정지·위치 이동시킨다.
  useLayoutEffect(() => {
    for (const clip of project.clips) {
      const el = elements.current.get(clip.id);
      if (!el) continue;

      if (isActive(clip, time)) {
        const desired = clip.in + (time - clip.start) * clip.speed;
        const drift = Math.abs(el.currentTime - desired);
        el.playbackRate = clip.speed;
        el.preservesPitch = true; // 빠르게 돌려도 목소리가 높아지지 않게
        // 미리보기는 브라우저 한계로 100%까지만 들린다. 내보낸 영상에는 200%까지 반영된다.
        const transitionGain = looks.get(clip.id)?.gain ?? 1;
        el.volume = muted ? 0 : Math.min(1, volume * clip.volume * fadeGain(clip, time) * transitionGain);
        if (playing) {
          if (drift > DRIFT_TOLERANCE * Math.max(1, clip.speed)) el.currentTime = desired;
          if (el.paused) el.play().catch(() => {});
        } else {
          if (!el.paused) el.pause();
          if (drift > 0.01) el.currentTime = desired;
        }
      } else {
        if (!el.paused) el.pause();
        const upcoming = clip.start > time && clip.start - time < PRELOAD_AHEAD;
        if (upcoming && Math.abs(el.currentTime - clip.in) > 0.05) el.currentTime = clip.in;
      }
    }
  }, [project, time, playing, volume, muted]);

  const registerElement = (id: string) => (el: HTMLMediaElement | null) => {
    if (el) elements.current.set(id, el);
    else elements.current.delete(id);
  };

  return (
    <section className="preview">
      <div
        className={`stage ${dropping ? 'dropping' : ''}`}
        onDragOver={(e) => {
          if (!onDropFiles || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          if (!onDropFiles || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          setDropping(false);
          onDropFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="frame">
          {project.clips.length === 0 && (
            <div className="stage-empty">{emptyContent ?? '미디어를 아래 타임라인으로 끌어다 놓으세요'}</div>
          )}
          {matte && <div className="matte" style={{ background: matte }} />}
          {visualClips.map((clip, index) => {
            const m = media.get(clip.mediaId);
            if (!m || m.missing) return null;
            const look = looks.get(clip.id);
            const className = `layer ${look ? 'active' : ''}`;
            // 뒤 클립이 위에 오도록 쌓는다 (전환 중에는 들어오는 클립이 위)
            const style = { ...look?.style, zIndex: index + 1 };
            return m.kind === 'video' ? (
              <video
                key={clip.id}
                ref={registerElement(clip.id)}
                className={className}
                style={style}
                src={m.url}
                preload="auto"
                crossOrigin="anonymous"
              />
            ) : (
              <img key={clip.id} className={className} style={style} src={m.url} alt="" crossOrigin="anonymous" />
            );
          })}
          {audioClips.map((clip) => {
            const m = media.get(clip.mediaId);
            return m && !m.missing ? (
              <audio key={clip.id} ref={registerElement(clip.id)} src={m.url} preload="auto" crossOrigin="anonymous" />
            ) : null;
          })}
          <GraphicsOverlay
            project={project}
            time={time}
            selectedTextId={selectedTextId}
            onSelectText={onSelectText}
            dispatch={dispatch}
          />
        </div>
      </div>

      <div className="controls">
        <button className="btn icon" onClick={playback.toggle} disabled={duration <= 0} title="재생/일시정지 (Space)">
          {playing ? '⏸' : '▶'}
        </button>
        <span className="time">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          disabled={duration <= 0}
          onChange={(e) => playback.seek(Number(e.target.value))}
        />
        <span className="volume">
          🔊
          <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
        </span>
      </div>
    </section>
  );
}

/** 가운데에 이만큼 가까우면 딱 붙인다 (화면 비율) */
const SNAP = 0.02;

interface OverlayProps {
  project: Project;
  time: number;
  selectedTextId: string | null;
  onSelectText: (id: string | null) => void;
  dispatch: (a: HistoryAction) => void;
}

/**
 * 텍스트 레이어와 자막을 내보내기와 같은 방식(캔버스)으로 그린다.
 * 텍스트를 눌러 선택하고, 끌어서 위치를 옮길 수 있다.
 */
function GraphicsOverlay({ project, time, selectedTextId, onSelectText, dispatch }: OverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const boxes = useRef(new Map<string, Box>());
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: Math.round(width * devicePixelRatio), h: Math.round(height * devicePixelRatio) });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    canvas.width = size.w;
    canvas.height = size.h;
    ctx.clearRect(0, 0, size.w, size.h);
    boxes.current = drawOverlay(ctx, size.w, size.h, project, time, { subtitles: true }).boxes;

    // 선택한 텍스트는 점선 테두리로 표시 (미리보기에만)
    const box = selectedTextId ? boxes.current.get(selectedTextId) : undefined;
    if (box) {
      ctx.save();
      ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.strokeStyle = '#19c3c3';
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }, [project, time, size, selectedTextId]);

  /** 마우스 위치 → 캔버스 픽셀 좌표 */
  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * size.w, y: ((e.clientY - rect.top) / rect.height) * size.h };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = toCanvas(e);
    // 위에 그려진(뒤쪽) 텍스트부터 찾는다
    const hit = [...project.texts].reverse().find((l) => {
      const b = boxes.current.get(l.id);
      return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    if (!hit) {
      onSelectText(null);
      return;
    }
    onSelectText(hit.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: hit.id, startX: e.clientX, startY: e.clientY, x: hit.x, y: hit.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = d.x + (e.clientX - d.startX) / rect.width;
    let y = d.y + (e.clientY - d.startY) / rect.height;
    if (Math.abs(x - 0.5) < SNAP) x = 0.5;
    if (Math.abs(y - 0.5) < SNAP) y = 0.5;
    dispatch({ type: 'updateText', id: d.id, patch: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } });
  };

  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    dispatch({ type: 'endMerge' });
  };

  return (
    <canvas
      ref={canvasRef}
      className="graphics-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
