// Lanzador: es lo primero que corre (package.json -> "main").
//
// El programa instalado trae su propio codigo, pero una actualizacion
// automatica NO lo reemplaza: se descarga aparte, a la carpeta de datos, como
// un solo archivo (code-X.Y.Z.asar). Este lanzador decide con cual arrancar:
//
//   - Si hay una descarga mas nueva que la instalada, con su hash correcto y
//     que no haya fallado antes, arranca con esa.
//   - Si esa no sirve, prueba con la ultima descarga que si funciono.
//   - En cualquier otro caso arranca con el codigo instalado.
//
// Asi una actualizacion mala nunca deja la caja sin abrir: si la version
// nueva truena al cargar, o no llega a mostrar su pantalla, se marca como
// fallida y el programa se reinicia solo con la version anterior.
//
// Este archivo solo cambia cuando se reinstala el programa completo, asi que
// se mantiene chico y sin dependencias del resto del codigo.

const { app } = require('electron');
const path = require('path');
const { chooseUpdate, confirmBoot, markFailed } = require('./update-state');

const installedVersion = require('../../package.json').version;
const updatesDir = path.join(app.getPath('userData'), 'updates');
// Tiempo maximo para que la version nueva muestre su pantalla.
const HEALTH_TIMEOUT_MS = Number(process.env.POS_HEALTH_TIMEOUT_MS) || 90000;

// Una sola copia abierta. Se revisa aqui, antes de contar un intento de
// arranque: abrir el programa dos veces no debe contar como arranque fallido.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // El codigo descargado no trae node_modules. Con esto, sus require() de
  // paquetes (better-sqlite3) se resuelven con los del programa instalado.
  const installedModules = path.join(__dirname, '..', '..', 'node_modules');
  process.env.NODE_PATH = [installedModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
  require('module').Module._initPaths();

  const update = chooseUpdate(updatesDir, installedVersion);
  let watchdog = null;

  const fallBack = (reason) => {
    console.error(`La version ${update.version} no arranco (${reason}). Se regresa a la anterior.`);
    markFailed(updatesDir, update.version);
    app.relaunch();
    app.exit(0);
  };

  // Lo que el resto del programa necesita saber del arranque.
  global.posBoot = {
    installedVersion,
    updatesDir,
    source: update ? 'update' : 'installed',
    confirmHealthy() {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      if (update) confirmBoot(updatesDir, update.version);
    },
  };

  if (!update) {
    require('./main.js');
  } else {
    watchdog = setTimeout(() => fallBack('no mostro su pantalla a tiempo'), HEALTH_TIMEOUT_MS);
    try {
      // Electron sabe hacer require() de archivos dentro de un .asar.
      require(path.join(update.file, 'src', 'main', 'main.js'));
    } catch (error) {
      console.error(error);
      fallBack('error al cargar');
    }
  }
}
