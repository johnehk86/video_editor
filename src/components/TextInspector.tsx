import type { TextAnimation, TextLayer } from '../types';
import { MIN_SUBTITLE_DURATION, type HistoryAction } from '../state/project';
import { playback } from '../state/playback';
import { FONTS, TEXT_ANIMATIONS } from '../utils/graphics';

interface Props {
  layer: TextLayer;
  dispatch: (a: HistoryAction) => void;
  onRemove: () => void;
}

const COLORS = ['#ffffff', '#ffe14d', '#ff5c6c', '#7df9ff', '#8cff7a', '#000000'];
const POSITIONS = [
  { label: '위', y: 0.15 },
  { label: '가운데', y: 0.5 },
  { label: '아래', y: 0.85 },
];

export default function TextInspector({ layer, dispatch, onRemove }: Props) {
  const set = (patch: Partial<Omit<TextLayer, 'id'>>) => dispatch({ type: 'updateText', id: layer.id, patch });
  const endMerge = () => dispatch({ type: 'endMerge' });
  /** 버튼처럼 한 번에 끝나는 변경 */
  const setOnce = (patch: Partial<Omit<TextLayer, 'id'>>) => {
    set(patch);
    endMerge();
  };

  const timeInput = (key: 'start' | 'end', label: string) => (
    <label className="time-input">
      <span>{label}</span>
      <input
        type="number"
        step={0.1}
        min={key === 'end' ? layer.start + MIN_SUBTITLE_DURATION : 0}
        value={Number(layer[key].toFixed(2))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) set({ [key]: v });
        }}
        onBlur={endMerge}
      />
      <span className="unit">초</span>
    </label>
  );

  const animationChips = (key: 'animIn' | 'animOut') => (
    <div className="speed-presets inline">
      {TEXT_ANIMATIONS.map((a) => (
        <button
          key={a.id}
          className={`chip ${layer[key] === a.id ? 'active' : ''}`}
          onClick={() => setOnce({ [key]: a.id as TextAnimation })}
        >
          {a.label}
        </button>
      ))}
    </div>
  );

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <h2>텍스트</h2>
      </div>
      <div className="inspector-body">
        <section className="prop-section">
          <textarea
            className="sub-edit"
            rows={3}
            value={layer.text}
            placeholder="글자를 입력하세요 (Enter로 줄바꿈)"
            onChange={(e) => set({ text: e.target.value })}
            onBlur={endMerge}
          />
          <p className="prop-hint">미리보기 화면에서 글자를 끌어 위치를 옮길 수 있어요.</p>
        </section>

        <section className="prop-section">
          <div className="style-row">
            <span>글꼴</span>
            <select className="select" value={layer.font} onChange={(e) => setOnce({ font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <label className="fade-row">
            <span>크기</span>
            <input
              type="range"
              min={2}
              max={25}
              step={0.5}
              value={layer.fontSize}
              onChange={(e) => set({ fontSize: Number(e.target.value) })}
              onPointerUp={endMerge}
              onKeyUp={endMerge}
            />
            <span className="fade-value">{layer.fontSize.toFixed(1)}</span>
          </label>

          <div className="style-row">
            <span>색</span>
            <div className="speed-presets inline">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch ${layer.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setOnce({ color: c })}
                />
              ))}
              <input
                className="color-input"
                type="color"
                value={layer.color}
                onChange={(e) => set({ color: e.target.value })}
                onBlur={endMerge}
                title="직접 고르기"
              />
            </div>
          </div>

          <div className="style-row">
            <span>위치</span>
            <div className="speed-presets inline">
              {POSITIONS.map((p) => (
                <button
                  key={p.label}
                  className={`chip ${Math.abs(layer.y - p.y) < 0.01 && layer.x === 0.5 ? 'active' : ''}`}
                  onClick={() => setOnce({ x: 0.5, y: p.y })}
                >
                  {p.label}
                </button>
              ))}
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
              <input type="checkbox" checked={layer[key]} onChange={(e) => setOnce({ [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </section>

        <section className="prop-section">
          <div className="style-row">
            <span>등장</span>
            {animationChips('animIn')}
          </div>
          <div className="style-row">
            <span>퇴장</span>
            {animationChips('animOut')}
          </div>
        </section>

        <section className="prop-section">
          <div className="time-inputs">
            {timeInput('start', '시작')}
            {timeInput('end', '끝')}
          </div>
          <div className="speed-presets">
            <button className="chip" onClick={() => setOnce({ start: playback.getTime() })}>
              ⇤ 시작을 재생헤드로
            </button>
            <button className="chip" onClick={() => setOnce({ end: playback.getTime() })}>
              끝을 재생헤드로 ⇥
            </button>
          </div>
        </section>

        <section className="prop-section transition-actions">
          <button className="btn danger" onClick={onRemove}>
            텍스트 삭제
          </button>
        </section>
      </div>
    </aside>
  );
}
