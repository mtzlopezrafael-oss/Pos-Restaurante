// Corre las pruebas DENTRO del Node que trae Electron 22 (Node 16).
// Asi se prueba con el mismo motor y el mismo binario de SQLite que usa la
// app real. ELECTRON_RUN_AS_NODE=1 hace que el ejecutable de Electron se
// comporte como `node`, sin abrir ventanas.
const { spawnSync } = require('child_process');
const path = require('path');

const electron = require('electron'); // en Node normal, esto es la ruta al ejecutable
const result = spawnSync(electron, [path.join(__dirname, '..', 'test', 'logic.test.js')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_NO_WARNINGS: '1' },
});
process.exit(result.status === null ? 1 : result.status);
