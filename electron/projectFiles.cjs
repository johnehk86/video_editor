// 프로젝트 파일(.vproj) 읽기·쓰기. 미디어는 경로만 저장하고,
// 프로젝트 파일 기준 상대 경로도 함께 남겨서 폴더째 옮겨도 다시 찾을 수 있게 한다.
// Electron에 의존하지 않으므로 node로 단독 테스트할 수 있다.
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_EXT = 'vproj';

function fileSize(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st.size : -1;
  } catch {
    return -1;
  }
}

/** 저장: 각 미디어에 상대 경로(relPath)를 붙여 임시 파일에 쓴 뒤 바꿔치기한다. */
function writeProjectFile(filePath, data) {
  const dir = path.dirname(filePath);
  const withRel = {
    ...data,
    media: data.media.map((m) => ({ ...m, relPath: path.relative(dir, m.path) })),
  };
  const tmp = `${filePath}.saving`;
  fs.writeFileSync(tmp, JSON.stringify(withRel, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/** 열기: 원래 경로 → 상대 경로 순으로 미디어를 찾고, 못 찾으면 missing으로 표시한다. */
function readProjectFile(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''));
  const dir = path.dirname(filePath);
  data.media = (Array.isArray(data.media) ? data.media : []).map((m) => {
    const candidates = [m.path, m.relPath && path.resolve(dir, m.relPath)].filter(Boolean);
    for (const p of candidates) {
      const size = fileSize(p);
      if (size >= 0) return { ...m, path: p, missing: false, size };
    }
    return { ...m, missing: true, size: 0 };
  });
  return { path: filePath, data };
}

/** 다시 연결: 사라진 파일들을 같은 이름으로 folder 에서 찾는다. */
function locateInFolder(folder, items) {
  return items
    .map(({ id, path: oldPath }) => {
      const candidate = path.join(folder, path.basename(oldPath.replace(/\\/g, '/')));
      const size = fileSize(candidate);
      return size >= 0 ? { id, path: candidate, size } : null;
    })
    .filter(Boolean);
}

/* ---------- 최근 프로젝트 ---------- */

const RECENT_LIMIT = 10;

/** 최근에 열거나 저장한 프로젝트 목록을 file(JSON)에 기억한다. */
function createRecentStore(file) {
  const read = () => {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(list) ? list.filter((r) => r && typeof r.path === 'string') : [];
    } catch {
      return [];
    }
  };
  const write = (list) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  };
  const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  return {
    /** 지금도 파일이 있는지(exists)를 붙여서 돌려준다 */
    list: () => read().map((r) => ({ ...r, exists: fileSize(r.path) >= 0 })),
    add(projectPath) {
      const entry = { path: projectPath, name: path.basename(projectPath, `.${PROJECT_EXT}`), openedAt: new Date().toISOString() };
      write([entry, ...read().filter((r) => !samePath(r.path, projectPath))].slice(0, RECENT_LIMIT));
    },
    remove(projectPath) {
      write(read().filter((r) => !samePath(r.path, projectPath)));
    },
  };
}

/* ---------- 자동 저장 ---------- */

const AUTOSAVE_FILE = `autosave.${PROJECT_EXT}`;

/** 저장하지 않은 작업을 dir 에 덮어쓴다. data.autosave 에 원래 프로젝트 경로·시각을 함께 남긴다. */
function writeAutosave(dir, data, projectPath) {
  fs.mkdirSync(dir, { recursive: true });
  writeProjectFile(path.join(dir, AUTOSAVE_FILE), { ...data, autosave: { projectPath, savedAt: new Date().toISOString() } });
}

/** 남아 있는 자동 저장본. 없으면 null */
function readAutosave(dir) {
  const file = path.join(dir, AUTOSAVE_FILE);
  if (fileSize(file) < 0) return null;
  try {
    const { data } = readProjectFile(file);
    return { data, projectPath: data.autosave?.projectPath ?? null, savedAt: data.autosave?.savedAt ?? null };
  } catch {
    return null; // 쓰다가 꺼져서 깨진 파일 등
  }
}

function clearAutosave(dir) {
  fs.rmSync(path.join(dir, AUTOSAVE_FILE), { force: true });
}

module.exports = {
  PROJECT_EXT,
  writeProjectFile,
  readProjectFile,
  locateInFolder,
  createRecentStore,
  writeAutosave,
  readAutosave,
  clearAutosave,
};
