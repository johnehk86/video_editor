const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 렌더러에 안전하게 노출할 API
contextBridge.exposeInMainWorld('editorApi', {
  /** 드래그·선택한 파일의 실제 디스크 경로 (FFmpeg에 넘길 때 사용) */
  getPathForFile: (file) => webUtils.getPathForFile(file),

  exportVideo: (plan) => ipcRenderer.invoke('export:start', plan),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },
  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),

  /** 녹음한 WebM 데이터를 WAV로 저장하고 { path, name } 을 돌려받는다 */
  saveRecording: (data) => ipcRenderer.invoke('recording:save', data),

  /** 자동 자막: 설치 상태 / 시작 / 취소 / 진행률 */
  getSttStatus: () => ipcRenderer.invoke('stt:status'),
  transcribe: (request) => ipcRenderer.invoke('stt:start', request),
  cancelTranscribe: () => ipcRenderer.invoke('stt:cancel'),
  onSttProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('stt:progress', listener);
    return () => ipcRenderer.removeListener('stt:progress', listener);
  },
  /** SRT 저장 대화상자를 띄우고 저장한 경로(취소하면 null)를 돌려준다 */
  saveSrt: (content) => ipcRenderer.invoke('srt:save', content),

  /** 프로젝트: 저장한 경로(취소하면 null) / 열기 결과 { path, data } (취소하면 null) */
  saveProject: (request) => ipcRenderer.invoke('project:save', request),
  /** filePath 를 주면 바로 열고, 없으면 열기 대화상자를 띄운다 */
  openProject: (filePath) => ipcRenderer.invoke('project:open', filePath),
  listRecent: () => ipcRenderer.invoke('recent:list'),
  removeRecent: (filePath) => ipcRenderer.invoke('recent:remove', filePath),

  /** 자동 저장 / 남은 자동 저장본 읽기 / 지우기 */
  writeAutosave: (data, projectPath) => ipcRenderer.invoke('autosave:write', { data, projectPath }),
  readAutosave: () => ipcRenderer.invoke('autosave:read'),
  clearAutosave: () => ipcRenderer.invoke('autosave:clear'),
  /** 사라진 미디어를 folder 에서 같은 이름으로 찾는다 */
  locateMedia: (folder, items) => ipcRenderer.invoke('media:locate', { folder, items }),
  /** 저장 안 한 변경 확인: 'save' | 'discard' | 'cancel' */
  confirmUnsaved: () => ipcRenderer.invoke('dialog:unsaved'),
  setDirty: (dirty) => ipcRenderer.send('project:dirty', dirty),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('app:close-requested', listener);
    return () => ipcRenderer.removeListener('app:close-requested', listener);
  },
  approveClose: () => ipcRenderer.send('app:close-approved'),
  /** 탐색기에서 .vproj 를 더블클릭하는 등 바깥에서 프로젝트를 열라고 할 때 */
  onOpenFile: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('project:open-file', listener);
    return () => ipcRenderer.removeListener('project:open-file', listener);
  },
});
