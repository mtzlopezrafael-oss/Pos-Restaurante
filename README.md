# POS Restaurante

Punto de venta táctil para restaurante. Corre en Windows 7 SP1 de 64 bits (y en
Windows más nuevos), todo local: una sola computadora, sin servidor y sin internet.

## Qué hace

- **Venta**: menú por categorías con botones grandes, cuenta a la derecha, notas para cocina.
- **Cuentas abiertas**: guarda la cuenta de una mesa y cóbrala después.
- **Cobro**: efectivo (con cambio y billetes sugeridos), tarjeta o transferencia.
- **Caja**: fondo inicial, entradas y salidas de efectivo, cierre con arqueo, reimpresión y cancelación de ventas.
- **Productos**: alta y edición del menú. "Juntar parecidos" acomoda la lista (aquí y en Venta) para que queden juntos los nombres que comparten palabras; solo cambia el orden en pantalla.
- **Inventario**: por pieza, para lo que se cuenta (refrescos, agua). Se descuenta al cobrar.
- **Reportes**: vendido, forma de pago, por día y lo más vendido.
- **Ticket y cajón**: comandos ESC/POS directos a la impresora térmica; el cajón se abre por la impresora.

## Por qué estas versiones

Windows 7 obliga a congelar el stack. No actualices estas dos sin leer esto:

| Paquete | Versión | Motivo |
| --- | --- | --- |
| `electron` | 22.3.27 | Última versión que arranca en Windows 7 (Chromium 108, Node 16.17). |
| `better-sqlite3` | 9.6.0 | Última versión con binario ya compilado para Electron 22. |

Como Chromium 108 ya no recibe parches, la pantalla no carga nada de internet y tiene
bloqueada la resolución de dominios (ver `main.js`). La única salida a internet es el
actualizador, que usa el módulo `https` de Node y solo habla con GitHub.

## Instalar y correr (en tu máquina de desarrollo)

Necesitas Node 18 o más nuevo. Sirve Windows 10/11, macOS o Linux.

En Windows basta con doble clic en **`instalar.bat`**: revisa que haya Node (si
falta, ofrece instalarlo con winget), baja los paquetes, Electron y SQLite, corre
las pruebas y al final pregunta si abre la app. Hace lo mismo que estos comandos:

```
npm install        # baja los paquetes, sin ejecutar scripts (ver .npmrc)
npm run setup      # baja Electron 22 y el binario de SQLite para Electron 22
npm run dev        # ventana de 1024x768 con DevTools
npm test           # pruebas de la lógica
```

`npm start` abre la app como en la terminal: pantalla completa, sin bordes.
Se cierra desde **Ajustes → Salir del programa** (o Alt+F4).

Son dos pasos porque el script de instalación de `better-sqlite3` intentaría
compilar C++ para tu versión de Node, y aquí hace falta el binario de Electron 22.
`scripts/setup.js` lo explica y lo resuelve.

## Instalador para la terminal

En una computadora con Windows de 64 bits:

```
npm run dist
```

Deja el instalador en `dist/`. Cópialo a la terminal e instálalo (pide permisos de
administrador). Si la pantalla sale negra o parpadea, abre la app con `--no-gpu`
(en las propiedades del acceso directo, al final de "Destino").

## Actualización automática

El POS se actualiza solo desde la rama `updates` de este repo. Al abrir (y cada 6 horas)
consulta `latest.json` en esa rama; si hay versión nueva baja el paquete
de código (`code-X.Y.Z.asar`, unos 180 KB), comprueba tamaño y hash SHA-256 y lo guarda
en `AppData\Roaming\POS Restaurante\updates`. Aparece el botón **Actualizar** en la
barra lateral (y en Ajustes); la versión nueva entra al reiniciar, nunca a media venta.

- El programa instalado no se modifica: la actualización vive aparte y `src/main/boot.js`
  (el lanzador) decide con cuál arrancar.
- Si la versión nueva truena al cargar o no llega a mostrar su pantalla, el lanzador la
  marca como fallida y regresa solo a la última que funcionó.
- Antes de que una versión nueva toque la base se guarda una copia en `backups\antes-de-X.Y.Z-….db`.
- Solo habla por HTTPS con GitHub (`raw.githubusercontent.com`). El hash protege contra descargas dañadas o
  alteradas en el camino, no contra alguien que entre a la cuenta de GitHub: actívale 2FA.

### Publicar una versión

1. Sube `"version"` en `package.json` (por ejemplo a `0.1.5`), haz commit y push a `main`.
2. `npm run bundle -- "Qué cambió, en una frase"` arma `latest.json` y `code-0.1.5.asar` en `dist/release/`.
3. `npm run publish-update` los sube a la rama `updates`.

Las terminales la bajan solas; GitHub puede tardar unos minutos en servir el archivo nuevo.

Lo que NO viaja por actualización automática: Electron, `node_modules` y el propio
lanzador (`boot.js`, `update-state.js`). Si cambias algo de eso hay que reinstalar el
programa completo en la terminal y subir `MIN_LAUNCHER` en `scripts/release.js`.

### Actualizar a mano (respaldo)

