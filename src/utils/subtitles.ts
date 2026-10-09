import type { Subtitle, SubtitleStyle } from '../types';

/*
 * 자막 그리기. 미리보기와 내보내기가 같은 함수를 써서 보이는 그대로 영상에 입혀진다.
 */

const FONT_FAMILY = `'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif`;
const LINE_HEIGHT = 1.3;
const MAX_WIDTH_RATIO = 0.9;
const EDGE_MARGIN_RATIO = 0.07;

/** 띄어쓰기 단위로 줄을 나누고, 한 단어가 너무 길면 글자 단위로 자른다. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const ch of word) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** w×h 크기 화면에 자막 한 개를 그린다. */
export function drawSubtitle(ctx: CanvasRenderingContext2D, w: number, h: number, text: string, style: SubtitleStyle) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const fontPx = (style.fontSize / 100) * h;
  ctx.font = `${style.bold ? 700 : 500} ${fontPx}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapLines(ctx, trimmed, w * MAX_WIDTH_RATIO);
  const lineH = fontPx * LINE_HEIGHT;
  const blockH = lines.length * lineH;
  const margin = h * EDGE_MARGIN_RATIO;
  const top =
    style.position === 'top' ? margin : style.position === 'middle' ? (h - blockH) / 2 : h - margin - blockH;

  lines.forEach((line, i) => {
    const y = top + lineH * (i + 0.5);
    if (style.background) {
      const padX = fontPx * 0.4;
      const width = ctx.measureText(line).width + padX * 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.beginPath();
      ctx.roundRect(w / 2 - width / 2, y - lineH / 2, width, lineH, fontPx * 0.15);
      ctx.fill();
    }
    if (style.outline) {
      ctx.lineWidth = fontPx * 0.14;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.strokeText(line, w / 2, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, w / 2, y);
  });
}

/* ---------- SRT ---------- */

function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

export function toSrt(subs: Subtitle[]): string {
  return (
    subs
      .filter((s) => s.text.trim())
      .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.trim()}\n`)
      .join('\n') + '\n'
  );
}

const SRT_TIME = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;

function parseSrtTime(t: string) {
  const m = SRT_TIME.exec(t);
  if (!m) return NaN;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function parseSrt(content: string): Subtitle[] {
  const subs: Subtitle[] = [];
  for (const block of content.replace(/^﻿/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [from, to] = lines[timeIdx].split('-->');
    const start = parseSrtTime(from);
    const end = parseSrtTime(to);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    // 간단한 서식 태그(<i>, <b>, {\an8} 등)는 지운다.
    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .replace(/<[^>]+>|\{[^}]*\}/g, '')
      .trim();
    subs.push({ id: crypto.randomUUID(), start, end, text });
  }
  return subs;
}
