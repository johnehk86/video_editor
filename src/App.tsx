import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { MediaItem, Project, Selection, Subtitle, TrackId } from './types';
import {
  clipEnd,
  createTextLayer,
  historyReducer,
  initialHistory,
  mainTrackEnd,
  mediaLimit,
  projectDuration,
  transitionWindows,
} from './state/project';
import { playback } from './state/playback';
import { parseProjectFile, projectSnapshot, serializeProject, type OpenedMedia } from './state/projectFile';
import { computePeaks, createMediaItem, folderOf, restoreMediaItem } from './utils/media';
import { buildExportPlan } from './utils/exportPlan';
import {
  loadAutoSubtitleSettings,
  saveAutoSubtitleSettings,
  type AutoSubtitleSettings,
} from './utils/autoSubtitle';
import { useAutoSubtitles } from './state/useAutoSubtitles';
import SubtitleJobBar from './components/SubtitleJobBar';
import MediaPanel from './components/MediaPanel';
import SubtitlePanel from './components/SubtitlePanel';
import Preview from './components/Preview';
import Inspector from './components/Inspector';
import SubtitleInspector from './components/SubtitleInspector';
import Timeline from './components/Timeline';
import ExportDialog from './components/ExportDialog';
import RecorderPanel from './components/RecorderPanel';
import AutoSubtitleDialog from './components/AutoSubtitleDialog';
import { RecentMenu, RecentStart } from './components/RecentProjects';
import RecoveryDialog from './components/RecoveryDialog';
import TransitionInspector from './components/TransitionInspector';
import TextInspector from './components/TextInspector';

const FRAME = 1 / 30;
/** 저장하지 않은 작업을 이 간격으로 자동 저장한다 */
const AUTOSAVE_INTERVAL_MS = 30_000;

type Recovery = NonNullable<Awaited<ReturnType<Window['editorApi']['readAutosave']>>>;
const NEW_SUBTITLE_DURATION = 2;

type LeftTab = 'media' | 'subtitle';

const KIND_LABEL = { video: '영상', audio: '오디오', image: '이미지' } as const;
const fileName = (p: string) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);

