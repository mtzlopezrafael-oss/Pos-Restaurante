// Publica el paquete que armo `npm run bundle`: lo sube a la rama `updates`
// del repo, que es de donde los POS bajan las actualizaciones.
//
//   npm run bundle -- "Que cambio"
//   npm run publish-update
//
// La rama `updates` no tiene codigo fuente: solo latest.json y los paquetes
// code-X.Y.Z.asar (se conservan los 3 mas nuevos, por si una terminal alcanza
// a leer un latest.json viejo mientras se publica).

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const release = path.join(root, 'dist', 'release');
const git = (args, cwd = root) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const manifest = JSON.parse(fs.readFileSync(path.join(release, 'latest.json'), 'utf8'));
if (manifest.version !== require(path.join(root, 'package.json')).version) {
  throw new Error('dist/release no corresponde a la version de package.json: corre `npm run bundle` otra vez.');
}

// Se trabaja en una carpeta temporal (un "worktree") para no mover la rama actual.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-updates-'));
let branchExists = true;
try {
  git(['fetch', '--depth', '1', 'origin', 'updates']);
} catch (error) {
  branchExists = false;
}
if (branchExists) {
  git(['worktree', 'add', '--force', '-B', 'updates', work, 'FETCH_HEAD']);
} else {
  git(['worktree', 'add', '--detach', work]);
  git(['checkout', '--orphan', 'updates'], work);
  git(['rm', '-rf', '--quiet', '.'], work);
}

try {
  fs.copyFileSync(path.join(release, manifest.file), path.join(work, manifest.file));
  fs.copyFileSync(path.join(release, 'latest.json'), path.join(work, 'latest.json'));
  fs.writeFileSync(
    path.join(work, 'README.md'),
    '# Actualizaciones del POS\n\nEsta rama la escribe `scripts/publish.js`. No la edites a mano: los POS instalados\nleen `latest.json` de aqui y descargan el paquete que indica.\n'
  );

  // Conserva los 3 paquetes mas nuevos.
  const byVersion = (a, b) => {
    const x = a.match(/\d+/g).map(Number);
    const y = b.match(/\d+/g).map(Number);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  };
  const bundles = fs.readdirSync(work).filter((name) => /^code-\d+\.\d+\.\d+\.asar$/.test(name)).sort(byVersion);
  for (const old of bundles.slice(3)) fs.unlinkSync(path.join(work, old));

  git(['add', '-A'], work);
  // POS_PUBLISH_NOTE: texto opcional que se agrega al final del mensaje del commit.
  const note = process.env.POS_PUBLISH_NOTE ? `\n\n${process.env.POS_PUBLISH_NOTE}` : '';
  git(['commit', '--quiet', '-m', `Publica ${manifest.version}${manifest.notes ? `: ${manifest.notes}` : ''}${note}`], work);
  git(['push', 'origin', 'updates'], work);
  console.log(`Publicada la version ${manifest.version}. Las terminales la bajan solas (GitHub puede tardar unos minutos en mostrarla).`);
} finally {
  git(['worktree', 'remove', '--force', work]);
}
