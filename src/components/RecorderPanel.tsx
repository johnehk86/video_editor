import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../types';
import { playback } from '../state/playback';
import { decodeAudio, formatTime, mediaUrl } from '../utils/media';

interface Props {
  /** 녹음이 저장되면 호출. start는 녹음을 시작한 타임라인 시각 */
  onRecorded: (item: MediaItem, start: number) => void;
  /** 카운트다운·녹음·저장 중에는 true (단축키를 막기 위해) */
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
}

type Phase = 'idle' | 'countdown' | 'recording' | 'saving';

const COUNTDOWN_SECONDS = 3;
const DEVICE_KEY = 'recorder-device';

function loadSetting(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장하지 못해도 녹음에는 지장이 없다.
  }
}

/** 0~1 진폭을 -60dB~0dB 막대 길이로 바꾼다 */
const levelToWidth = (peak: number) => Math.max(0, Math.min(1, (20 * Math.log10(peak || 1e-6) + 60) / 60));

export default function RecorderPanel({ onRecorded, onBusyChange, onClose }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(() => loadSetting(DEVICE_KEY, 'default'));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playAlong, setPlayAlong] = useState(true);
  const [muteWhileRecording, setMuteWhileRecording] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const countdownTimer = useRef<number>(0);

  useEffect(() => onBusyChange(phase !== 'idle'), [phase, onBusyChange]);

  // 마이크 열기 (장치를 바꾸면 다시 연다)
  useEffect(() => {
    let cancelled = false;
    let opened: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        opened = s;
        setStream(s);
        setError(null);
        // 장치 이름은 마이크 권한을 받은 뒤에야 보인다.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'audioinput'));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setStream(null);
        setError(
          `마이크를 열 수 없어요. 마이크가 연결되어 있는지, Windows 설정 > 개인 정보 및 보안 > 마이크에서 데스크톱 앱의 접근이 허용되어 있는지 확인해 주세요. (${e.message})`,
        );
      });
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  // 입력 레벨 표시
  useEffect(() => {
    if (!stream) return;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      setLevel(peak);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ctx.close();
    };
  }, [stream]);

  // 녹음 시간 표시
  useEffect(() => {
    if (phase !== 'recording') return;
    const startedAt = performance.now();
    const id = window.setInterval(() => setElapsed((performance.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(id);
  }, [phase]);

  // 창을 닫으면 카운트다운·재생 상태를 정리한다.
  useEffect(
    () => () => {
      window.clearTimeout(countdownTimer.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      playback.setMuted(false);
    },
    [],
  );

  const finish = async () => {
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    try {
      const saved = await window.editorApi.saveRecording(await blob.arrayBuffer());
      const url = mediaUrl(saved.path);
      const decoded = await decodeAudio(url);
      onRecorded(
        {
          id: crypto.randomUUID(),
          name: saved.name,
          kind: 'audio',
          url,
          path: saved.path,
          duration: decoded?.duration,
          peaks: decoded?.peaks,
        },
        startTimeRef.current,
      );
    } catch (e) {
      setError(`녹음을 저장하지 못했어요. (${(e as Error).message})`);
    }
    setPhase('idle');
  };

  const begin = () => {
    if (!stream) return;
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = finish;
    recorderRef.current = recorder;

    if (playAlong) {
      playback.setMuted(muteWhileRecording);
      playback.play();
    }
    // play()가 끝 지점에서 처음으로 되감을 수 있으므로 재생을 시작한 뒤의 시각을 쓴다.
    startTimeRef.current = playback.getTime();
    recorder.start(250);
    setElapsed(0);
    setPhase('recording');
  };

  const startCountdown = () => {
    playback.pause();
    setError(null);
    setPhase('countdown');
    let n = COUNTDOWN_SECONDS;
    setCountdown(n);
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        begin();
        return;
      }
      setCountdown(n);
      countdownTimer.current = window.setTimeout(tick, 1000);
    };
    countdownTimer.current = window.setTimeout(tick, 1000);
  };

  const stop = () => {
    if (phase === 'countdown') {
      window.clearTimeout(countdownTimer.current);
      setPhase('idle');
      return;
    }
    setPhase('saving');
    playback.pause();
    playback.setMuted(false);
    recorderRef.current?.stop();
  };

  const busy = phase !== 'idle';

  return (
    <div className="recorder">
      <div className="recorder-header">
        <h2>🎙 음성 녹음</h2>
        <button className="btn icon" onClick={onClose} disabled={busy} title="닫기">
          ×
        </button>
      </div>

      <label className="field">
        <span>마이크</span>
        <select
          value={deviceId}
          disabled={busy}
          onChange={(e) => {
            setDeviceId(e.target.value);
            saveSetting(DEVICE_KEY, e.target.value);
          }}
        >
          <option value="default">기본 마이크</option>
          {devices
            .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || '이름 없는 마이크'}
              </option>
            ))}
        </select>
      </label>

      <div className="meter" title="입력 소리 크기">
        <div className={`meter-bar ${level > 0.9 ? 'clip' : ''}`} style={{ width: `${levelToWidth(level) * 100}%` }} />
      </div>
      <p className="modal-note">말해 보세요. 막대가 빨갛게 되면 너무 큰 소리예요.</p>

      <label className="check">
        <input type="checkbox" checked={playAlong} disabled={busy} onChange={(e) => setPlayAlong(e.target.checked)} />
        재생헤드 위치부터 영상을 재생하면서 녹음
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={muteWhileRecording}
          disabled={busy || !playAlong}
          onChange={(e) => setMuteWhileRecording(e.target.checked)}
        />
        녹음하는 동안 영상 소리 끄기 (헤드폰이 없으면 켜 두세요)
      </label>

      {error && <p className="recorder-error">{error}</p>}

      <div className="recorder-actions">
        {phase === 'idle' && (
          <button className="record-btn" onClick={startCountdown} disabled={!stream}>
            ● 녹음 시작
          </button>
        )}
        {phase === 'countdown' && (
          <button className="record-btn counting" onClick={stop} title="취소">
            {countdown}
          </button>
        )}
        {phase === 'recording' && (
          <button className="record-btn recording" onClick={stop}>
            ■ 정지 · {formatTime(elapsed)}
          </button>
        )}
        {phase === 'saving' && <span className="modal-note">저장하는 중…</span>}
      </div>
    </div>
  );
}
