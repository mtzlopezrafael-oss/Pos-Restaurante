// Error "esperado": algo que el usuario puede corregir (caja cerrada, nombre
// vacio...). Su mensaje se muestra tal cual en pantalla. Cualquier otro error
// se considera un bug: se registra en la consola y la pantalla muestra un
// mensaje generico (ver ipc.js).
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

// Validadores chicos que usan los servicios. Todo lo que llega desde la
// pantalla se revisa aqui: el proceso principal no confia en el renderer.
function requireText(value, label, maxLength = 60) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new UserError(`Falta ${label}.`);
  if (text.length > maxLength) throw new UserError(`${label} no puede pasar de ${maxLength} caracteres.`);
  return text;
}

function requireInt(value, label, { min = 0, max = 100000000 } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UserError(`${label} no es un número válido.`);
  }
  return value;
}

const nowIso = () => new Date().toISOString();

module.exports = { UserError, requireText, requireInt, nowIso };
