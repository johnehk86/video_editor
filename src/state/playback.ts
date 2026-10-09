import { useSyncExternalStore } from 'react';

/*
 * 재생 시계. 매 프레임 바뀌는 값이라 React 상태 대신 외부 스토어로 두고,
 * 시간이 필요한 컴포넌트(재생헤드, 미리보기, 시간 표시)만 구독한다.
 */

let time = 0;
let playing = false;
let muted = false;
let duration = 0;
let rafId = 0;
let lastTs = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function tick(now: number) {
  time = Math.min(duration, time + (now - lastTs) / 1000);
  lastTs = now;
  if (time >= duration) {
    playing = false;
    emit();
    return;
  }
  emit();
  rafId = requestAnimationFrame(tick);
}

export const playback = {
  getTime: () => time,
  isPlaying: () => playing,
  getDuration: () => duration,
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setDuration(d: number) {
    duration = d;
    time = Math.min(time, d);
    emit();
  },
  seek(t: number) {
    time = Math.min(Math.max(0, t), duration);
    emit();
  },
  play() {
    if (playing || duration <= 0) return;
    if (time >= duration - 0.01) time = 0;
    playing = true;
    lastTs = performance.now();
    rafId = requestAnimationFrame(tick);
    emit();
  },
  pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    emit();
  },
  toggle() {
    if (playing) playback.pause();
    else playback.play();
  },
};

export const usePlaybackTime = () => useSyncExternalStore(playback.subscribe, playback.getTime);
export const usePlaying = () => useSyncExternalStore(playback.subscribe, playback.isPlaying);
export const useMuted = () => useSyncExternalStore(playback.subscribe, playback.isMuted);
