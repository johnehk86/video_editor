import type { MediaItem, MediaKind } from '../types';

export const ACCEPTED_TYPES = 'video/*,audio/*,image/*';

/** 로컬 파일을 렌더러에서 읽는 주소 (electron/mediaProtocol.cjs 가 제공) */
export const mediaUrl = (filePath: string) => `media://local/${encodeURIComponent(filePath)}`;

/** 경로에서 폴더 부분 */
export const folderOf = (filePath: string) => filePath.slice(0, Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')));

function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

/** 영상의 길이·해상도를 읽고 썸네일 한 장을 캡처한다. */
function probeVideo(url: string): Promise<Pick<MediaItem, 'duration' | 'width' | 'height' | 'thumbnail'>> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    // media:// 는 다른 출처라서, 캔버스로 썸네일을 뽑으려면 CORS 모드로 읽어야 한다.
    video.crossOrigin = 'anonymous';
    video.src = url;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, video.duration / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      const scale = 160 / video.videoWidth;
      canvas.width = 160;
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        thumbnail: canvas.toDataURL('image/jpeg', 0.7),
      });
    };
    video.onerror = () => resolve({});
  });
}

function probeAudio(url: string): Promise<Pick<MediaItem, 'duration'>> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    audio.onloadedmetadata = () => resolve({ duration: audio.duration });
    audio.onerror = () => resolve({});
  });
}

/** 길이·해상도·썸네일 등 파일을 읽어야 알 수 있는 정보 */
async function probe(kind: MediaKind, url: string): Promise<Partial<MediaItem>> {
  if (kind === 'video') return probeVideo(url);
  if (kind === 'audio') return probeAudio(url);
  return { thumbnail: url };
}

export async function createMediaItem(file: File): Promise<{ item: MediaItem; size: number } | null> {
  const kind = detectKind(file);
  if (!kind) return null;

  // 디스크 경로가 있으면 media:// 로 읽는다. 그래야 프로젝트를 저장했다가 다시 열 수 있다.
  const path = window.editorApi?.getPathForFile(file) ?? '';
  const url = path ? mediaUrl(path) : URL.createObjectURL(file);
  const base: MediaItem = { id: crypto.randomUUID(), name: file.name, kind, url, path };
  return { item: { ...base, ...(await probe(kind, url)) }, size: file.size };
}

/** 경로만 아는 미디어(프로젝트 열기·다시 연결)를 다시 읽는다. 저장된 값은 유지하고 빈 값만 채운다. */
export async function restoreMediaItem(saved: Omit<MediaItem, 'url'>): Promise<MediaItem> {
  const url = mediaUrl(saved.path);
  const probed = await probe(saved.kind, url);
  return { ...probed, ...saved, url, thumbnail: saved.thumbnail ?? probed.thumbnail, missing: false };
}

export const PEAKS_PER_SECOND = 50;
/** 이보다 큰 영상은 메모리를 많이 쓰므로 음파를 계산하지 않는다 */
const MAX_PEAKS_FILE_BYTES = 300 * 1024 * 1024;

/** 파일의 소리를 해석해 길이와 음파 모양(구간별 최대 진폭, 0~1)을 구한다. */
export async function decodeAudio(url: string): Promise<{ duration: number; peaks: Float32Array } | undefined> {
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
    const bucket = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SECOND));
    const peaks = new Float32Array(Math.ceil(audio.length / bucket));
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const samples = audio.getChannelData(ch);
      for (let i = 0; i < samples.length; i++) {
        const v = Math.abs(samples[i]);
        const b = (i / bucket) | 0;
        if (v > peaks[b]) peaks[b] = v;
      }
    }
    const max = peaks.reduce((m, v) => Math.max(m, v), 0);
    if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= max;
    return { duration: audio.duration, peaks };
  } catch {
    return undefined; // 소리가 없는 영상 등
  }
}

export async function computePeaks(item: MediaItem, fileSize: number): Promise<Float32Array | undefined> {
  if (item.kind === 'image' || fileSize > MAX_PEAKS_FILE_BYTES) return undefined;
  return (await decodeAudio(item.url))?.peaks;
}

export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
