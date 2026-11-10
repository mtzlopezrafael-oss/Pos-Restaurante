// Teclado y teclado numerico en pantalla.
//
// Windows 7 no muestra solo un teclado tactil util, asi que la app trae el
// suyo: cada vez que hace falta capturar un numero o un texto se abre una de
// estas ventanas. Tambien aceptan el teclado fisico (comodo para desarrollar).

import { h, add, btn, money, openModal } from './ui.js';

// ---------- Captura de numeros ----------
// Guarda lo tecleado como texto ("12.5") y lo convierte al final.
// mode 'money' -> value() regresa centavos. mode 'int' -> entero.
export function amountState(mode, initial = null) {
  let text = '';
  let fresh = true; // la primera tecla reemplaza el valor inicial
  const asText = (value) => (mode === 'money' ? (value / 100).toFixed(2).replace(/\.00$/, '') : String(value));
  if (initial != null) text = asText(initial);

  return {
    press(key) {
      if (fresh) {
        text = '';
        fresh = false;
      }
      if (key === 'back') text = text.slice(0, -1);
      else if (key === 'clear') text = '';
      else if (key === '.') {
        if (mode === 'money' && !text.includes('.')) text = (text || '0') + '.';
      } else {
        const [whole, decimals] = text.split('.');
        if (decimals !== undefined && decimals.length >= 2) return; // maximo centavos
        if (decimals === undefined && whole.length >= 6) return; // tope: 999,999
        text = (text === '0' ? '' : text) + key;
      }
    },
    set(value) {
      text = asText(value);
      fresh = true;
    },
    value() {
      if (mode === 'money') return Math.round(parseFloat(text || '0') * 100);
      return parseInt(text || '0', 10);
    },
    display() {
      if (mode !== 'money') return text || '0';
      // Sin teclear aun (valor inicial o boton rapido): formato completo, $500.00.
      // Tecleando: tal cual se escribe, para ver el punto y los centavos.
      return fresh ? money(this.value()) : '$' + (text || '0');
    },
  };
}

// Las 12 teclas. onKey recibe '0'..'9', '.', 'back'.
export function numpadKeys(onKey, { decimal = true } = {}) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? '.' : '', '0', 'back'];
  return h('div', { class: 'numpad' },
    keys.map((key) =>
      key === ''
        ? h('span')
        : h('button', { class: 'key', type: 'button', onClick: () => onKey(key) }, key === 'back' ? '⌫' : key)));
}

// Traduce una tecla fisica a una tecla del numpad (o null si no aplica).
export function physicalToNumpad(event) {
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (event.key === '.' || event.key === ',') return '.';
  if (event.key === 'Backspace') return 'back';
  return null;
}

// Pide un numero. Regresa centavos (money) o un entero (int); null si cancela.
// quick: [{ label, value }] botones de montos rapidos.
export function numpadDialog({ title, hint = '', mode = 'money', initial = null, quick = [], okText = 'Aceptar' }) {
  return new Promise((resolve) => {
    const state = amountState(mode, initial);
    const display = h('div', { class: 'numpad-display' });
    const paint = () => {
      display.textContent = state.display();
    };
    const press = (key) => {
      state.press(key);
      paint();
    };
    let finish;

    const close = openModal(
      (box) => {
        add(box, 
          h('h2', null, title),
          hint && h('p', { class: 'modal-text' }, hint),
          display,
          quick.length > 0 && h('div', { class: 'quick' },
            quick.map((q) => btn(q.label, () => {
              state.set(q.value);
              paint();
            }))),
          numpadKeys(press, { decimal: mode === 'money' }),
          h('div', { class: 'modal-actions' },
            btn('Cancelar', () => finish(null)),
            btn(okText, () => finish(state.value()), 'btn-primary'))
        );
      },
      {
        size: 'sm',
        onKey: (event) => {
          const key = physicalToNumpad(event);
          if (key) press(key);
          else if (event.key === 'Enter') finish(state.value());
          else if (event.key === 'Escape') finish(null);
        },
      }
    );
    finish = (value) => {
      close();
      resolve(value);
    };
    paint();
  });
}

// ---------- Captura de texto ----------
const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
  ['á', 'é', 'í', 'ó', 'ú', '.', ',', '-', ':', '/', '\\', '#'],
];

// Pide un texto. Regresa el texto (sin espacios sobrantes) o null si cancela.
export function textDialog({ title, initial = '', placeholder = '', maxLength = 60, okText = 'Aceptar' }) {
  return new Promise((resolve) => {
    // Un <input> real: asi el teclado fisico, el cursor y la seleccion
    // funcionan solos. Las teclas en pantalla escriben dentro de el.
    const input = h('input', { class: 'text-display', type: 'text', maxlength: String(maxLength), placeholder, autocomplete: 'off' });
    input.value = initial;
    let shift = initial === ''; // la primera letra va en mayuscula
    let keyboard;
    let finish;

    const type = (text) => {
      if (input.value.length - (input.selectionEnd - input.selectionStart) + text.length > maxLength) return;
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    };

    const press = (key) => {
      if (key === 'shift') shift = !shift;
      else if (key === 'back') {
        if (input.selectionStart === input.selectionEnd && input.selectionStart > 0) {
          input.setSelectionRange(input.selectionStart - 1, input.selectionEnd);
        }
        input.setRangeText('', input.selectionStart, input.selectionEnd, 'end');
      } else {
        type(shift ? key.toUpperCase() : key);
        shift = false;
      }
      paintKeys();
    };

    const label = (key) => {
      if (key === 'shift') return 'Mayús';
      if (key === 'back') return '⌫';
      if (key === ' ') return 'Espacio';
      return shift ? key.toUpperCase() : key;
    };

    function paintKeys() {
      keyboard.replaceChildren(
        ...ROWS.map((row) =>
          h('div', { class: 'kb-row' },
            row.map((key) =>
              h('button', {
                class: `key ${key.length > 1 ? 'key-wide' : ''} ${key === 'shift' && shift ? 'active' : ''}`,
                type: 'button',
                onClick: () => press(key),
              }, label(key))))),
        h('div', { class: 'kb-row' },
          h('button', { class: 'key key-space', type: 'button', onClick: () => press(' ') }, 'Espacio'))
      );
    }

    const close = openModal(
      (box) => {
        keyboard = h('div', {
          class: 'keyboard',
          // Sin esto, tocar una tecla le quitaria el foco (y el cursor) al input.
          onPointerdown: (event) => event.preventDefault(),
        });
        paintKeys();
        add(box, 
          h('h2', null, title),
          input,
          keyboard,
          h('div', { class: 'modal-actions' },
            btn('Cancelar', () => finish(null)),
            btn(okText, () => finish(input.value.trim()), 'btn-primary'))
        );
      },
      {
        size: 'xl',
        onKey: (event) => {
          if (event.key === 'Enter') finish(input.value.trim());
          else if (event.key === 'Escape') finish(null);
        },
      }
    );
    finish = (value) => {
      close();
      resolve(value);
    };
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
