const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { runExport, cancelExport, transcodeToWav } = require('./exporter.cjs');
const transcriber = require('./transcriber.cjs');
const { registerMediaScheme, handleMediaScheme } = require('./mediaProtocol.cjs');
const {
  PROJECT_EXT,
  writeProjectFile,
  readProjectFile,
  locateInFolder,
  createRecentStore,
  writeAutosave,
  readAutosave,
  clearAutosave,
} = require('./projectFiles.cjs');

// 앱 데이터 폴더를 고정한다. (설치 버전의 앱 이름이 달라도 녹음·인식 모델·최근 목록을 그대로 쓴다)
// 테스트할 때는 실제 앱 데이터를 건드리지 않도록 다른 폴더를 쓸 수 있다.
app.setPath('userData', process.env.VIDEO_EDITOR_USER_DATA || path.join(app.getPath('appData'), 'video-editor'));

// 이미 켜져 있으면 새로 띄우지 않고 그 창에서 연다. (탐색기에서 .vproj 를 더블클릭한 경우 등)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/** 실행 인자 중 열어야 할 프로젝트 파일 */
const projectArg = (argv) =>
  argv.slice(1).find((a) => a.toLowerCase().endsWith(`.${PROJECT_EXT}`) && fs.existsSync(a));

app.on('second-instance', (_event, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const file = projectArg(argv);
  if (file) win.webContents.send('project:open-file', file);
});

// media:// 는 app.ready 전에 등록해야 한다.
registerMediaScheme(protocol);

// 앱 데이터 폴더에 두는 것들 (app.ready 뒤에 정해진다)
let recent = null;
let autosaveDir = null;

/** 창마다 저장하지 않은 변경이 있는지 (닫기 전에 확인하려고) */
const unsavedWindows = new Set();
/** 렌더러가 "닫아도 된다"고 답한 창 */
const closeApproved = new Set();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#16161a',
    title: '영상 편집기',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  // 저장하지 않은 변경이 있으면 바로 닫지 않고 렌더러에게 물어본다.
  const id = win.webContents.id;
  win.on('close', (e) => {
    if (unsavedWindows.has(id) && !closeApproved.has(id)) {
      e.preventDefault();
      win.webContents.send('app:close-requested');
    }
  });
  win.on('closed', () => {
    unsavedWindows.delete(id);
    closeApproved.delete(id);
  });

  // 프로젝트 파일을 더블클릭해서 실행했으면, 화면이 준비된 뒤 그 파일을 연다.
  const startupFile = projectArg(process.argv);
  if (startupFile) {
    win.webContents.once('did-finish-load', () => win.webContents.send('project:open-file', startupFile));
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('export:start', async (event, plan) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '영상 내보내기',
    defaultPath: path.join(app.getPath('videos'), `영상_${new Date().toISOString().slice(0, 10)}.mp4`),
    filters: [{ name: 'MP4 영상', extensions: ['mp4'] }],
  });
  if (canceled || !filePath) return { status: 'canceled' };

  try {
    await runExport(plan, filePath, (p) => event.sender.send('export:progress', p));
    // 유튜브에 따로 올릴 수 있도록 같은 이름의 .srt 도 남긴다.
    if (plan.srt) fs.writeFileSync(filePath.replace(/\.mp4$/i, '') + '.srt', plan.srt, 'utf8');
    return { status: 'done', path: filePath };
  } catch (e) {
    return e.canceled ? { status: 'canceled' } : { status: 'error', message: e.message };
  }
});

ipcMain.handle('export:cancel', () => cancelExport());

// 녹음 저장: 앱 데이터 폴더/recordings 에 WAV로 남긴다. (내보내기 때 FFmpeg가 이 파일을 읽는다)
ipcMain.handle('recording:save', async (_event, data) => {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const webm = path.join(dir, `recording_${stamp}.webm`);
  const wav = webm.replace(/\.webm$/, '.wav');
  fs.writeFileSync(webm, Buffer.from(data));
  try {
    await transcodeToWav(webm, wav);
  } finally {
    fs.rmSync(webm, { force: true });
  }
  return { path: wav, name: `녹음 ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` };
});

