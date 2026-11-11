// Proceso principal de Electron: crea la ventana, abre la base de datos y
// registra las operaciones que la pantalla puede pedir.
//
// Electron tiene dos mundos:
//   - Proceso principal (este archivo): es Node. Toca disco, base de datos,
//     impresora.
//   - Renderer (src/renderer): es una pagina web dentro de Chromium. Solo
//     dibuja la interfaz y pide cosas por IPC a traves del preload.
//
// Banderas utiles al arrancar:
//   --dev     ventana normal de 1024x768 con herramientas de desarrollo (F12)
//   --no-gpu  apaga la aceleracion por GPU (si la pantalla sale negra o con
//             parpadeos en una terminal vieja)

const { app, BrowserWindow, Menu, session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./db');
const { createServices } = require('./services');
const { registerIpc } = require('./ipc');
const { createUpdater } = require('./updater');
const { newer, markFailed } = require('./update-state');
const { pruneBackups } = require('./backups');

// Version del codigo que esta corriendo. No se usa app.getVersion(): esa es la
// del programa instalado, y este codigo puede venir de una actualizacion.
const { version } = require('../../package.json');
// Lo que dejo el lanzador (boot.js). El respaldo es por si alguien arranca
// este archivo directo, sin pasar por el lanzador.
const boot = global.posBoot || {
  installedVersion: version,
  updatesDir: path.join(app.getPath('userData'), 'updates'),
  source: 'installed',
  confirmHealthy() {},
};

const isDev = process.argv.includes('--dev');
if (process.argv.includes('--no-gpu')) app.disableHardwareAcceleration();

// La app es 100 % local, pero Chromium por su cuenta intenta salir a internet
// (bajar un diccionario de ortografia, probar DNS seguro). Con esto ningun
// nombre de dominio se resuelve, asi que no puede conectarse a nada.
// La impresora de red no se ve afectada: usa el modulo `net` de Node, no Chromium.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-features', 'DnsOverHttpsUpgrade');

// Una sola copia abierta: dos toques seguidos al icono no abren dos cajas.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let db = null;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // Copia la base de datos a /backups y conserva las 30 copias mas recientes.
  async function backup(dataDir) {
    const folder = path.join(dataDir, 'backups');
    fs.mkdirSync(folder, { recursive: true });
    const name = `pos-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    await db.backup(path.join(folder, name)); // copia consistente aunque la app siga en uso
    pruneBackups(folder, 'pos-', 30);
  }

  // Al estrenar version (instalada a mano o por actualizacion automatica) se
  // guarda una copia de la base tal como estaba, ANTES de que el codigo nuevo
  // la toque. Regresa la version anterior, o null si no hubo cambio.
  function backupBeforeNewVersion(dataDir, dbFile, rawDb) {
    const marker = path.join(dataDir, 'last-version.txt');
    let previous = null;
    try {
      previous = fs.readFileSync(marker, 'utf8').trim();
    } catch (error) {
      // primera vez que corre una version con este control
    }
    if (previous === version) return null;
    try {
      const folder = path.join(dataDir, 'backups');
      fs.mkdirSync(folder, { recursive: true });
      const name = `antes-de-${version}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      rawDb.prepare('VACUUM INTO ?').run(path.join(folder, name)); // copia completa y consistente
      pruneBackups(folder, 'antes-de-', 5);
    } catch (error) {
      console.error('No se pudo respaldar antes de estrenar version:', error);
    }
    fs.writeFileSync(marker, version);
    return previous;
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1024,
      height: 768,
      kiosk: !isDev, // pantalla completa sin barra de tareas ni bordes
      backgroundColor: '#EEF1F4',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true, // la pagina no comparte variables con el preload
        nodeIntegration: false, // la pagina no puede usar require() ni Node
        sandbox: true,
        spellcheck: false,
      },
    });

    if (!isDev) Menu.setApplicationMenu(null); // sin menu: tampoco atajos como Ctrl+R

    win.once('ready-to-show', () => win.show());

    // La app es un solo archivo local: nunca debe navegar a otra pagina ni
    // abrir ventanas. (Chromium 108 ya no recibe parches de seguridad.)
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Sin zoom por pellizco: en un POS solo estorba.
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});

    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  }

  function start() {
    session.defaultSession.setSpellCheckerEnabled(false); // sin corrector: no hay cajas de texto libres
    // En Windows: C:\Users\<usuario>\AppData\Roaming\POS Restaurante
    const dataDir = app.getPath('userData');
    fs.mkdirSync(dataDir, { recursive: true });
    const dbFile = path.join(dataDir, 'pos.db');
    const isNewInstall = !fs.existsSync(dbFile);
    let updatedFrom = null;
    db = openDatabase(dbFile, {
      beforeMigrate(rawDb) {
        if (isNewInstall) fs.writeFileSync(path.join(dataDir, 'last-version.txt'), version);
        else updatedFrom = backupBeforeNewVersion(dataDir, dbFile, rawDb);
      },
    });

    const updater = createUpdater({ boot, version });
    updater.start();

    registerIpc({
      services: createServices(db),
      dataDir,
      backup: () => backup(dataDir),
      quit: () => app.quit(),
      restart: () => {
        app.relaunch(); // abre otra copia en cuanto esta termine de cerrar
        app.quit();
      },
      updater,
      confirmHealthy: () => boot.confirmHealthy(),
      appInfo: {
        version,
        installedVersion: boot.installedVersion,
        source: boot.source, // 'installed' o 'update'
        // Primer arranque despues de cambiar de version: de cual venia. Si venia
        // de una MAS NUEVA es que esa fallo y el lanzador regreso a esta.
        updatedFrom: updatedFrom && !newer(updatedFrom, version) ? updatedFrom : null,
        rolledBackFrom: updatedFrom && newer(updatedFrom, version) ? updatedFrom : null,
        dbFile,
        electron: process.versions.electron,
      },
    });

    createWindow();
  }

  // Errores de SQLite que son del equipo (archivo danado, disco lleno, sin
  // permiso) y no de esta version del programa.
  const DISK_PROBLEM = /^SQLITE_(CORRUPT|NOTADB|CANTOPEN|FULL|IOERR|READONLY|BUSY|LOCKED|PERM|AUTH)/;

  // Si el arranque falla (lo tipico: no se pudo abrir o migrar la base), el
  // programa no debe quedarse corriendo sin ventana: o regresa a la version
  // anterior, o explica que paso y se cierra.
  app.whenReady().then(start).catch((error) => {
    console.error('No se pudo arrancar:', error);
    const diskProblem = DISK_PROBLEM.test(error.code || '');
    if (boot.source === 'update' && !diskProblem) {
      // Esta version llego por actualizacion y no arranca: se descarta y se
      // reinicia con la anterior, sin esperar al temporizador del lanzador.
      markFailed(boot.updatesDir, version);
      app.relaunch();
      app.exit(0);
      return;
    }
    if (diskProblem) boot.confirmHealthy(); // el problema es del equipo: no culpar a la version
    dialog.showErrorBox(
      'POS Restaurante no pudo abrir',
      `${error.message}\n\nLos datos están en:\n${app.getPath('userData')}\n\nEn la carpeta "backups" hay copias de la base de datos.`
    );
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (db) db.close();
  });
}
