import type { Project, TextAnimation, TextLayer } from '../types';
import { subtitleAt } from '../state/project';
import { drawSubtitle } from './subtitles';

/*
 * 영상 위에 겹치는 그래픽(텍스트 레이어 + 자막) 그리기.
 * 미리보기와 내보내기가 같은 함수를 써서 보이는 그대로 영상에 입혀진다.
 */

export const FONTS = [
  { id: 'malgun', label: '맑은 고딕', css: `'Malgun Gothic', sans-serif` },
  { id: 'gulim', label: '굴림', css: `Gulim, 'Malgun Gothic', sans-serif` },
  { id: 'batang', label: '바탕', css: `Batang, serif` },
  { id: 'gungsuh', label: '궁서', css: `Gungsuh, serif` },
  { id: 'impact', label: 'Impact (영문)', css: `Impact, 'Malgun Gothic', sans-serif` },
];

export const TEXT_ANIMATIONS: { id: TextAnimation; label: string }[] = [
  { id: 'none', label: '없음' },
  { id: 'fade', label: '페이드' },
  { id: 'pop', label: '팝' },
  { id: 'slide', label: '슬라이드' },
];

/** 등장·퇴장 애니메이션 길이 (짧은 텍스트는 길이의 1/3까지) */
const ANIMATION_SECONDS = 0.4;
const LINE_HEIGHT = 1.25;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;

export const animationLength = (l: TextLayer) => Math.min(ANIMATION_SECONDS, (l.end - l.start) / 3);

/** 시각 t에 애니메이션 중인지 (내보낼 때 프레임 단위로 그릴지 정하는 데 쓴다) */
export function isAnimating(l: TextLayer, t: number) {
  const a = animationLength(l);
  return (l.animIn !== 'none' && t >= l.start && t < l.start + a) || (l.animOut !== 'none' && t >= l.end - a && t < l.end);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 텍스트 레이어 하나를 그린다. 화면에 안 보이면 null, 보이면 (애니메이션 전) 차지하는 영역 */
export function drawTextLayer(ctx: CanvasRenderingContext2D, w: number, h: number, layer: TextLayer, t: number): Box | null {
  if (t < layer.start || t >= layer.end || !layer.text.trim()) return null;

  const a = animationLength(layer);
  let alpha = 1;
  let scale = 1;
  let dy = 0;
  const apply = (anim: TextAnimation, p: number) => {
    if (anim === 'fade') alpha *= p;
    if (anim === 'pop') {
      scale *= 0.4 + 0.6 * easeOutBack(p);
      alpha *= clamp01(p * 2);
    }
    if (anim === 'slide') {
      dy += (1 - easeOutCubic(p)) * 0.08 * h;
      alpha *= p;
    }
  };
  if (a > 0) {
    apply(layer.animIn, clamp01((t - layer.start) / a));
    apply(layer.animOut, clamp01((layer.end - t) / a));
  }

  const fontPx = (layer.fontSize / 100) * h;
  const font = FONTS.find((f) => f.id === layer.font) ?? FONTS[0];
  ctx.font = `${layer.bold ? 700 : 500} ${fontPx}px ${font.css}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = layer.text.split('\n');
  const lineH = fontPx * LINE_HEIGHT;
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const blockH = lines.length * lineH;
  const pad = fontPx * 0.3;
  const cx = layer.x * w;
  const cy = layer.y * h;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + dy);
  ctx.scale(scale, scale);
  if (layer.background) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(-blockW / 2 - pad, -blockH / 2 - pad / 2, blockW + pad * 2, blockH + pad, fontPx * 0.2);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = -blockH / 2 + lineH * (i + 0.5);
    if (layer.outline) {
      ctx.lineWidth = fontPx * 0.12;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, 0, y);
  });
  ctx.restore();

  return { x: cx - blockW / 2 - pad, y: cy - blockH / 2 - pad / 2, w: blockW + pad * 2, h: blockH + pad };
}

/**
 * 시각 t의 텍스트 레이어들과 자막을 그린다. (텍스트 → 자막 순서라 자막이 맨 위)
 * @returns 화면에 보이는 텍스트 레이어의 영역 (미리보기에서 끌어 옮길 때 쓴다)
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: Project,
  t: number,
  options: { subtitles: boolean },
): { boxes: Map<string, Box>; drawn: number } {
  const boxes = new Map<string, Box>();
  for (const layer of project.texts) {
    const box = drawTextLayer(ctx, w, h, layer, t);
    if (box) boxes.set(layer.id, box);
  }
  let drawn = boxes.size;
  if (options.subtitles) {
    const sub = subtitleAt(project, t);
    if (sub?.text.trim()) {
      drawSubtitle(ctx, w, h, sub.text, project.subtitleStyle);
      drawn++;
    }
  }
  return { boxes, drawn };
}

async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('그래픽 이미지를 만들지 못했습니다.'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export interface OverlaySegment {
  start: number;
  end: number;
  png: Uint8Array;
}

/**
 * 내보내기용: 영상 전체에 겹칠 그래픽을 (시작, 끝, 투명 PNG) 구간들로 만든다.
 * 화면이 바뀌는 시점마다 한 장씩 그리고, 애니메이션 구간만 프레임마다 그린다. 아무것도 없는 구간은 비워 둔다.
 */
export async function renderOverlaySegments(
  project: Project,
  duration: number,
  size: { width: number; height: number; fps: number },
  options: { subtitles: boolean },
  onProgress: (p: number) => void,
): Promise<OverlaySegment[]> {
  const { width, height, fps } = size;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 그림이 바뀔 수 있는 시점
  const cuts = new Set([0, duration]);
  if (options.subtitles) project.subtitles.forEach((s) => cuts.add(s.start).add(s.end));
  for (const l of project.texts) {
    const a = animationLength(l);
    cuts.add(l.start).add(l.end).add(l.start + a).add(l.end - a);
  }
  const times = [...cuts].filter((t) => t >= 0 && t <= duration).sort((x, y) => x - y);

  const segments: OverlaySegment[] = [];
  const draw = async (t: number, start: number, end: number) => {
    ctx.clearRect(0, 0, width, height);
    if (drawOverlay(ctx, width, height, project, t, options).drawn > 0) {
      segments.push({ start, end, png: await canvasToPng(canvas) });
    }
  };

  for (let i = 0; i < times.length - 1; i++) {
    const [a, b] = [times[i], times[i + 1]];
    if (b - a < 1e-6) continue;
    const mid = (a + b) / 2;
    if (project.texts.some((l) => isAnimating(l, mid))) {
      for (let t = a; t < b - 1e-6; t += 1 / fps) await draw(t, t, Math.min(b, t + 1 / fps));
    } else {
      await draw(mid, a, b);
    }
    onProgress((i + 1) / (times.length - 1));
  }
  return segments;
}

/** 아무것도 없는 투명 PNG (그래픽이 없는 구간에 쓴다) */
export async function blankPng(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvasToPng(canvas);
}
