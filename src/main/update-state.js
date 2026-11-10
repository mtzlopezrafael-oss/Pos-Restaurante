// Estado de las actualizaciones en disco. Lo usan el lanzador (boot.js) y el
// actualizador (updater.js). Vive en <carpeta de datos>/updates/:
//
//   code-0.1.4.asar   el codigo de una version descargada
//   state.json        cual usar y como le fue:
//     current  { version, file, sha256 }  la descarga mas reciente ya verificada
//     good     { version, file, sha256 }  la ultima descarga que arranco bien
//     boot     { version, attempts }      arranque en curso, aun sin confirmar
//     failed   ["0.1.4"]                  versiones que no arrancaron: no se reintentan
//
// OJO: el lanzador instalado y el codigo descargado pueden ser de versiones
// distintas y ambos leen este archivo. Si cambias su formato, que sea solo
// AGREGANDO campos.

// original-fs es el fs de Node sin el "truco" de Electron que trata los .asar
// como carpetas. Para copiar, borrar o leer un .asar completo hace falta este.
const fs = require('original-fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = /^\d+\.\d+\.\d+$/;
const BUNDLE = /^code-\d+\.\d+\.\d+\.asar$/;
const MAX_ATTEMPTS = 2; // arranques sin confirmar antes de descartar una version

// 1 si a > b, -1 si a < b, 0 si son iguales. "0.1.10" es mayor que "0.1.9".
function compareVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
const newer = (a, b) => compareVersions(a, b) > 0;

const hashOf = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const sha256 = (file) => hashOf(fs.readFileSync(file));

function readState(dir) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) || {};
  } catch (error) {
    // No existe o esta danado: se empieza de cero (se usara la version instalada).
  }
  return {
    ...saved, // se conservan campos que una version mas nueva haya agregado
    current: saved.current || null,
    good: saved.good || null,
    boot: saved.boot || null,
    failed: Array.isArray(saved.failed) ? saved.failed : [],
  };
}

// Escribe a un temporal y renombra: si se va la luz a media escritura, queda
// el archivo anterior completo y no uno a medias.
function writeState(dir, state) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

// Una descarga sirve si esta bien descrita, es mas nueva que lo instalado, no
// ha fallado antes y el archivo sigue teniendo el hash con que se verifico.
function usable(dir, entry, installedVersion, failed) {
  if (!entry || !VERSION.test(entry.version || '') || !BUNDLE.test(entry.file || '')) return false;
  if (!newer(entry.version, installedVersion) || failed.includes(entry.version)) return false;
  try {
    return sha256(path.join(dir, entry.file)) === entry.sha256;
  } catch (error) {
    return false; // falta el archivo; el actualizador lo volvera a bajar
  }
}

// Decide con que codigo arrancar y cuenta el intento. Prueba primero la
// descarga mas reciente (current) y luego la ultima que si funciono (good).
// Regresa { version, file } o null (se usa la version instalada).
function chooseUpdate(dir, installedVersion) {
  const state = readState(dir);
  let chosen = null;
  let changed = false;
  for (const entry of [state.current, state.good]) {
    if (!usable(dir, entry, installedVersion, state.failed)) continue;
    const attempts = state.boot && state.boot.version === entry.version ? state.boot.attempts : 0;
    if (attempts >= MAX_ATTEMPTS) {
      // Ya arranco dos veces y ninguna confirmo que quedo funcionando.
      state.failed.push(entry.version);
      state.boot = null;
      changed = true;
      continue;
    }
    state.boot = { version: entry.version, attempts: attempts + 1 };
    changed = true;
    chosen = { version: entry.version, file: path.join(dir, entry.file) };
    break;
  }
  if (changed) writeState(dir, state);
  return chosen;
}

// El codigo de esa version ya mostro su primera pantalla: el arranque fue
// bueno y pasa a ser la version de respaldo ("good").
function confirmBoot(dir, version) {
  const state = readState(dir);
  state.boot = null;
  if (state.current && state.current.version === version) state.good = state.current;
  writeState(dir, state);
}

function markFailed(dir, version) {
  const state = readState(dir);
  if (!state.failed.includes(version)) state.failed.push(version);
  state.boot = null;
  writeState(dir, state);
}

module.exports = { VERSION, BUNDLE, compareVersions, newer, hashOf, sha256, readState, writeState, chooseUpdate, confirmBoot, markFailed };