// 자동 자막 (whisper.cpp)
ipcMain.handle('stt:status', () => transcriber.getStatus());
ipcMain.handle('stt:start', async (event, request) => {
  try {
    const segments = await transcriber.transcribe(request, (p) => event.sender.send('stt:progress', p));
    return { status: 'done', segments };
  } catch (e) {
    return e.canceled ? { status: 'canceled' } : { status: 'error', message: e.message };
  }
});
ipcMain.handle('stt:cancel', () => transcriber.cancelTranscribe());

ipcMain.handle('srt:save', async (event, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '자막 파일 저장',
    defaultPath: path.join(app.getPath('videos'), `자막_${new Date().toISOString().slice(0, 10)}.srt`),
    filters: [{ name: 'SRT 자막', extensions: ['srt'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
});

// 프로젝트 저장 / 열기
const projectFilters = [{ name: '영상 편집 프로젝트', extensions: [PROJECT_EXT] }];

ipcMain.handle('project:save', async (event, { data, path: currentPath, saveAs }) => {
  let target = currentPath;
  if (!target || saveAs) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: saveAs ? '다른 이름으로 저장' : '프로젝트 저장',
      defaultPath: currentPath ?? path.join(app.getPath('documents'), `새 프로젝트.${PROJECT_EXT}`),
      filters: projectFilters,
    });
    if (canceled || !filePath) return null;
    target = filePath;
  }
  writeProjectFile(target, data);
  recent.add(target);
  return target;
});

/** filePath 가 없으면 열기 대화상자를 띄운다. 결과: null(취소) | { path, data } | { error } */
ipcMain.handle('project:open', async (event, filePath) => {
  let target = filePath;
  if (!target) {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '프로젝트 열기',
      defaultPath: app.getPath('documents'),
      filters: projectFilters,
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return null;
    target = filePaths[0];
  }
  try {
    const opened = readProjectFile(target);
    recent.add(target);
    return opened;
  } catch (e) {
    return { error: e.code === 'ENOENT' ? '프로젝트 파일을 찾을 수 없어요. 옮기거나 지웠는지 확인해 주세요.' : e.message };
  }
});

ipcMain.handle('recent:list', () => recent.list());
ipcMain.handle('recent:remove', (_event, filePath) => recent.remove(filePath));

// 자동 저장: 저장하지 않은 작업을 앱 데이터 폴더에 남겨 두었다가, 비정상 종료 뒤 복구한다.
ipcMain.handle('autosave:write', (_event, { data, projectPath }) => writeAutosave(autosaveDir, data, projectPath));
ipcMain.handle('autosave:read', () => readAutosave(autosaveDir));
ipcMain.handle('autosave:clear', () => clearAutosave(autosaveDir));

ipcMain.handle('media:locate', (_event, { folder, items }) => locateInFolder(folder, items));

ipcMain.handle('dialog:unsaved', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['저장', '저장 안 함', '취소'],
    defaultId: 0,
    cancelId: 2,
    title: '영상 편집기',
    message: '저장하지 않은 변경 사항이 있어요.',
    detail: '지금 저장할까요?',
  });
  return ['save', 'discard', 'cancel'][response];
});

ipcMain.on('project:dirty', (event, dirty) => {
  if (dirty) unsavedWindows.add(event.sender.id);
  else unsavedWindows.delete(event.sender.id);
});

ipcMain.on('app:close-approved', (event) => {
  closeApproved.add(event.sender.id);
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('shell:showItem', (_event, filePath) => shell.showItemInFolder(filePath));

app.whenReady().then(() => {
  transcriber.init(path.join(app.getPath('userData'), 'whisper'));
  recent = createRecentStore(path.join(app.getPath('userData'), 'recent-projects.json'));
  autosaveDir = path.join(app.getPath('userData'), 'autosave');
  handleMediaScheme(protocol);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cancelExport();
  transcriber.cancelTranscribe();
  if (process.platform !== 'darwin') app.quit();
});
