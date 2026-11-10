// Arma lo que se sube a un Release de GitHub para que los POS se actualicen solos.
//
//   npm run bundle -- "Texto corto de novedades"
//
// Deja en dist/release/:
//   code-X.Y.Z.asar   el codigo de esta version (src/ + package.json), sin
//                     node_modules: el POS usa los que ya tiene instalados.
//   latest.json       version, nombre, tamano y hash SHA-256 del archivo.
//
// Para publicar: sube la version en package.json, corre este script y crea el
// release con tag vX.Y.Z adjuntando los dos archivos (ver README).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');

// Lanzador minimo que esta version necesita instalado. Solo se sube cuando el
// codigo nuevo dependa de algo que cambio en boot.js o en node_modules.
const MIN_LAUNCHER = '0.1.3';

async function main() {
  const root = path.join(__dirname, '..');
  const pkg = require(path.join(root, 'package.json'));
  const notes = process.argv.slice(2).join(' ').trim();
  const out = path.join(root, 'dist', 'release');
  const stage = path.join(root, 'dist', 'release-stage');

  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // Solo codigo propio: src/ y un package.json minimo (de ahi se lee la version).
  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }, null, 2)
  );

  const file = `code-${pkg.version}.asar`;
  await asar.createPackage(stage, path.join(out, file));
  fs.rmSync(stage, { recursive: true, force: true });

  const data = fs.readFileSync(path.join(out, file));
  const manifest = {
    version: pkg.version,
    file,
    size: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    minLauncher: MIN_LAUNCHER,
    notes,
  };
  fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Listo: dist/release/${file} (${data.length} bytes) y latest.json`);
  console.log(manifest);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