Si la terminal no tiene internet: cierra el POS, y en `resources` reemplaza `app.asar`
por el nuevo (`npm run dist -- --dir` lo deja en `dist/win-unpacked/resources/`).
La base de datos no se toca: vive en `AppData`, fuera de la carpeta del programa.

## Pantalla táctil

`src/renderer/js/tap.js` decide qué botón se tocó con reglas más tolerantes que el
click del navegador (dedo que resbala, toque largo, drivers que mandan el clic donde
estaba el cursor). Si un toque no responde: Ajustes → **Probar pantalla táctil** muestra
qué recibió la app en cada toque. Si ahí no aparece nada al tocar, el toque se perdió
antes de llegar a la app (driver o calibración de la pantalla).

## Impresora y cajón en Windows 7

1. Instala la impresora con su driver (o como "Generic / Text Only").
2. Dispositivos e impresoras → clic derecho → Propiedades de impresora → Compartir.
   Ponle un nombre corto, por ejemplo `TICKETS`.
3. En la app: Ajustes → Conexión de la impresora → "USB, compartida en Windows",
   y en Destino escribe `\\localhost\TICKETS`.
4. Toca "Imprimir ticket de prueba". Si los acentos salen como símbolos, cambia
   "Acentos y eñes". Si el texto se corta o sobra papel, cambia "Ancho del papel".
5. El cajón va conectado a la impresora (cable tipo teléfono). Pruébalo con "Abrir cajón".

Mientras no haya impresora, el modo "Sin impresora" guarda cada ticket como `.txt`
en la carpeta de datos, para ver cómo quedaría.

## Dónde quedan los datos

`C:\Users\<usuario>\AppData\Roaming\POS Restaurante\`

- `pos.db`: la base de datos (SQLite).
- `backups\`: una copia por cada cierre de caja; se conservan las últimas 30.
- `tickets\`: los tickets del modo "Sin impresora".

Copia `backups\` a una USB de vez en cuando: si el disco de la terminal muere, es lo único que queda.

## Cómo leer el código

Sigue una venta de principio a fin:

1. `src/renderer/js/screens/venta.js`: `pay()` arma la cuenta y llama `call('orders.pay', ...)`.
2. `src/preload/preload.js`: pasa la llamada al proceso principal.
3. `src/main/ipc.js`: busca `orders.pay` en su tabla y lo ejecuta.
4. `src/main/services/orders.js`: valida, guarda y descuenta inventario en una transacción.
5. `src/main/printer/ticket.js` arma el ticket y `transports.js` lo manda a la impresora.

```
src/
  main/                 Proceso principal (Node): datos, reglas, impresora
    boot.js             Lanzador: elige entre el código instalado y la actualización
    main.js             Ventana y arranque
    updater.js          Busca, descarga y verifica actualizaciones
    update-state.js     Estado de las actualizaciones (compartido con el lanzador)
    db.js               Esquema de SQLite y migraciones
    ipc.js              Lista de operaciones que la pantalla puede pedir
    errors.js           Errores para el usuario y validadores
    services/           catalog, orders, cash, inventory, reports, settings
    printer/            escpos (comandos), ticket (formato), transports (envío)
  preload/preload.js    Puente seguro entre pantalla y proceso principal
  renderer/             La interfaz (HTML, CSS y JS sin framework)
    js/ui.js            Crear elementos, modales, avisos, formatos
    js/tap.js           Toques tolerantes para pantallas resistivas
    js/similar.js       Acomodo de productos por parecido de nombre
    js/order.js         Recuerda si el orden es alfabético o por parecido
    js/keyboard.js      Teclado y numpad en pantalla
    js/form.js          Formularios táctiles
    js/screens/         Una pantalla por archivo
scripts/                setup (binarios), run-tests, release (arma la actualización) y publish (la sube)
test/logic.test.js      Pruebas de ventas, caja, inventario, reportes y tickets
```

Para cambiar tablas, agrega una migración al final de `MIGRATIONS` en `db.js`;
no edites una que ya se aplicó.

## Qué está probado y qué no

Probado en Electron 22.3.27 real (Linux, pantalla virtual de 1024x768): las 12
pruebas de lógica, el flujo completo en la interfaz (cuenta, mesa, cobro, caja,
inventario, reportes, cierre) y que la app empaquetada abre la base de datos.

**No probado**: nada en un Windows 7 físico, el instalador `.exe`, ni la impresión
con hardware real (impresora compartida, red, puerto COM, cajón). Los bytes ESC/POS
están verificados; el envío a la impresora hay que probarlo en la terminal.

## Pendientes conocidos

- No hay usuarios ni PIN: cualquiera puede entrar a Productos, Ajustes o cancelar ventas.
- El inventario es por pieza; no descuenta insumos por receta.
- No factura (CFDI) y no imprime comanda aparte para cocina.
- Sin pagos mixtos (parte efectivo, parte tarjeta), propinas ni descuentos.
- Hora del ticket: Windows 7 sin actualizaciones puede seguir aplicando el horario
  de verano que México eliminó en 2022. Si la hora se adelanta sola en abril,
  desactiva el ajuste automático de horario de verano en Fecha y hora.
