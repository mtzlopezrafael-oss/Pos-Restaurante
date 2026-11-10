// Actualizador: busca una version nueva en GitHub Releases, la descarga y la
// deja lista para el siguiente arranque. Nunca reinicia por su cuenta ni
// toca la base de datos; quien decide con que codigo arrancar es boot.js.
//
// En cada release hay dos archivos:
//   latest.json       { version, file, sha256, size, notes, minLauncher }
//   code-X.Y.Z.asar   el codigo de esa version (carpeta src + package.json)
//
// Seguridad: lo que se descarga aqui es codigo que se va a ejecutar en la caja.
//   - Solo se habla por HTTPS con github.com y su red de descargas.
//   - El archivo debe medir y tener el hash SHA-256 que dice latest.json.
//   - Eso protege contra descargas danadas o alteradas en el camino. NO protege
//     si alguien entra a la cuenta de GitHub: por eso la cuenta lleva 2FA.
//
// Usa el modulo https de Node, no el de Chromium (que esta bloqueado en main.js).

const https = require('https');
const http = require('http');
const fs = require('original-fs');
const path = require('path');
const { REPO } = require('./update-config');
const { VERSION, BUNDLE, newer, hashOf, sha256, readState, writeState } = require('./update-state');

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 30 * 1024 * 1024;
const ALLOWED_HOST = /^(github\.com|[a-z0-9-]+\.githubusercontent\.com)$/;
const FIRST_CHECK_MS = 20 * 1000;
const RECHECK_MS = 6 * 60 * 60 * 1000;

const isLocal = (url) => url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');

// POS_UPDATE_URL solo sirve para pruebas contra un servidor en esta misma maquina.
function baseUrl() {
  const test = process.env.POS_UPDATE_URL || '';
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(test) ? test : `https://github.com/${REPO}/releases`;
}

// Descarga una URL a memoria, siguiendo redirecciones (GitHub manda los
// archivos de un release a otro servidor) y con tope de tamano.
function download(address, maxBytes, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const url = new URL(address);
    if (!isLocal(url) && !(url.protocol === 'https:' && ALLOWED_HOST.test(url.hostname))) {
      reject(new Error(`Destino no permitido: ${url.hostname}`));
      return;
    }
    const client = isLocal(url) ? http : https;
    const request = client.get(url, { headers: { 'User-Agent': 'pos-restaurante' }, timeout: 20000 }, (response) => {
      const { statusCode, headers } = response;
      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location) {
        response.resume();
        if (redirectsLeft === 0) reject(new Error('Demasiadas redirecciones'));
        else resolve(download(new URL(headers.location, url).href, maxBytes, redirectsLeft - 1));
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(Object.assign(new Error(`El servidor respondió ${statusCode}`), { statusCode }));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) request.destroy(new Error('La descarga es más grande de lo permitido'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
  });
}

// Convierte un error tecnico en una frase para la pantalla de Ajustes.
function explain(error) {
  if (error.statusCode === 404) return 'Todavía no hay versiones publicadas.';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error.code)) {
    return 'No hay conexión a internet. Se intentará de nuevo más tarde.';
  }
  return `No se pudo actualizar: ${error.message}`;
}

function readManifest(buffer) {
  const manifest = JSON.parse(buffer.toString('utf8'));
  const valid =
    manifest &&
    VERSION.test(manifest.version || '') &&
    BUNDLE.test(manifest.file || '') &&
    manifest.file === `code-${manifest.version}.asar` &&
    /^[0-9a-f]{64}$/.test(manifest.sha256 || '') &&
    Number.isInteger(manifest.size) && manifest.size > 0 && manifest.size <= MAX_BUNDLE_BYTES &&
    (manifest.minLauncher === undefined || VERSION.test(manifest.minLauncher));
  if (!valid) throw new Error('la lista de versiones (latest.json) no es válida');
  return manifest;
}

