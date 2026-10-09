// 앱 아이콘(build/icon.png, 512×512)을 FFmpeg로 그린다: 둥근 청록색 사각형 + 흰 재생 버튼.
// 사용: node scripts/make-icon.cjs
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');

const S = 512;
const HALF = S / 2;
const RADIUS = 110;
const inner = HALF - RADIUS;

// 모서리가 둥근 사각형 안쪽인지
const inside = `lte(hypot(max(0\\,abs(X-${HALF})-${inner})\\,max(0\\,abs(Y-${HALF})-${inner}))\\,${RADIUS})`;
// 재생 삼각형 (왼쪽 변 x=196, 꼭짓점 x=360)
const tri = `gte(X\\,196)*lte(abs(Y-${HALF})\\,(360-X)*0.62)`;
// 위는 밝은 청록, 아래로 갈수록 짙은 청록
const geq = [
  `r='if(${tri}\\,255\\,20+10*Y/${S})'`,
  `g='if(${tri}\\,255\\,205-95*Y/${S})'`,
  `b='if(${tri}\\,255\\,205-55*Y/${S})'`,
  `a='255*${inside}'`,
].join(':');

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${S}x${S},format=rgba`, '-vf', `geq=${geq}`, '-frames:v', '1', out]);
console.log('아이콘 생성:', out);
