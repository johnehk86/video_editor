// VS Code 같은 Electron 기반 도구 안에서 실행하면 ELECTRON_RUN_AS_NODE가 상속되어
// Electron이 일반 Node처럼 동작한다. 이 변수를 지운 뒤 Electron을 띄운다.
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
