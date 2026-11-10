// Ordena productos para que los de nombre parecido queden juntos, aunque
// empiecen distinto ("Yoghurt especial med" junto a "Especial yoghurt gde").
// Es solo una forma de ACOMODAR la lista al mostrarla: no cambia ningun dato.
//
// Como decide:
//   1. Parte cada nombre en palabras y descarta las de relleno (de, con, la...)
//      y las de tamano (ch, med, gde, 500 ml...).
//   2. Busca la palabra que mas productos comparten y hace un grupo con ellos.
//      En empate gana la que suele ir al inicio del nombre, que casi siempre
//      es el tipo de producto (Agua, Licuado) y no el sabor (fresa).
//   3. Repite con los productos que quedan, y luego dentro de cada grupo
//      (asi los "especial" quedan juntos dentro de los yoghurts).
//   4. Los grupos van en orden alfabetico y, dentro del mismo nombre, del
//      tamano mas chico al mas grande.

const FILLER = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'sin', 'y', 'o', 'e', 'a', 'al', 'en', 'para', 'por', 'c', 's', 'un', 'una']);

// Palabras de tamano y su orden.
const SIZE = {
  mini: 1, ch: 2, chico: 2, chica: 2, peq: 2, pequeno: 2, pequena: 2,
  med: 3, mediano: 3, mediana: 3, gde: 4, gd: 4, grande: 4, jumbo: 5, xl: 5, extra: 5, familiar: 6,
};

// Unidades, convertidas a una base comun para comparar 500 ml contra 1 lt.
const UNIT = { ml: 1, l: 1000, lt: 1000, lts: 1000, litro: 1000, litros: 1000, g: 1, gr: 1, grs: 1, kg: 1000, oz: 30, pz: 1, pza: 1, pzas: 1, pieza: 1, piezas: 1 };

const plain = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// "fresas" y "fresa" cuentan como la misma palabra.
const singular = (word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word);

// Separa un nombre en { words: palabras que identifican al producto, size: numero para ordenar por tamano }.
export function analyze(name) {
  const text = plain(name).replace(/(\d)\s*\/\s*(\d)/g, (match, a, b) => String(Number(a) / Number(b))); // 1/2 -> 0.5
  const tokens = text.split(/[^a-z0-9.]+/).map((token) => token.replace(/^\.+|\.+$/g, '')).filter(Boolean);

  const words = [];
  let rank = 0;
  let amount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const number = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(token);
    if (number) {
      let unit = number[2];
      if (!unit && UNIT[tokens[i + 1]] !== undefined) unit = tokens[++i]; // "500 ml": la unidad venia aparte
      amount += Number(number[1]) * (UNIT[unit] || 1);
    } else if (SIZE[token] !== undefined) {
      rank = SIZE[token];
    } else if (UNIT[token] === undefined && !FILLER.has(token)) {
      words.push(singular(token));
    }
  }
  return { words, size: rank * 1e7 + amount };
}

// La mejor palabra para agrupar: la mas compartida, con ventaja para las que
// van al inicio del nombre. Regresa null si ninguna se repite.
function bestWord(items) {
  const stats = new Map(); // palabra -> { count, first, positions }
  for (const item of items) {
    item.words.forEach((word, index) => {
      if (item.words.indexOf(word) !== index) return; // repetida en el mismo nombre
      const stat = stats.get(word) || { count: 0, first: 0, positions: 0 };
      stat.count += 1;
      stat.positions += index;
      if (index === 0) stat.first += 1;
      stats.set(word, stat);
    });
  }
  let best = null;
  for (const [word, stat] of stats) {
    if (stat.count < 2) continue;
    const candidate = { word, score: stat.count * (1 + stat.first / stat.count), position: stat.positions / stat.count };
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.position < best.position) ||
      (candidate.score === best.score && candidate.position === best.position && candidate.word < best.word)
    ) {
      best = candidate;
    }
  }
  return best ? best.word : null;
}

function arrange(items) {
  if (items.length < 2) return items;
  const entries = []; // { key, size, name, items }
  let rest = items;

  for (let word = bestWord(rest); word; word = bestWord(rest)) {
    const members = rest.filter((item) => item.words.includes(word));
    rest = rest.filter((item) => !item.words.includes(word));
    // Dentro del grupo se repite el proceso sin la palabra que ya los unio.
    const inner = members.map((item) => ({ ...item, words: item.words.filter((w) => w !== word) }));
    entries.push({ key: word, size: 0, name: word, items: arrange(inner) });
  }
  for (const item of rest) entries.push({ key: item.words.join(' '), size: item.size, name: item.name, items: [item] });

  entries.sort((a, b) => a.key.localeCompare(b.key, 'es') || a.size - b.size || a.name.localeCompare(b.name, 'es'));
  return entries.flatMap((entry) => entry.items);
}

// products: [{ name, ... }]. Regresa los mismos objetos en otro orden.
export function arrangeBySimilarity(products) {
  const items = products.map((product) => ({ product, name: plain(product.name), ...analyze(product.name) }));
  return arrange(items).map((item) => item.product);
}