// boot: lo que dejo boot.js en global.posBoot. version: la del codigo que esta corriendo.
function createUpdater({ boot, version }) {
  let status = { state: 'idle', message: 'Todavía no se ha buscado.', version: null, notes: '', checkedAt: null };
  let running = null; // promesa de la busqueda en curso, para no hacer dos a la vez
  let ready = null; // el estado "lista para instalar", por si una busqueda posterior falla

  const set = (changes) => {
    status = { ...status, ...changes };
  };

  async function run() {
    set({ state: 'checking', message: 'Buscando actualización…' });
    const base = baseUrl();
    const manifest = readManifest(await download(`${base}/latest/download/latest.json`, MAX_MANIFEST_BYTES));
    const found = { version: manifest.version, notes: String(manifest.notes || '').slice(0, 300), checkedAt: new Date().toISOString() };

    if (!newer(manifest.version, version)) {
      ready = null;
      set({ ...found, state: 'current', version: null, message: `Tienes la versión más reciente (${version}).` });
      return;
    }
    const state = readState(boot.updatesDir);
    if (state.failed.includes(manifest.version)) {
      set({ ...found, state: 'blocked', message: `La versión ${manifest.version} no arrancó bien en este equipo. Se instalará la siguiente que se publique.` });
      return;
    }
    if (manifest.minLauncher && newer(manifest.minLauncher, boot.installedVersion)) {
      set({ ...found, state: 'blocked', message: `La versión ${manifest.version} necesita reinstalar el programa completo.` });
      return;
    }

    const file = path.join(boot.updatesDir, manifest.file);
    let alreadyHere = false;
    try {
      alreadyHere = sha256(file) === manifest.sha256;
    } catch (error) {
      // todavia no se descarga
    }
    if (!alreadyHere) {
      set({ ...found, state: 'downloading', message: `Descargando la versión ${manifest.version}…` });
      const data = await download(`${base}/download/v${manifest.version}/${manifest.file}`, MAX_BUNDLE_BYTES);
      if (data.length !== manifest.size || hashOf(data) !== manifest.sha256) {
        throw new Error('la descarga llegó incompleta o alterada y se descartó');
      }
      fs.mkdirSync(boot.updatesDir, { recursive: true });
      fs.writeFileSync(`${file}.part`, data);
      fs.renameSync(`${file}.part`, file);
    }

    // A partir de aqui boot.js la usara en el siguiente arranque.
    state.current = { version: manifest.version, file: manifest.file, sha256: manifest.sha256 };
    state.boot = null;
    writeState(boot.updatesDir, state);

    // Limpieza de descargas viejas. Si alguna es la que esta corriendo, Windows
    // no deja borrarla (esta abierta); se ira en una limpieza posterior.
    for (const name of fs.readdirSync(boot.updatesDir)) {
      const keep = name === manifest.file || (state.good && name === state.good.file); // la nueva y la de respaldo
      if (keep || !(BUNDLE.test(name) || name.endsWith('.part'))) continue;
      try {
        fs.unlinkSync(path.join(boot.updatesDir, name));
      } catch (error) {
        // en uso
      }
    }
    set({ ...found, state: 'ready', message: `La versión ${manifest.version} está lista. Se instala al reiniciar el programa.` });
    ready = status;
  }

  function check() {
    if (!running) {
      running = run()
        .catch((error) => {
          // Si ya habia una version lista para instalar, un fallo posterior no la quita.
          if (ready) status = ready;
          else set({ state: 'error', message: explain(error), checkedAt: new Date().toISOString() });
          if (!error.code && !error.statusCode) console.error('Actualizador:', error);
        })
        .then(() => {
          running = null;
          return status;
        });
    }
    return running;
  }

  return {
    status: () => status,
    check,
    start() {
      setTimeout(check, FIRST_CHECK_MS).unref();
      setInterval(check, RECHECK_MS).unref();
    },
  };
}

module.exports = { createUpdater };
