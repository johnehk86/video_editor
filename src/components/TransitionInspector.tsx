import type { Clip, Transition } from '../types';
import type { HistoryAction } from '../state/project';
import { DEFAULT_TRANSITION, MAX_TRANSITION, MIN_TRANSITION, TRANSITIONS } from '../utils/transitions';

interface Props {
  /** 전환이 들어오는(뒤) 클립 */
  clip: Clip;
  /** 실제로 겹치는 길이 (클립이 짧으면 설정값보다 줄어든다) */
  effectiveDuration: number;
  dispatch: (a: HistoryAction) => void;
  onRemoved: () => void;
}

export default function TransitionInspector({ clip, effectiveDuration, dispatch, onRemoved }: Props) {
  const transition = clip.transition ?? DEFAULT_TRANSITION;
  const set = (patch: Partial<Transition>) =>
    dispatch({ type: 'setTransition', clipId: clip.id, transition: { ...transition, ...patch } });
  const endMerge = () => dispatch({ type: 'endMerge' });
  const shortened = effectiveDuration + 0.001 < transition.duration;

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <h2>전환 효과</h2>
      </div>
      <div className="inspector-body">
        <section className="prop-section">
          <div className="transition-grid">
            {TRANSITIONS.map((t) => (
              <button
                key={t.type}
                className={`transition-card ${transition.type === t.type ? 'active' : ''}`}
                onClick={() => {
                  set({ type: t.type });
                  endMerge();
                }}
              >
                <span className="transition-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="prop-section">
          <label className="fade-row">
            <span>길이</span>
            <input
              type="range"
              min={MIN_TRANSITION}
              max={MAX_TRANSITION}
              step={0.1}
              value={transition.duration}
              onChange={(e) => set({ duration: Number(e.target.value) })}
              onPointerUp={endMerge}
              onKeyUp={endMerge}
            />
            <span className="fade-value">{transition.duration.toFixed(1)}초</span>
          </label>
          {shortened && (
            <p className="prop-hint warn-text">
              클립이 짧아서 실제로는 {effectiveDuration.toFixed(2)}초만 적용돼요. (전환은 각 클립 길이의 절반까지)
            </p>
          )}
          <p className="prop-hint">전환 길이만큼 두 클립이 겹쳐서, 전체 영상이 그만큼 짧아져요.</p>
        </section>

        <section className="prop-section transition-actions">
          <button
            className="btn"
            onClick={() => {
              dispatch({ type: 'setAllTransitions', transition });
              endMerge();
            }}
          >
            모든 클립 사이에 적용
          </button>
          <button
            className="btn danger"
            onClick={() => {
              dispatch({ type: 'setTransition', clipId: clip.id, transition: null });
              onRemoved();
            }}
          >
            전환 없애기
          </button>
        </section>
      </div>
    </aside>
  );
}
