/*
 * Cerebria HUD
 *
 * 1. Dia, hora del juego, hora real y rumbo en la barra de accion.
 * 2. Al morir guarda donde quedo la tumba y te guia con distancia en vivo.
 * 3. La brujula abre un menu: conseguir el mapa localizador y gestionar waypoints.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs, porque activar
 * experimentos marcaria el mundo de forma permanente e irreversible.
 *
 * POR QUE NO HAY MAPA DIBUJADO POR EL ADDON
 * Bedrock no tiene puente script->UI para dibujar: un pack solo puede empujar
 * TEXTO. Se intento una cuadricula de caracteres coloreados y se veia mal, porque
 * los codigos § dan 28 colores como maximo contra los 248 de un mapa real, y las
 * filas de texto quedan separadas entre si. Lo que si se ve bien es el mapa de
 * Minecraft... porque es un mapa de Minecraft: el addon te lo entrega y ya.
 *
 * TODO EN UN SOLO ARCHIVO a proposito. Al dividirlo en main.js + mapa.js con un
 * import relativo, el pack dejo de cargar entero y hasta el reloj desaparecio. El
 * unico addon con scripts que funciona en este servidor, WAILA, es un unico bundle
 * sin imports relativos. No dividir esto.
 *
 * Sin fuente propia: se usan caracteres ASCII normales para no depender de una
 * pagina de glifos que el cliente podria no tener.
 */

import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PROP_TUMBA = "cerebria:tumba";        // "x,y,z,dimensionId"
const PROP_WAYPOINTS = "cerebria:waypoints";

const RADIO_LLEGADA = 4;        // bloques: a esta distancia la tumba se da por hallada
const UTC_OFFSET_HORAS = -5;    // Colombia, sin horario de verano

/* ---------- utilidades de tiempo ---------- */

