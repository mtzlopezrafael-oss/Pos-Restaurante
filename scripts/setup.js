// Prepara las dos piezas binarias del proyecto. Se corre con: npm run setup
//
// Por que existe este script:
//   1. Electron 22 es la ultima version que corre en Windows 7. Su paquete de npm
//      descarga el ejecutable en un script de instalacion.
//   2. better-sqlite3 es un modulo nativo (C++). Su script de instalacion intenta
//      bajar un binario para TU version de Node, y si no existe lo compila
//      (en Windows eso pide Visual Studio Build Tools). Nosotros no queremos el
//      binario para tu Node: queremos el de Electron 22, que ya viene precompilado.
//
// Por eso el .npmrc tiene ignore-scripts=true (npm install no ejecuta nada) y
// aqui pedimos exactamente lo que necesitamos.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ELECTRON_VERSION = require('../package.json').devDependencies.electron;
const root = path.join(__dirname, '..');
const forWindows = process.argv.includes('--win');

function run(label, args, cwd) {
  console.log(`\n> ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nFallo: ${label}`);
    process.exit(result.status || 1);
  }
}

// 1. Ejecutable de Electron (solo si falta).
const electronDir = path.join(root, 'node_modules', 'electron');
if (!fs.existsSync(path.join(electronDir, 'path.txt'))) {
  run(`Descargando Electron ${ELECTRON_VERSION}`, ['install.js'], electronDir);
} else {
  console.log(`Electron ${ELECTRON_VERSION} ya esta descargado.`);
}

// 2. Binario de better-sqlite3 compilado para Electron 22.
//    --win fuerza Windows x64 (para armar el instalador desde otro sistema).
const platform = forWindows ? 'win32' : process.platform;
const arch = forWindows ? 'x64' : process.arch;
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3');
const prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [sqliteDir] });

fs.rmSync(path.join(sqliteDir, 'build'), { recursive: true, force: true });
run(
  `Descargando better-sqlite3 para Electron ${ELECTRON_VERSION} (${platform}-${arch})`,
  [prebuildInstall, '--runtime=electron', `--target=${ELECTRON_VERSION}`, `--platform=${platform}`, `--arch=${arch}`],
  sqliteDir
);

console.log('\nListo. Arranca con: npm start');
