// Transportes: como llegan los bytes ESC/POS a la impresora.
// Ninguno usa modulos nativos, solo lo que ya trae Node.
//
//   file   Guarda el ticket en la carpeta de datos (.bin con los bytes y .txt
//          legible). Es el modo por defecto para desarrollar sin impresora.
//   share  Impresora USB instalada en Windows y COMPARTIDA. Se le copian los
//          bytes en crudo con `copy /b archivo \\localhost\NOMBRE`.
//   tcp    Impresora de red: se abre un socket al puerto 9100.
//   port   Puerto serie o paralelo (COM3, LPT1).

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');
const { UserError } = require('../errors');

const IS_WINDOWS = process.platform === 'win32';

// Se validan los destinos con expresiones estrictas porque terminan en una
// linea de comandos o en una ruta de dispositivo.
const SHARE = /^\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._ -]+$/; // \\equipo\recurso
const TCP = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/; // host o host:puerto
const PORT = /^(COM\d{1,3}|LPT\d)$/i;

function toFile({ bytes, plain }, dir) {
  const folder = path.join(dir, 'tickets');
  fs.mkdirSync(folder, { recursive: true });
  const base = path.join(folder, `ticket-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.writeFileSync(`${base}.bin`, bytes);
  fs.writeFileSync(`${base}.txt`, plain, 'utf8');
  return `${base}.txt`;
}

function toShare({ bytes }, target) {
  if (!IS_WINDOWS) throw new UserError('La impresora compartida solo funciona en Windows.');
  if (!SHARE.test(target)) throw new UserError('El destino debe verse así: \\\\localhost\\TICKETS');
  const temp = path.join(os.tmpdir(), `pos-ticket-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(temp, bytes);
  return new Promise((resolve, reject) => {
    execFile('cmd.exe', ['/d', '/c', 'copy', '/b', temp, target], { windowsHide: true, timeout: 10000 }, (error) => {
      fs.unlink(temp, () => {});
      if (error) reject(new UserError(`No se pudo imprimir en ${target}. Revisa que la impresora esté encendida y compartida.`));
      else resolve(target);
    });
  });
}

function toTcp({ bytes }, target) {
  const match = TCP.exec(target);
  if (!match) throw new UserError('El destino debe verse así: 192.168.1.50:9100');
  const host = match[1];
  const port = Number(match[2] || 9100);
  return new Promise((resolve, reject) => {
    const fail = () => reject(new UserError(`No hubo respuesta de la impresora en ${host}:${port}.`));
    const socket = net.createConnection({ host, port });
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
    socket.once('error', fail);
    socket.once('connect', () => socket.end(bytes, () => resolve(target)));
  });
}

async function toPort({ bytes }, target) {
  if (!IS_WINDOWS) throw new UserError('Los puertos COM y LPT solo funcionan en Windows.');
  if (!PORT.test(target)) throw new UserError('El destino debe verse así: COM3 o LPT1');
  try {
    // \\.\COM3 es la ruta de dispositivo; sin ese prefijo fallan COM10 en adelante.
    await fs.promises.writeFile(`\\\\.\\${target.toUpperCase()}`, bytes);
    return target;
  } catch (error) {
    throw new UserError(`No se pudo escribir en ${target}. Revisa el cable y el número de puerto.`);
  }
}

// doc = { bytes, plain } como lo regresa EscPos.build()
async function send(doc, settings, dataDir) {
  const target = settings.printerTarget.trim();
  switch (settings.printerMode) {
    case 'share':
      return toShare(doc, target);
    case 'tcp':
      return toTcp(doc, target);
    case 'port':
      return toPort(doc, target);
    default:
      return toFile(doc, dataDir);
  }
}

module.exports = { send };
