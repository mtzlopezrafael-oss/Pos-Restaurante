// Reinicio para instalar una actualizacion ya descargada. Lo usan el boton
// "Actualizar" de la barra lateral y el de Ajustes.

import { call, confirmDialog } from './ui.js';
import { hasUnsavedTicket } from './screens/venta.js';

export async function restartToUpdate(version) {
  // Lo unico que vive solo en memoria es la cuenta que se esta capturando.
  const unsaved = hasUnsavedTicket();
  const ok = await confirmDialog({
    title: `¿Reiniciar para instalar la versión ${version}?`,
    message: unsaved
      ? 'Hay una cuenta en captura sin guardar y se perdería. Guárdala o cóbrala antes de reiniciar.'
      : 'Tarda unos segundos. Las cuentas abiertas, la caja y las ventas se conservan.',
    okText: unsaved ? 'Reiniciar de todos modos' : 'Reiniciar ahora',
    cancelText: 'Después',
    danger: unsaved,
  });
  if (ok) await call('update.restart');
}