// getTimeOfDay() devuelve ticks 0..24000 donde el tick 0 son las 06:00 del juego.
function horaDelJuego() {
  const ticks = world.getTimeOfDay();
  const horasTotales = (ticks / 1000 + 6) % 24;
  const h = Math.floor(horasTotales);
  const m = Math.floor((horasTotales - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function franja() {
  const t = world.getTimeOfDay();
  if (t < 1000) return "Amanecer";
  if (t < 11000) return "Dia";
  if (t < 13000) return "Atardecer";
  if (t < 23000) return "Noche";
  return "Amanecer";
}

// Date puede no existir en el motor de scripts. Si falla, se omite la hora real
// en vez de tumbar todo el HUD.
let hayDate = true;
function horaReal() {
  if (!hayDate) return null;
  try {
    const ms = Date.now() + UTC_OFFSET_HORAS * 3600 * 1000;
    const total = Math.floor(ms / 60000) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } catch (e) {
    hayDate = false;
    console.warn("[cerebria-hud] Date no disponible; se omite la hora real");
    return null;
  }
}

/* ---------- rumbos y distancias ---------- */

const RUMBOS = ["S", "SO", "O", "NO", "N", "NE", "E", "SE"];

// Yaw de Bedrock: 0 = Sur (+Z), 90 = Oeste (-X), 180 = Norte (-Z), -90 = Este (+X).
function rumboDesdeYaw(yaw) {
  const y = ((yaw % 360) + 360) % 360;
  return RUMBOS[Math.round(y / 45) % 8];
}

function rumboHacia(desde, hasta) {
  const yaw = Math.atan2(-(hasta.x - desde.x), hasta.z - desde.z) * 180 / Math.PI;
  return rumboDesdeYaw(yaw);
}

function distancia(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.round(Math.sqrt(dx * dx + dz * dz));
}

function nombreDimension(id) {
  if (id.indexOf("nether") !== -1) return "Nether";
  if (id.indexOf("the_end") !== -1) return "End";
  return "Overworld";
}

/* ---------- tumba ---------- */

function leerTumba(player) {
  const raw = player.getDynamicProperty(PROP_TUMBA);
  if (typeof raw !== "string") return undefined;
  const p = raw.split(",");
  if (p.length !== 4) return undefined;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return undefined;
  return { x: x, y: y, z: z, d: p[3] };
}

function textoTumba(player) {
  const t = leerTumba(player);
  if (!t) return null;
  if (player.dimension.id !== t.d) {
    return `§7Tumba en §f${nombreDimension(t.d)}§7: ${t.x} ${t.y} ${t.z}`;
  }
  const d = distancia(player.location, t);
  if (d <= RADIO_LLEGADA) {
    player.setDynamicProperty(PROP_TUMBA, undefined);
    player.sendMessage("§aLlegaste a tu tumba.");
    return null;
  }
  return `§cTumba §f${t.x} ${t.y} ${t.z} §7(${d}m ${rumboHacia(player.location, t)})`;
}

/* ---------- waypoints ---------- */

function leerWaypoints(player) {
  const raw = player.getDynamicProperty(PROP_WAYPOINTS);
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function guardarWaypoints(player, lista) {
  player.setDynamicProperty(PROP_WAYPOINTS, JSON.stringify(lista.slice(0, 20)));
}

/* ---------- entrega del mapa localizador ---------- */
/*
 * El mapa localizador de Bedrock se hace con papel + brujula en una mesa de
 * cartografia. Por comando, el valor auxiliar del item no esta documentado de
 * forma fiable, asi que en vez de adivinar se prueban variantes y se usa la
 * primera que el servidor acepta. runCommand lanza CommandError si falla.
 */
const VARIANTES_MAPA = [
  ["empty_map", 2, "mapa localizador vacio"],
  ["empty_map", 1, "mapa vacio (variante 1)"],
  ["empty_map", 0, "mapa vacio"]
];

function darMapa(player) {
  const nombre = player.name.replace(/"/g, "");
  for (const v of VARIANTES_MAPA) {
    const cmd = `give "${nombre}" ${v[0]} 1 ${v[1]}`;
    try {
      const r = player.dimension.runCommand(cmd);
      if (r && r.successCount > 0) {
        player.sendMessage(`§aTe di un §f${v[2]}§a.`);
        player.sendMessage("§7Usalo (mantene presionado) para crear el mapa. " +
                           "Despues sostenelo en la mano para verlo.");
        console.log(`[cerebria-hud] mapa entregado con: ${cmd}`);
        return true;
      }
    } catch (e) {
      // Variante no aceptada por esta version; se prueba la siguiente.
    }
  }
  player.sendMessage("§cNo pude darte el mapa por comando.");
  player.sendMessage("§7Hacelo a mano: papel + brujula en una mesa de cartografia.");
  console.warn("[cerebria-hud] ninguna variante de `give ... empty_map` funciono");
  return false;
}

/* ---------- menu de la brujula ---------- */

function abrirMenu(player) {
  const wps = leerWaypoints(player);
  const t = leerTumba(player);
  const l = player.location;

  let cuerpo = `§7Estas en §f${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} ` +
               `§7(${nombreDimension(player.dimension.id)})\n` +
               `§7Mirando al §f${rumboDesdeYaw(player.getRotation().y)}`;
  if (t) {
    const mismaDim = t.d === player.dimension.id;
    cuerpo += `\n§cTumba: §f${t.x} ${t.y} ${t.z}`;
    if (mismaDim) cuerpo += ` §7(${distancia(l, t)}m ${rumboHacia(l, t)})`;
    else cuerpo += ` §7en ${nombreDimension(t.d)}`;
  }

  new ActionFormData()
    .title("Brujula")
    .body(cuerpo)
    .button("Conseguir mapa")
    .button("Marcar este lugar")
    .button(`Mis waypoints (${wps.length})`)
    .button("Cerrar")
    .show(player).then(function (res) {
      if (res.canceled) return;
      if (res.selection === 0) darMapa(player);
      else if (res.selection === 1) marcarAqui(player);
      else if (res.selection === 2) listarWaypoints(player);
    }).catch(function () {});
}

function marcarAqui(player) {
  const l = player.location;
  const etiqueta = `X ${Math.floor(l.x)}  Y ${Math.floor(l.y)}  Z ${Math.floor(l.z)}\nNombre:`;
  new ModalFormData()
    .title("Marcar lugar")
    .textField(etiqueta, "casa")
    .show(player).then(function (res) {
      if (res.canceled) return;
      const valores = res.formValues || [];
      const bruto = valores[0] == null ? "" : String(valores[0]);
      const nombre = bruto.trim() || "sin nombre";
      const lista = leerWaypoints(player);
      lista.push({
        n: nombre.slice(0, 20),
        x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
        d: player.dimension.id
      });
      guardarWaypoints(player, lista);
      player.sendMessage(`§eWaypoint §f${nombre}§e guardado.`);
    }).catch(function () {});
}

function listarWaypoints(player) {
  const lista = leerWaypoints(player);
  if (lista.length === 0) {
    player.sendMessage("§7No tenes waypoints. Usa \"Marcar este lugar\".");
    return;
  }
  const f = new ActionFormData().title("Waypoints").body("§7Toca uno para borrarlo.");
  for (const w of lista) {
    const mismaDim = w.d === player.dimension.id;
    const detalle = mismaDim
      ? `${distancia(player.location, w)}m ${rumboHacia(player.location, w)}`
      : nombreDimension(w.d);
    f.button(`${w.n}\n§7${w.x} ${w.y} ${w.z} - ${detalle}`);
  }
  f.button("§7Volver");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection === lista.length) {
      abrirMenu(player);
      return;
    }
    const borrado = lista.splice(res.selection, 1)[0];
    guardarWaypoints(player, lista);
    player.sendMessage(`§7Waypoint §f${borrado.n}§7 borrado.`);
  }).catch(function () {});
}

/* ---------- eventos ---------- */

world.afterEvents.entityDie.subscribe((ev) => {
  const e = ev.deadEntity;
  if (!e || e.typeId !== "minecraft:player") return;
  try {
    const loc = e.location;
    const dim = e.dimension.id;
    e.setDynamicProperty(
      PROP_TUMBA,
      `${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)},${dim}`
    );
    e.sendMessage(
      `§c* Moriste en §f${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} ` +
      `§7(${nombreDimension(dim)})`
    );
    e.sendMessage("§7La distancia a la tumba te va a seguir en pantalla.");
  } catch (err) {
    console.warn(`[cerebria-hud] no pude guardar la tumba: ${err}`);
  }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn) return;   // solo tras morir, no al entrar al servidor
  const t = leerTumba(ev.player);
  if (!t) return;
  ev.player.sendMessage(
    `§eTu tumba quedo en §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.d)})`
  );
});

// La brujula abre el menu. Sustituye a un comando de chat porque
// world.beforeEvents.chatSend es EXPERIMENTAL, y usarlo obligaria a activar Beta
// APIs y marcar el mundo para siempre.
world.afterEvents.itemUse.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || item.typeId !== "minecraft:compass") return;
  try {
    abrirMenu(ev.source);
  } catch (err) {
    console.warn(`[cerebria-hud] no pude abrir el menu: ${err}`);
  }
});

