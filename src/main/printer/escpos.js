// Constructor de comandos ESC/POS, el "idioma" de casi todas las impresoras
// termicas de tickets. No se imprime una imagen: se manda texto mezclado con
// comandos de pocos bytes (negrita, centrar, cortar, abrir cajon).
//
// Cada metodo regresa `this` para poder encadenar:
//   new EscPos().align('center').bold(true).line('Hola').cut().build()

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Las impresoras no entienden UTF-8: cada letra es UN byte de una "pagina de
// codigos". Esta tabla traduce los caracteres del espanol a CP850, la pagina
// mas comun en impresoras de tickets.
const CP850 = {
  'á': 0xa0, 'é': 0x82, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ü': 0x81, 'ñ': 0xa4,
  'Á': 0xb5, 'É': 0x90, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, 'Ü': 0x9a, 'Ñ': 0xa5,
  '¿': 0xa8, '¡': 0xad, '°': 0xf8, 'º': 0xa7, 'ª': 0xa6,
};

// Numero que espera el comando ESC t para elegir pagina de codigos.
const CODE_PAGE = { cp850: 2, cp1252: 16 };

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function encode(text, encoding) {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) {
      bytes.push(code); // ASCII: igual en todas las paginas de codigos
    } else if (encoding === 'cp850' && CP850[char] !== undefined) {
      bytes.push(CP850[char]);
    } else if (encoding === 'cp1252' && code >= 0xa0 && code <= 0xff) {
      bytes.push(code); // en este rango CP1252 coincide con Unicode
    } else {
      // Sin traduccion: se imprime sin acento, o '?' si ni asi existe.
      const plain = stripAccents(char);
      bytes.push(plain.length === 1 && plain.charCodeAt(0) < 0x80 ? plain.charCodeAt(0) : 0x3f);
    }
  }
  return Buffer.from(bytes);
}

// Parte un texto en renglones de `width` caracteres sin cortar palabras
// (salvo que una sola palabra no quepa).
function wrap(text, width) {
  const lines = [];
  let current = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

class EscPos {
  // columns: caracteres por renglon. 32 en papel de 58 mm; 42 o 48 en 80 mm.
  constructor({ columns = 32, encoding = 'cp850' } = {}) {
    this.columns = columns;
    this.encoding = encoding;
    this.parts = [];
    this.plain = ''; // copia en texto simple, para ver el ticket sin impresora
    this.widthFactor = 1;
    this.raw(ESC, 0x40); // ESC @ : reinicia la impresora a su estado inicial
    if (CODE_PAGE[encoding] !== undefined) this.raw(ESC, 0x74, CODE_PAGE[encoding]); // ESC t n
  }

  raw(...bytes) {
    this.parts.push(Buffer.from(bytes));
    return this;
  }

  text(value) {
    this.parts.push(encode(String(value), this.encoding));
    this.plain += String(value);
    return this;
  }

  line(value = '') {
    this.text(value);
    this.plain += '\n';
    return this.raw(LF);
  }

  align(where) {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[where]); // ESC a n
  }

  bold(on) {
    return this.raw(ESC, 0x45, on ? 1 : 0); // ESC E n
  }

  // Multiplica ancho y alto de la letra (1 o 2). Al doble de ancho caben la
  // mitad de caracteres por renglon; lineWidth lo toma en cuenta.
  size(width, height) {
    this.widthFactor = width;
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1)); // GS ! n
  }

  get lineWidth() {
    return Math.floor(this.columns / this.widthFactor);
  }

  rule(char = '-') {
    return this.line(char.repeat(this.lineWidth));
  }

  // Texto largo partido en renglones. indent = espacios al inicio de cada uno.
  wrapped(value, indent = 0) {
    for (const row of wrap(value, this.lineWidth - indent)) this.line(' '.repeat(indent) + row);
    return this;
  }

  // Texto a la izquierda y un valor pegado a la derecha (concepto ... importe).
  pair(left, right) {
    const value = String(right);
    const room = Math.max(1, this.lineWidth - value.length - 1);
    const rows = wrap(left, room);
    rows.forEach((row, index) => {
      if (index < rows.length - 1) this.line(row);
      else this.line(row.padEnd(room + 1) + value);
    });
    return this;
  }

  feed(lines = 1) {
    this.plain += '\n'.repeat(lines);
    return this.raw(ESC, 0x64, lines); // ESC d n
  }

  cut() {
    return this.raw(GS, 0x56, 66, 0); // GS V 66 0 : avanza y corta
  }

  // Manda un pulso electrico por el conector del cajon (el cable tipo
  // telefono que va de la impresora al cajon). 25 y 250 son los tiempos
  // de encendido/apagado del pulso; funcionan con la gran mayoria.
  kickDrawer() {
    return this.raw(ESC, 0x70, 0, 25, 250); // ESC p m t1 t2
  }

  build() {
    return { bytes: Buffer.concat(this.parts), plain: this.plain };
  }
}

module.exports = { EscPos, encode, wrap };
