// Limpieza de copias de respaldo viejas.
const fs = require('fs');
const path = require('path');

// Deja las `keep` copias mas recientes de un tipo (las que empiezan con
// `prefix`) y borra las demas. "Mas reciente" es por fecha del archivo, no
// por nombre: en el nombre va la version, y "0.1.10" ordenado como texto
// queda antes que "0.1.9".
function pruneBackups(folder, prefix, keep) {
  const files = fs
    .readdirSync(folder)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.db'))
    .map((name) => ({ name, time: fs.statSync(path.join(folder, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time || (a.name < b.name ? 1 : -1));
  for (const file of files.slice(keep)) fs.unlinkSync(path.join(folder, file.name));
}

module.exports = { pruneBackups };