/* ---------- bucle de la barra de accion ---------- */

// Guia al waypoint mas cercano de la dimension actual.
function guiaMasCercana(player) {
  let mejor = null, mejorD = Infinity;
  for (const w of leerWaypoints(player)) {
    if (w.d !== player.dimension.id) continue;
    const d = distancia(player.location, w);
    if (d < mejorD) { mejorD = d; mejor = w; }
  }
  if (!mejor) return null;
  return `§e${mejor.n} §f${mejorD}m ${rumboHacia(player.location, mejor)}`;
}

system.runInterval(() => {
  const dia = world.getDay();
  const hj = horaDelJuego();
  const hr = horaReal();

  let base = `§bDia ${dia} §7| §f${hj} §7${franja()}`;
  if (hr) base += ` §7| §f${hr} §7real`;

  for (const player of world.getAllPlayers()) {
    try {
      // Todo en UNA linea: la barra de accion de Bedrock no soporta multilinea
      // (es una peticion abierta, no una funcion).
      let linea = `${base} §7| §f${rumboDesdeYaw(player.getRotation().y)}`;

      // textoTumba() ademas borra la tumba al llegar, asi que se llama siempre.
      const tumba = textoTumba(player);
      if (tumba) linea += `  ${tumba}`;
      else {
        const guia = guiaMasCercana(player);
        if (guia) linea += ` §7| ${guia}`;
      }

      player.onScreenDisplay.setActionBar(linea);
    } catch (err) {
      // Un jugador que se desconecta a mitad del tick no debe romper el resto.
    }
  }
}, 20);

console.log("[cerebria-hud] cargado");
