import type { Subtitle, SubtitlePosition, SubtitleStyle } from '../types';
import { MIN_SUBTITLE_DURATION, type HistoryAction } from '../state/project';
import { playback } from '../state/playback';

interface Props {
  subtitle: Subtitle;
  style: SubtitleStyle;
  dispatch: (a: HistoryAction) => void;
}

const POSITIONS: { id: SubtitlePosition; label: string }[] = [
  { id: 'top', label: '위' },
  { id: 'middle', label: '가운데' },
  { id: 'bottom', label: '아래' },
];
const COLORS = ['#ffffff', '#ffe14d', '#7df9ff', '#ff8fb1'];

export default function SubtitleInspector({ subtitle, style, dispatch }: Props) {
  const update = (patch: { text?: string; start?: number; end?: number }) =>
    dispatch({ type: 'updateSubtitle', id: subtitle.id, ...patch });
  const setStyle = (patch: Partial<SubtitleStyle>) => dispatch({ type: 'setSubtitleStyle', patch });
  const endMerge = () => dispatch({ type: 'endMerge' });

  const timeInput = (key: 'start' | 'end', label: string) => (
    <label className="time-input">
      <span>{label}</span>
      <input
        type="number"
        step={0.1}
        min={key === 'end' ? subtitle.start + MIN_SUBTITLE_DURATION : 0}
        value={Number(subtitle[key].toFixed(2))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) update({ [key]: v });
        }}
        onBlur={endMerge}
      />
      <span className="unit">초</span>
    </label>
  );

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <h2>자막 속성</h2>
      </div>
      <div className="inspector-body">
        <section className="prop-section">
          <div className="prop-title">
            <span>💬 내용</span>
          </div>
          <textarea
            className="sub-edit"
            rows={3}
            value={subtitle.text}
            placeholder="자막 내용 (Enter로 줄바꿈)"
            onChange={(e) => update({ text: e.target.value })}
            onBlur={endMerge}
          />
          <div className="time-inputs">
            {timeInput('start', '시작')}
            {timeInput('end', '끝')}
          </div>
          <div className="speed-presets">
            <button
              className="chip"
              onClick={() => {
                update({ start: playback.getTime() });
                endMerge();
              }}
            >
              ⇤ 시작을 재생헤드로
            </button>
            <button
              className="chip"
              onClick={() => {
                update({ end: playback.getTime() });
                endMerge();
              }}
            >
              끝을 재생헤드로 ⇥
            </button>
          </div>
        </section>

        <section className="prop-section">
          <div className="prop-title">
            <span>🎨 스타일</span>
            <span className="prop-hint-inline">모든 자막에 적용</span>
          </div>

          <label className="fade-row">
            <span>글자 크기</span>
            <input
              type="range"
              min={3}
              max={10}
              step={0.1}
              value={style.fontSize}
              onChange={(e) => setStyle({ fontSize: Number(e.target.value) })}
              onPointerUp={endMerge}
              onKeyUp={endMerge}
            />
            <span className="fade-value">{style.fontSize.toFixed(1)}</span>
          </label>

          <div className="style-row">
            <span>위치</span>
            <div className="speed-presets inline">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${style.position === p.id ? 'active' : ''}`}
                  onClick={() => setStyle({ position: p.id })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="style-row">
            <span>글자 색</span>
            <div className="speed-presets inline">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${style.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setStyle({ color: c })}
                />
              ))}
              <input
                className="color-input"
                type="color"
                value={style.color}
                onChange={(e) => setStyle({ color: e.target.value })}
                onBlur={endMerge}
                title="직접 고르기"
              />
            </div>
          </div>

          {(
            [
              ['outline', '검은 외곽선'],
              ['background', '반투명 배경 상자'],
              ['bold', '굵게'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={style[key]} onChange={(e) => setStyle({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </section>
      </div>
    </aside>
  );
}