export default function App() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [history, dispatch] = useReducer(historyReducer, initialHistory);
  const [selection, setSelection] = useState<Selection>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('media');
  const [exporting, setExporting] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => projectSnapshot(initialHistory.present, []));
  /** 최근 프로젝트 목록을 다시 읽게 하는 값 */
  const [recentKey, setRecentKey] = useState(0);
  /** 시작할 때 발견한 자동 저장본 (복구할지 묻는 중) */
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** 시작 시 복구 확인이 끝나기 전에는 자동 저장본을 건드리지 않는다 */
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const project = history.present;

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const duration = projectDuration(project);
  const dirty = useMemo(() => projectSnapshot(project, media) !== savedSnapshot, [project, media, savedSnapshot]);
  const projectName = projectPath ? fileName(projectPath).replace(/\.vproj$/i, '') : '새 프로젝트';

  useEffect(() => playback.setDuration(duration), [duration]);

  // 창 제목에 프로젝트 이름과 저장 안 함(●)을 표시하고, 닫기 확인용으로 메인 프로세스에 알린다.
  useEffect(() => {
    document.title = `${projectName}${dirty ? ' ●' : ''} - 영상 편집기`;
    window.editorApi.setDirty(dirty);
  }, [projectName, dirty]);

  const selectedClip = selection?.type === 'clip' ? (project.clips.find((c) => c.id === selection.id) ?? null) : null;
  const selectedSubtitle =
    selection?.type === 'subtitle' ? (project.subtitles.find((s) => s.id === selection.id) ?? null) : null;
  /** 선택한 전환이 들어오는 클립 (전환을 없애면 선택도 풀린다) */
  const selectedText = selection?.type === 'text' ? (project.texts.find((t) => t.id === selection.id) ?? null) : null;
  const selectedTransitionClip =
    selection?.type === 'transition'
      ? (project.clips.find((c) => c.id === selection.id && c.transition) ?? null)
      : null;
  const selectedMedia =
    selection?.type === 'media'
      ? (mediaById.get(selection.id) ?? null)
      : selectedClip
        ? (mediaById.get(selectedClip.mediaId) ?? null)
        : null;

  const updateMedia = (id: string, patch: Partial<MediaItem>) =>
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const fillPeaks = (item: MediaItem, size: number) => {
    computePeaks(item, size).then((peaks) => peaks && updateMedia(item.id, { peaks }));
  };

  /* ---------- 원클릭 자동 자막 ---------- */

  const autoSubs = useAutoSubtitles(dispatch);
  /** 자동 자막 설정 창. firstRun: 처음 영상을 넣어서 열린 경우 */
  const [autoDialog, setAutoDialog] = useState<{ firstRun: boolean } | null>(null);
  /** 방금 넣은 영상이 타임라인에 반영되면 자막 만들기를 시작한다 */
  const [pendingAutoStart, setPendingAutoStart] = useState(false);

  const startAutoSubtitles = async (settings: AutoSubtitleSettings) => {
    saveAutoSubtitleSettings(settings);
    setAutoDialog(null);
    let plan;
    try {
      // 소리만 쓰므로 해상도는 아무 값이나 괜찮다.
      plan = buildExportPlan(project, mediaById, { width: 1920, height: 1080, fps: 30, crf: 23 });
    } catch (e) {
      alert((e as Error).message);
      return;
    }
    setLeftTab('subtitle');
    setSelection(null);
    const status = await window.editorApi.getSttStatus();
    const firstStep = !status.engine ? 'engine' : !status.models[settings.model] ? 'model' : 'audio';
    autoSubs.start(plan, settings, firstStep);
  };

  /** fromImport: 영상을 넣자마자 요청한 경우 (설정에서 꺼 두었으면 시작하지 않는다) */
  const requestAutoSubtitles = (fromImport: boolean) => {
    const settings = loadAutoSubtitleSettings();
    if (!settings.chosen) setAutoDialog({ firstRun: fromImport });
    else if (!fromImport || settings.autoOnImport) setPendingAutoStart(true);
  };

  useEffect(() => {
    if (!pendingAutoStart || project.clips.length === 0) return;
    if (project.clips.some((c) => !mediaById.has(c.mediaId))) return;
    setPendingAutoStart(false);
    startAutoSubtitles(loadAutoSubtitleSettings());
  }, [pendingAutoStart, project, mediaById]);

  const projectRef = useRef(project);
  projectRef.current = project;

  /** 파일 가져오기. 빈 프로젝트에 영상을 넣으면 타임라인에 올리고 자막까지 자동으로 만든다. */
  const importFiles = async (files: File[]) => {
    const created = (await Promise.all(files.map(createMediaItem))).filter((c) => c !== null);
    if (created.length === 0) return;
    const items = created.map((c) => c.item);
    setMedia((prev) => [...prev, ...items]);
    created.forEach((c) => fillPeaks(c.item, c.size));

    if (projectRef.current.clips.length > 0) return;
    const visual = items.filter((m) => m.kind !== 'audio');
    if (visual.length === 0) return;
    visual.forEach((m) => dispatch({ type: 'add', clipId: crypto.randomUUID(), media: m }));
    if (visual.some((m) => m.kind === 'video') && !autoSubs.job) requestAutoSubtitles(true);
  };

  const removeMedia = (id: string) => {
    const target = mediaById.get(id);
    if (target?.url.startsWith('blob:')) URL.revokeObjectURL(target.url);
    setMedia((prev) => prev.filter((m) => m.id !== id));
    dispatch({ type: 'removeMedia', mediaId: id });
    if (selection?.id === id || selectedClip?.mediaId === id) setSelection(null);
  };

  const addRecording = (item: MediaItem, start: number) => {
    setMedia((prev) => [...prev, item]);
    const clipId = crypto.randomUUID();
    dispatch({ type: 'add', clipId, media: item, start, track: 'voice' });
    setSelection({ type: 'clip', id: clipId });
  };

  const addToTimeline = (mediaId: string, at: { start?: number; index?: number; track?: TrackId } = {}) => {
    const m = mediaById.get(mediaId);
    if (!m || m.missing) return;
    const clipId = crypto.randomUUID();
    // 오디오는 기본적으로 재생헤드 위치에, 영상·이미지는 메인 트랙 끝에 붙인다.
    const start = at.start ?? (m.kind === 'audio' ? playback.getTime() : undefined);
    dispatch({ type: 'add', clipId, media: m, start, index: at.index, track: at.track });
    setSelection({ type: 'clip', id: clipId });
  };

  const addTextAt = (time: number) => {
    const layer = createTextLayer(crypto.randomUUID(), time);
    dispatch({ type: 'addText', layer });
    setSelection({ type: 'text', id: layer.id });
  };

  const addSubtitleAt = (time: number) => {
    const subtitle: Subtitle = { id: crypto.randomUUID(), start: time, end: time + NEW_SUBTITLE_DURATION, text: '' };
    dispatch({ type: 'addSubtitle', subtitle });
    setSelection({ type: 'subtitle', id: subtitle.id });
    setLeftTab('subtitle');
  };

  /* ---------- 프로젝트 저장 / 열기 ---------- */

  const saveProject = async (saveAs: boolean): Promise<boolean> => {
    const savedPath = await window.editorApi.saveProject({
      data: serializeProject(project, media),
      path: projectPath,
      saveAs,
    });
    if (!savedPath) return false;
    setProjectPath(savedPath);
    setSavedSnapshot(projectSnapshot(project, media));
    setRecentKey((k) => k + 1);
    return true;
  };

  /** 저장 안 한 변경이 있으면 물어본다. 계속 진행해도 되면 true */
  const resolveUnsaved = async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await window.editorApi.confirmUnsaved();
    if (choice === 'cancel') return false;
    if (choice === 'save') return saveProject(false);
    return true;
  };

  const applyLoaded = (next: Project, items: MediaItem[], path: string | null) => {
    playback.pause();
    playback.seek(0);
    media.forEach((m) => m.url.startsWith('blob:') && URL.revokeObjectURL(m.url));
    setMedia(items);
    dispatch({ type: 'load', project: next });
    setSelection(null);
    setProjectPath(path);
    setSavedSnapshot(projectSnapshot(next, items));
  };

  /** 자막을 만드는 중에 다른 프로젝트로 바꾸면 만들던 자막이 섞여 들어갈 수 있어 막는다. */
  const busyWithSubtitles = () => {
    if (!autoSubs.job) return false;
    alert('자동 자막을 만드는 중이에요. 끝나거나 취소한 뒤에 다시 해 주세요.');
    return true;
  };

  const newProject = async () => {
    if (busyWithSubtitles() || !(await resolveUnsaved())) return;
    applyLoaded(initialHistory.present, [], null);
  };

  /** 프로젝트 파일 내용을 화면에 불러온다. recovered: 자동 저장본에서 되살린 경우 (저장 안 됨 상태로 둔다) */
  const loadProjectData = async (data: unknown, path: string | null, recovered = false): Promise<boolean> => {
    let parsed;
    try {
      parsed = parseProjectFile(data);
    } catch (e) {
      alert((e as Error).message);
      return false;
    }

    const restore = ({ missing, size: _size, ...saved }: OpenedMedia): Promise<MediaItem> =>
      missing ? Promise.resolve({ ...saved, url: '', missing: true }) : restoreMediaItem(saved);
    const items = await Promise.all(parsed.media.map(restore));
    applyLoaded(parsed.project, items, path);
    if (recovered) setSavedSnapshot('');
    items.forEach((item, i) => !item.missing && fillPeaks(item, parsed.media[i].size));

    const missing = items.filter((m) => m.missing).length;
    if (missing > 0) {
      setLeftTab('media');
      alert(`원본 파일 ${missing}개를 찾지 못했어요.\n미디어 탭에서 ⚠ 표시된 파일을 눌러 다시 연결해 주세요.`);
    }
    return true;
  };

  /** filePath 가 없으면 열기 대화상자를 띄운다. */
  const openProject = async (filePath?: string) => {
    if (busyWithSubtitles() || !(await resolveUnsaved())) return;
    const opened = await window.editorApi.openProject(filePath);
    setRecentKey((k) => k + 1);
    if (!opened) return;
    if ('error' in opened) {
      alert(opened.error);
      return;
    }
    await loadProjectData(opened.data, opened.path);
  };

  /* ---------- 자동 저장 · 복구 ---------- */

  // 시작할 때 지난번에 저장하지 않고 꺼진 작업이 있는지 본다.
  useEffect(() => {
    window.editorApi.readAutosave().then((found) => {
      if (found) setRecovery(found);
      else setRecoveryChecked(true);
    });
  }, []);

  const recover = async (choice: 'recover' | 'discard') => {
    const found = recovery;
    setRecovery(null);
    if (choice === 'recover' && found) await loadProjectData(found.data, found.projectPath, true);
    else await window.editorApi.clearAutosave();
    setRecoveryChecked(true);
  };

  // 저장하지 않은 변경이 있으면 주기적으로 자동 저장한다. (바뀐 것이 없으면 다시 쓰지 않는다)
  const autosaveState = useRef({ project, media, projectPath, dirty });
  autosaveState.current = { project, media, projectPath, dirty };
  useEffect(() => {
    if (!recoveryChecked) return;
    let lastWritten = '';
    const timer = window.setInterval(() => {
      const s = autosaveState.current;
      if (!s.dirty) return;
      const snapshot = projectSnapshot(s.project, s.media);
      if (snapshot === lastWritten) return;
      lastWritten = snapshot;
      window.editorApi.writeAutosave(serializeProject(s.project, s.media), s.projectPath);
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [recoveryChecked]);

  // 저장했거나 변경이 없어지면 자동 저장본은 필요 없다.
  useEffect(() => {
    if (recoveryChecked && !dirty) window.editorApi.clearAutosave();
  }, [recoveryChecked, dirty]);

  /** 찾지 못한 파일을 다시 연결하고, 같은 폴더에서 나머지 파일도 찾아본다. */
  const relinkMedia = async (id: string, file: File) => {
    const old = mediaById.get(id);
    const created = await createMediaItem(file);
    if (!old || !created) return;
    if (created.item.kind !== old.kind) {
      alert(`'${old.name}'은(는) ${KIND_LABEL[old.kind]} 파일이에요. 같은 종류의 파일을 골라 주세요.`);
      return;
    }
    const relinked: MediaItem = { ...created.item, id, missing: false };
    setMedia((prev) => prev.map((m) => (m.id === id ? relinked : m)));
    fillPeaks(relinked, created.size);

    const rest = media.filter((m) => m.missing && m.id !== id);
    if (rest.length === 0) return;
    const found = await window.editorApi.locateMedia(
      folderOf(relinked.path),
      rest.map((m) => ({ id: m.id, path: m.path })),
    );
    for (const f of found) {
      const m = rest.find((r) => r.id === f.id);
      if (!m) continue;
      const restored = await restoreMediaItem({ ...m, path: f.path });
      setMedia((prev) => prev.map((x) => (x.id === f.id ? restored : x)));
      fillPeaks(restored, f.size);
    }
  };

  // 창을 닫으려 할 때 저장 안 한 변경이 있으면 메인 프로세스가 물어 온다.
  const handleCloseRequest = useRef(async () => {});
  handleCloseRequest.current = async () => {
    if (!(await resolveUnsaved())) return;
    // "저장 안 함"으로 닫는 경우: 일부러 버린 작업이니 다음 실행 때 복구하자고 묻지 않는다.
    await window.editorApi.clearAutosave();
    window.editorApi.approveClose();
  };
  useEffect(() => window.editorApi.onCloseRequested(() => handleCloseRequest.current()), []);

  // 탐색기에서 .vproj 를 더블클릭하면 메인 프로세스가 이 창에 열라고 알려 준다.
  const openFromOutside = useRef((_path: string) => {});
  openFromOutside.current = (filePath) => openProject(filePath);
  useEffect(() => window.editorApi.onOpenFile((filePath) => openFromOutside.current(filePath)), []);

  /* ---------- 편집 ---------- */

  const splitAtPlayhead = () => {
    const t = playback.getTime();
    const under = (c: (typeof project.clips)[number]) => t > c.start && t < clipEnd(c);
    // 선택된 클립이 재생헤드 아래에 있으면 그것을, 아니면 메인 트랙 클립을 자른다.
    const target =
      (selectedClip && under(selectedClip) ? selectedClip : null) ??
      project.clips.find((c) => c.track === 'main' && under(c));
    if (target) dispatch({ type: 'split', clipId: target.id, newClipId: crypto.randomUUID(), time: t });
  };

  const deleteSelected = () => {
    if (selectedClip) dispatch({ type: 'remove', clipId: selectedClip.id });
    else if (selectedSubtitle && !autoSubs.job) dispatch({ type: 'removeSubtitle', id: selectedSubtitle.id });
    else if (selectedTransitionClip) dispatch({ type: 'setTransition', clipId: selectedTransitionClip.id, transition: null });
    else if (selectedText) dispatch({ type: 'removeText', id: selectedText.id });
    else return;
    setSelection(null);
  };

  // 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exporting || autoDialog || recordingBusy || recovery) return;
      const ctrl = e.ctrlKey || e.metaKey;

      // 저장·열기 단축키는 글자를 입력하는 중에도 동작한다.
      if (ctrl && (e.code === 'KeyS' || e.code === 'KeyO' || e.code === 'KeyN')) {
        e.preventDefault();
        if (e.code === 'KeyS') saveProject(e.shiftKey);
        else if (e.code === 'KeyO') openProject();
        else newProject();
        return;
      }

      const el = e.target as HTMLElement;
      if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'range')) return;

      if (ctrl && e.code === 'KeyZ') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
      } else if (ctrl && e.code === 'KeyY') {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (e.code === 'Space') {
        e.preventDefault();
        playback.toggle();
      } else if (e.code === 'KeyS' && !ctrl) {
        splitAtPlayhead();
      } else if (e.code === 'KeyT' && !ctrl && !autoSubs.job) {
        addSubtitleAt(playback.getTime());
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        deleteSelected();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : FRAME) * (e.code === 'ArrowLeft' ? -1 : 1);
        playback.seek(playback.getTime() + step);
      } else if (e.code === 'Home') {
        playback.seek(0);
      } else if (e.code === 'End') {
        playback.seek(duration);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">🎬 영상 편집기</span>
          <div className="project-actions">
            <button className="btn" onClick={newProject} title="새 프로젝트 (Ctrl+N)">
              새로 만들기
            </button>
            <div className="split-button">
              <button className="btn" onClick={() => openProject()} title="프로젝트 열기 (Ctrl+O)">
                📂 열기
              </button>
              <RecentMenu refreshKey={recentKey} onOpen={(p) => openProject(p)} />
            </div>
            <button className="btn" onClick={() => saveProject(false)} title="저장 (Ctrl+S)">
              💾 저장
            </button>
            <button className="btn" onClick={() => saveProject(true)} title="다른 이름으로 저장 (Ctrl+Shift+S)">
              다른 이름으로
            </button>
          </div>
          <span className="project-name" title={projectPath ?? '아직 저장하지 않은 프로젝트'}>
            {projectName}
            {dirty && <span className="dirty">● 저장 안 됨</span>}
          </span>
        </div>
        <SubtitleJobBar
          job={autoSubs.job}
          result={autoSubs.result}
          onCancel={autoSubs.cancel}
          onDismiss={autoSubs.dismissResult}
        />
        <button
          className="btn primary"
          disabled={duration <= 0}
          onClick={() => {
            playback.pause();
            setExporting(true);
          }}
        >
          내보내기
        </button>
      </header>

      <main className="workspace">
        <div className="left-column">
          <div className="tabs">
            <button className={`tab ${leftTab === 'media' ? 'active' : ''}`} onClick={() => setLeftTab('media')}>
              🎞 미디어
            </button>
            <button className={`tab ${leftTab === 'subtitle' ? 'active' : ''}`} onClick={() => setLeftTab('subtitle')}>
              💬 자막 {project.subtitles.length > 0 && <span className="tab-count">{project.subtitles.length}</span>}
            </button>
          </div>
          {leftTab === 'media' ? (
            <MediaPanel
              media={media}
              selectedId={selection?.type === 'media' ? selection.id : null}
              onImport={importFiles}
              onSelect={(id) => setSelection({ type: 'media', id })}
              onRemove={removeMedia}
              onAddToTimeline={addToTimeline}
              onRelink={relinkMedia}
            />
          ) : (
            <SubtitlePanel
              subtitles={project.subtitles}
              selectedId={selectedSubtitle?.id ?? null}
              dispatch={dispatch}
              onSelect={(id) => setSelection({ type: 'subtitle', id })}
              onAddAtPlayhead={() => addSubtitleAt(playback.getTime())}
              onOpenAuto={() => {
                playback.pause();
                setAutoDialog({ firstRun: false });
              }}
              busy={!!autoSubs.job}
            />
          )}
        </div>
        <Preview
          project={project}
          media={mediaById}
          onDropFiles={importFiles}
          emptyContent={
            media.length === 0 ? (
              <RecentStart refreshKey={recentKey} onOpen={(p) => openProject(p)} onPickFiles={importFiles} />
            ) : undefined
          }
          selectedTextId={selectedText?.id ?? null}
          onSelectText={(id) => setSelection(id ? { type: 'text', id } : null)}
          dispatch={dispatch}
        />
        {selectedText ? (
          <TextInspector
            layer={selectedText}
            dispatch={dispatch}
            onRemove={() => {
              dispatch({ type: 'removeText', id: selectedText.id });
              setSelection(null);
            }}
          />
        ) : selectedSubtitle ? (
          <SubtitleInspector subtitle={selectedSubtitle} style={project.subtitleStyle} dispatch={dispatch} />
        ) : selectedTransitionClip ? (
          <TransitionInspector
            clip={selectedTransitionClip}
            effectiveDuration={transitionWindows(project).get(selectedTransitionClip.id)?.in?.duration ?? 0}
            dispatch={dispatch}
            onRemoved={() => setSelection(null)}
          />
        ) : (
          <Inspector
            clip={selectedClip}
            media={selectedMedia}
            dispatch={dispatch}
            onFitToVideo={
              selectedClip?.track === 'audio' && mainTrackEnd(project) > selectedClip.start
                ? (mode) =>
                    dispatch({
                      type: 'fitToVideo',
                      clipId: selectedClip.id,
                      mode,
                      sourceLimit: mediaLimit(selectedMedia ?? undefined),
                      idPrefix: crypto.randomUUID(),
                    })
                : undefined
            }
          />
        )}
      </main>

      <Timeline
        project={project}
        media={mediaById}
        selectedClipId={selectedClip?.id ?? null}
        selectedSubtitleId={selectedSubtitle?.id ?? null}
        selectedTransitionId={selectedTransitionClip?.id ?? null}
        onSelectTransition={(clipId) => setSelection({ type: 'transition', id: clipId })}
        selectedTextId={selectedText?.id ?? null}
        onSelectText={(id) => setSelection(id ? { type: 'text', id } : null)}
        onAddTextAt={addTextAt}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        dispatch={dispatch}
        onSelectClip={(id) => setSelection(id ? { type: 'clip', id } : null)}
        onSelectSubtitle={(id) => setSelection(id ? { type: 'subtitle', id } : null)}
        onAddMedia={addToTimeline}
        onAddSubtitleAt={addSubtitleAt}
        onSplit={splitAtPlayhead}
        onDelete={deleteSelected}
        onOpenRecorder={() => setRecorderOpen(true)}
      />

      {recorderOpen && (
        <RecorderPanel onRecorded={addRecording} onBusyChange={setRecordingBusy} onClose={() => setRecorderOpen(false)} />
      )}

      {exporting && <ExportDialog project={project} media={mediaById} onClose={() => setExporting(false)} />}

      {autoDialog && (
        <AutoSubtitleDialog
          project={project}
          media={mediaById}
          initial={loadAutoSubtitleSettings()}
          firstRun={autoDialog.firstRun}
          onStart={startAutoSubtitles}
          onClose={() => setAutoDialog(null)}
        />
      )}

      {recovery && (
        <RecoveryDialog
          projectPath={recovery.projectPath}
          savedAt={recovery.savedAt}
          onRecover={() => recover('recover')}
          onDiscard={() => recover('discard')}
        />
      )}
    </div>
  );
}
