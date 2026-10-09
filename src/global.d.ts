interface Window {
  editorApi: {
    getPathForFile: (file: File) => string;
    exportVideo: (plan: import('./utils/exportPlan').ExportPlan) => Promise<import('./utils/exportPlan').ExportResult>;
    cancelExport: () => Promise<void>;
    onExportProgress: (callback: (progress: number) => void) => () => void;
    showItemInFolder: (path: string) => Promise<void>;
    saveRecording: (data: ArrayBuffer) => Promise<{ path: string; name: string }>;
    getSttStatus: () => Promise<{ engine: boolean; models: Record<'base' | 'small' | 'turbo', boolean> }>;
    transcribe: (request: {
      plan: import('./utils/exportPlan').ExportPlan;
      model: 'base' | 'small' | 'turbo';
      language: string;
    }) => Promise<
      | { status: 'done'; segments: { start: number; end: number; text: string }[] }
      | { status: 'canceled' }
      | { status: 'error'; message: string }
    >;
    cancelTranscribe: () => Promise<void>;
    onSttProgress: (
      callback: (p: { phase: 'engine' | 'model' | 'audio' | 'recognize'; progress: number }) => void,
    ) => () => void;
    onSttSegment: (callback: (segment: { start: number; end: number; text: string }) => void) => () => void;
    saveSrt: (content: string) => Promise<string | null>;
    saveProject: (request: {
      data: import('./state/projectFile').ProjectFileData;
      path: string | null;
      saveAs: boolean;
    }) => Promise<string | null>;
    openProject: (filePath?: string) => Promise<{ path: string; data: unknown } | { error: string } | null>;
    listRecent: () => Promise<{ path: string; name: string; openedAt: string; exists: boolean }[]>;
    removeRecent: (filePath: string) => Promise<void>;
    writeAutosave: (data: import('./state/projectFile').ProjectFileData, projectPath: string | null) => Promise<void>;
    readAutosave: () => Promise<{ data: unknown; projectPath: string | null; savedAt: string | null } | null>;
    clearAutosave: () => Promise<void>;
    locateMedia: (
      folder: string,
      items: { id: string; path: string }[],
    ) => Promise<{ id: string; path: string; size: number }[]>;
    confirmUnsaved: () => Promise<'save' | 'discard' | 'cancel'>;
    setDirty: (dirty: boolean) => void;
    onCloseRequested: (callback: () => void) => () => void;
    approveClose: () => void;
    onOpenFile: (callback: (filePath: string) => void) => () => void;
  };
}
