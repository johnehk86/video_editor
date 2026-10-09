// media://local/<인코딩된 경로> 로 로컬 미디어 파일을 렌더러에 제공한다.
// <video>가 원하는 위치로 이동할 수 있도록 Range 요청(부분 읽기)을 지원한다.
// Electron에 의존하지 않으므로 node로 단독 테스트할 수 있다.
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const SCHEME = 'media';

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// 썸네일·음파를 만들 때 캔버스/fetch로 읽을 수 있도록 다른 출처 접근을 허용한다.
const BASE_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' };

const toUrl = (filePath) => `${SCHEME}://local/${encodeURIComponent(filePath)}`;
const toPath = (url) => decodeURIComponent(new URL(url).pathname.slice(1));

async function handleMediaRequest(request) {
  let filePath;
  let stat;
  try {
    filePath = toPath(request.url);
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return new Response('파일을 찾을 수 없습니다.', { status: 404, headers: BASE_HEADERS });
  }

  const size = stat.size;
  const headers = { ...BASE_HEADERS, 'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');

  if (!range) {
    const body = Readable.toWeb(fs.createReadStream(filePath));
    return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }

  // bytes=시작-끝 / bytes=시작- / bytes=-끝에서부터의길이
  let start;
  let end;
  if (range[1] === '') {
    start = Math.max(0, size - Number(range[2]));
    end = size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  }
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...BASE_HEADERS, 'Content-Range': `bytes */${size}` } });
  }

  const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(body, {
    status: 206,
    headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
  });
}

/** app.ready 전에 호출해야 한다. */
function registerMediaScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** app.ready 뒤에 호출한다. */
function handleMediaScheme(protocol) {
  protocol.handle(SCHEME, handleMediaRequest);
}

module.exports = { registerMediaScheme, handleMediaScheme, handleMediaRequest, toUrl, toPath };
