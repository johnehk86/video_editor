interface Props {
  projectPath: string | null;
  savedAt: string | null;
  onRecover: () => void;
  onDiscard: () => void;
}

const fileName = (p: string) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);

/** 지난번에 저장하지 않고 꺼진 작업을 되살릴지 묻는다. */
export default function RecoveryDialog({ projectPath, savedAt, onRecover, onDiscard }: Props) {
  const when = savedAt ? new Date(savedAt).toLocaleString('ko-KR') : '알 수 없음';
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>🛟 작업 복구</h2>
        <p>지난번에 저장하지 않은 채 편집기가 종료되었어요. 자동 저장된 작업을 되살릴까요?</p>
        <ul className="modal-bullets">
          <li>프로젝트: {projectPath ? fileName(projectPath) : '저장한 적 없는 새 프로젝트'}</li>
          <li>마지막 자동 저장: {when}</li>
          <li>복구한 뒤 💾 저장해야 원래 파일에 반영돼요.</li>
        </ul>
        <div className="modal-actions">
          <button className="btn" onClick={onDiscard}>
            버리기
          </button>
          <button className="btn primary" onClick={onRecover}>
            복구하기
          </button>
        </div>
      </div>
    </div>
  );
}
