import type { Clip, MediaItem } from '../types';
import { clipDuration, MAX_SPEED, MAX_VOLUME, MIN_SPEED, type HistoryAction } from '../state/project';
import { formatTime } from '../utils/media';

const KIND_LABEL = { video: '영상', audio: '오디오', image: '이미지' } as const;
const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4, 8];

// 슬라이더는 로그 눈금: 가운데가 1배, 왼쪽 끝 0.1배, 오른쪽 끝 10배
const speedToSlider = (s: number) => Math.log10(s);
const sliderToSpeed = (v: number) => {
  const s = 10 ** v;
  // 1배 근처에서는 딱 1배에 붙도록
  return Math.abs(s - 1) < 0.04 ? 1 : Math.round(s * 100) / 100;
};
const formatSpeed = (s: number) => `${Number(s.toFixed(2))}x`;
const VOLUME_PRESETS = [0, 0.5, 1, 1.5];
const MAX_FADE = 10;

interface Props {
  clip: Clip | null;
  media: MediaItem | null;
  dispatch: (a: HistoryAction) => void;
  /** 오디오 클립을 영상 끝에 맞춘다. 메인 트랙이 비어 있으면 undefined */
  onFitToVideo?: (mode: 'trim' | 'loop') => void;
}

export default function Inspector({ clip, media, dispatch, onFitToVideo }: Props) {
  const setSpeed = (speed: number) => clip && dispatch({ type: 'setSpeed', clipId: clip.id, speed });
  const endMerge = () => dispatch({ type: 'endMerge' });
  const setAudio = (patch: { volume?: number; fadeIn?: number; fadeOut?: number }) =>
    clip && dispatch({ type: 'setAudio', clipId: clip.id, ...patch });
  const maxFade = clip ? Math.min(MAX_FADE, Math.floor(clipDuration(clip) * 10) / 10) : 0;

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <h2>{clip ? '클립 속성' : '속성'}</h2>
      </div>
      {!media ? (
        <p className="muted">선택된 항목이 없습니다</p>
      ) : (
        <div className="inspector-body">
          {clip && media.kind !== 'image' && (
            <section className="prop-section">
              <div className="prop-title">
                <span>⏩ 속도</span>
                <strong className="speed-value">{formatSpeed(clip.speed)}</strong>
              </div>
              <input
                className="speed-slider"
                type="range"
                min={speedToSlider(MIN_SPEED)}
                max={speedToSlider(MAX_SPEED)}
                step={0.01}
                value={speedToSlider(clip.speed)}
                onChange={(e) => setSpeed(sliderToSpeed(Number(e.target.value)))}
                onPointerUp={endMerge}
                onKeyUp={endMerge}
              />
              <div className="speed-scale">
                <span>{MIN_SPEED}x</span>
                <span>1x</span>
                <span>{MAX_SPEED}x</span>
              </div>
              <div className="speed-presets">
                {SPEED_PRESETS.map((s) => (
                  <button
                    key={s}
                    className={`chip ${clip.speed === s ? 'active' : ''}`}
                    onClick={() => {
                      setSpeed(s);
                      endMerge();
                    }}
                  >
                    {formatSpeed(s)}
                  </button>
                ))}
              </div>
              <p className="prop-hint">
                원본 {formatTime((clip.out - clip.in))} → 타임라인 {formatTime(clipDuration(clip))}
                <br />
                소리는 음 높이가 그대로 유지돼요.
              </p>
            </section>
          )}

          {clip && media.kind !== 'image' && (
            <section className="prop-section">
              <div className="prop-title">
                <span>🔊 볼륨</span>
                <strong className="speed-value">{Math.round(clip.volume * 100)}%</strong>
              </div>
              <input
                className="speed-slider"
                type="range"
                min={0}
                max={MAX_VOLUME}
                step={0.01}
                value={clip.volume}
                onChange={(e) => setAudio({ volume: Number(e.target.value) })}
                onPointerUp={endMerge}
                onKeyUp={endMerge}
              />
              <div className="speed-presets">
                {VOLUME_PRESETS.map((v) => (
                  <button
                    key={v}
                    className={`chip ${clip.volume === v ? 'active' : ''}`}
                    onClick={() => {
                      setAudio({ volume: v });
                      endMerge();
                    }}
                  >
                    {v === 0 ? '🔇 음소거' : `${v * 100}%`}
                  </button>
                ))}
              </div>

              {(['fadeIn', 'fadeOut'] as const).map((key) => (
                <label key={key} className="fade-row">
                  <span>{key === 'fadeIn' ? '페이드 인' : '페이드 아웃'}</span>
                  <input
                    type="range"
                    min={0}
                    max={maxFade}
                    step={0.1}
                    value={Math.min(clip[key], maxFade)}
                    onChange={(e) => setAudio({ [key]: Number(e.target.value) })}
                    onPointerUp={endMerge}
                    onKeyUp={endMerge}
                  />
                  <span className="fade-value">{clip[key].toFixed(1)}초</span>
                </label>
              ))}

              {clip.track === 'audio' && (
                <div className="fit-actions">
                  <button className="btn" disabled={!onFitToVideo} onClick={() => onFitToVideo?.('trim')}>
                    ✂ 영상 길이에 맞추기
                  </button>
                  <button className="btn" disabled={!onFitToVideo} onClick={() => onFitToVideo?.('loop')}>
                    🔁 반복해서 채우기
                  </button>
                </div>
              )}
              <p className="prop-hint">
                미리보기는 100%까지만 크게 들려요. 100%가 넘는 볼륨은 내보낸 영상에 반영돼요.
              </p>
            </section>
          )}

          <dl className="props">
            <dt>이름</dt>
            <dd title={media.name}>{media.name}</dd>
            <dt>종류</dt>
            <dd>{KIND_LABEL[media.kind]}</dd>
            {clip ? (
              <>
                <dt>시작</dt>
                <dd>{formatTime(clip.start)}</dd>
                <dt>길이</dt>
                <dd>{formatTime(clipDuration(clip))}</dd>
                {media.kind !== 'image' && (
                  <>
                    <dt>원본 구간</dt>
                    <dd>
                      {formatTime(clip.in)} ~ {formatTime(clip.out)}
                    </dd>
                  </>
                )}
              </>
            ) : (
              media.duration !== undefined && (
                <>
                  <dt>길이</dt>
                  <dd>{formatTime(media.duration)}</dd>
                </>
              )
            )}
            {media.width && (
              <>
                <dt>해상도</dt>
                <dd>
                  {media.width} × {media.height}
                </dd>
              </>
            )}
            <dt>경로</dt>
            <dd className="path" title={media.path}>
              {media.path || '-'}
            </dd>
          </dl>
        </div>
      )}
    </aside>
  );
}
