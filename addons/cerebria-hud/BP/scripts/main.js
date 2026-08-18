/*
 * Cerebria HUD
 *
 * 1. Dia, hora del juego, hora real y brujula en la barra de accion.
 * 2. Al morir guarda donde quedo la tumba y te lo recuerda con distancia en vivo.
 * 3. Mapa cenital bajo demanda (brujula), con jugadores, tumba y waypoints.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs, porque activar
 * experimentos marcaria el mundo de forma permanente e irreversible.
 *
 * TODO EN UN SOLO ARCHIVO a proposito. Se intento dividirlo en main.js + mapa.js
 * con un import relativo y el script dejo de cargar por completo (en Bedrock, si
 * un modulo falla al importar no corre NADA del pack, asi que hasta el reloj
 * desaparecio). El unico addon con scripts que funciona en este servidor, WAILA,
 * viene como un unico bundle de 239 KB sin imports relativos. No dividir esto.
 *
 * Por que la barra de accion y no un HUD propio: WAILA ocupa ui/hud_screen.json y
 * Bedrock no fusiona los JSON de UI, asi que tocar ese archivo lo apagaria entero.
 */

import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PROP_TUMBA = "cerebria:tumba";        // "x,y,z,dimensionId"
const PROP_ZOOM = "cerebria:zoom";
const PROP_WAYPOINTS = "cerebria:waypoints";

const RADIO_LLEGADA = 4;        // bloques: a esta distancia la tumba se da por hallada
const UTC_OFFSET_HORAS = -5;    // Colombia, sin horario de verano

const RADIO = 12;               // 12 -> rejilla de 25x25 celdas
const ZOOMS = [1, 2, 4, 8];     // bloques por celda

// Glifos de RP/font/glyph_25.png. El resource pack vanilla NO trae esa pagina
// (sus paginas arrancan en glyph_2E); sin ella esto se veria como cajas vacias.
const TILE = "█";     // bloque lleno
const YO = "▲";       // triangulo
const JUGADOR = "●";  // circulo
const TUMBA = "╳";    // cruz
const WP = "◆";       // rombo

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

/* ---------- tumba ---------- */

function guardarTumba(player, loc, dimensionId) {
  player.setDynamicProperty(
    PROP_TUMBA,
    `${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)},${dimensionId}`
  );
}

function leerTumba(player) {
  const raw = player.getDynamicProperty(PROP_TUMBA);
  if (typeof raw !== "string") return undefined;
  const p = raw.split(",");
  if (p.length !== 4) return undefined;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return undefined;
  return { x: x, y: y, z: z, d: p[3] };
}

function borrarTumba(player) {
  player.setDynamicProperty(PROP_TUMBA, undefined);
}

function nombreDimension(id) {
  if (id.indexOf("nether") !== -1) return "Nether";
  if (id.indexOf("the_end") !== -1) return "End";
  return "Overworld";
}

function textoTumba(player) {
  const t = leerTumba(player);
  if (!t) return null;
  if (player.dimension.id !== t.d) {
    return `§7${TUMBA} Tumba en §f${nombreDimension(t.d)}§7: ${t.x} ${t.y} ${t.z}`;
  }
  const d = distancia(player.location, t);
  if (d <= RADIO_LLEGADA) {
    borrarTumba(player);
    player.sendMessage(`§a${TUMBA} Llegaste a tu tumba.`);
    return null;
  }
  return `§c${TUMBA} §f${t.x} ${t.y} ${t.z} §7(${d}m ${rumboHacia(player.location, t)})`;
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

/* ---------- paleta del mapa ---------- */
// [color claro, color oscuro] segun la altura respecto al jugador, para dar relieve.
const PALETA = [
  [["water", "kelp", "seagrass", "bubble"], ["9", "1"]],
  [["lava", "magma", "fire"], ["c", "4"]],
  [["grass", "moss", "leaves", "azalea", "vine", "fern"], ["a", "2"]],
  [["sand", "sandstone", "glass"], ["e", "6"]],
  [["snow", "powder_snow"], ["f", "7"]],
  [["ice", "packed_ice", "blue_ice"], ["b", "3"]],
  [["log", "wood", "plank", "stem", "hyphae"], ["6", "4"]],
  [["dirt", "podzol", "mud", "clay", "gravel", "rooted"], ["6", "8"]],
  [["netherrack", "nether_wart", "crimson", "soul"], ["4", "4"]],
  [["obsidian", "bedrock", "deepslate", "basalt", "blackstone"], ["8", "8"]],
  [["ore", "raw_", "diamond", "gold", "iron", "copper"], ["b", "3"]],
  [["wool", "concrete", "terracotta", "brick", "wall", "slab", "stairs"], ["d", "5"]],
  [["farmland", "wheat", "crop", "hay", "melon", "pumpkin"], ["e", "6"]]
];

function colorDe(typeId, dy) {
  const id = typeId.replace("minecraft:", "");
  const oscuro = dy < -3;
  for (const entrada of PALETA) {
    const claves = entrada[0];
    const cols = entrada[1];
    for (const k of claves) {
      if (id.indexOf(k) !== -1) return oscuro ? cols[1] : cols[0];
    }
  }
  return oscuro ? "8" : "7";   // piedra / desconocido
}

function zoomDe(player) {
  const z = player.getDynamicProperty(PROP_ZOOM);
  return ZOOMS.indexOf(z) !== -1 ? z : 2;
}

/* ---------- muestreo del terreno ---------- */
/*
 * Generador a proposito: se lanza con system.runJob, que le da una porcion de
 * tiempo por tick. Una rejilla de 25x25 son 625 llamadas a getTopmostBlock; en un
 * solo tick eso podria disparar el watchdog y trabar el servidor.
 * getBlocks() (lectura masiva) seria mas rapido pero es API experimental.
 */
function* muestrear(player, zoom, salida) {
  const dim = player.dimension;
  const cx = Math.floor(player.location.x);
  const cz = Math.floor(player.location.z);
  const py = player.location.y;

  for (let fz = -RADIO; fz <= RADIO; fz++) {
    const fila = [];
    for (let fx = -RADIO; fx <= RADIO; fx++) {
      let color = "0";   // negro = sin datos
      try {
        const b = dim.getTopmostBlock({ x: cx + fx * zoom, z: cz + fz * zoom });
        if (b) color = colorDe(b.typeId, b.location.y - py);
      } catch (e) {
        // Chunk sin cargar u otro fallo: celda desconocida en vez de romper el mapa.
      }
      fila.push(color);
    }
    salida.push(fila);
    yield;   // una fila por porcion de tiempo
  }
}

function pintarMarcadores(rejilla, player, zoom) {
  const cx = Math.floor(player.location.x);
  const cz = Math.floor(player.location.z);
  const marcas = [];

  const celda = function (p) {
    const fx = Math.round((p.x - cx) / zoom);
    const fz = Math.round((p.z - cz) / zoom);
    if (Math.abs(fx) > RADIO || Math.abs(fz) > RADIO) return undefined;
    return [fz + RADIO, fx + RADIO];
  };

  for (const otro of world.getAllPlayers()) {
    if (otro.id === player.id) continue;
    if (otro.dimension.id !== player.dimension.id) continue;
    const c = celda(otro.location);
    if (c) marcas.push([c, "f", JUGADOR]);
  }

  const t = leerTumba(player);
  if (t && t.d === player.dimension.id) {
    const c = celda(t);
    if (c) marcas.push([c, "c", TUMBA]);
  }

  for (const w of leerWaypoints(player)) {
    if (w.d !== player.dimension.id) continue;
    const c = celda(w);
    if (c) marcas.push([c, "e", WP]);
  }

  // El jugador va ultimo para quedar siempre encima.
  marcas.push([[RADIO, RADIO], "f", YO]);

  for (const m of marcas) {
    rejilla[m[0][0]][m[0][1]] = "§" + m[1] + m[2];
  }
}

function componer(rejilla) {
  const lineas = [];
  for (const fila of rejilla) {
    let s = "";
    for (const c of fila) s += c.length > 1 ? c : "§" + c + TILE;
    lineas.push(s);
  }
  return lineas.join("\n");
}

/* ---------- formularios del mapa ---------- */

function abrirMapa(player) {
  const zoom = zoomDe(player);
  const rejilla = [];

  system.runJob((function* () {
    yield* muestrear(player, zoom, rejilla);
    pintarMarcadores(rejilla, player, zoom);

    const l = player.location;
    const rot = player.getRotation();
    const wps = leerWaypoints(player);
    const lado = RADIO * 2 * zoom;

    const cuerpo =
      componer(rejilla) + "\n\n" +
      `§7X §f${Math.floor(l.x)}  §7Y §f${Math.floor(l.y)}  ` +
      `§7Z §f${Math.floor(l.z)}  §7mirando §f${rumboDesdeYaw(rot.y)}\n` +
      `§7escala §f1 celda = ${zoom} bloque${zoom > 1 ? "s" : ""} ` +
      `§8(${lado} bloques de lado)\n` +
      `§f${YO}§7 vos  §f${JUGADOR}§7 jugadores  ` +
      `§c${TUMBA}§7 tumba  §e${WP}§7 waypoints`;

    const f = new ActionFormData()
      .title("Mapa")
      .body(cuerpo)
      .button("Acercar")
      .button("Alejar")
      .button("Marcar este lugar")
      .button(`Waypoints (${wps.length})`)
      .button("Cerrar");

    f.show(player).then(function (res) {
      if (res.canceled) return;
      const i = ZOOMS.indexOf(zoom);
      if (res.selection === 0) {
        player.setDynamicProperty(PROP_ZOOM, ZOOMS[Math.max(0, i - 1)]);
        abrirMapa(player);
      } else if (res.selection === 1) {
        player.setDynamicProperty(PROP_ZOOM, ZOOMS[Math.min(ZOOMS.length - 1, i + 1)]);
        abrirMapa(player);
      } else if (res.selection === 2) {
        marcarAqui(player);
      } else if (res.selection === 3) {
        listarWaypoints(player);
      }
    }).catch(function () {});
  })());
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
      player.sendMessage(`§e${WP} Waypoint §f${nombre}§e guardado.`);
    }).catch(function () {});
}

function listarWaypoints(player) {
  const lista = leerWaypoints(player);
  if (lista.length === 0) {
    player.sendMessage("§7No tenes waypoints. Usa \"Marcar este lugar\" en el mapa.");
    return;
  }
  const f = new ActionFormData().title("Waypoints").body("§7Toca uno para borrarlo.");
  for (const w of lista) {
    f.button(`${w.n}\n§7${w.x} ${w.y} ${w.z} - ${distancia(player.location, w)}m ` +
             `${rumboHacia(player.location, w)}`);
  }
  f.button("§7Volver al mapa");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection === lista.length) {
      abrirMapa(player);
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
    guardarTumba(e, loc, dim);
    e.sendMessage(
      `§c☠ Moriste en §f${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)} ` +
      `§7(${nombreDimension(dim)})`
    );
    e.sendMessage("§7Usa una §fbrujula§7 para abrir el mapa y ver donde quedo.");
  } catch (err) {
    console.warn(`[cerebria-hud] no pude guardar la tumba: ${err}`);
  }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn) return;   // solo tras morir, no al entrar al servidor
  const t = leerTumba(ev.player);
  if (!t) return;
  ev.player.sendMessage(
    `§e${TUMBA} Tu tumba quedo en §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.d)})`
  );
});

// La brujula abre el mapa. Sustituye a un comando de chat porque
// world.beforeEvents.chatSend es EXPERIMENTAL, y usarlo obligaria a activar Beta
// APIs y marcar el mundo para siempre.
world.afterEvents.itemUse.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || item.typeId !== "minecraft:compass") return;
  try {
    abrirMapa(ev.source);
  } catch (err) {
    console.warn(`[cerebria-hud] no pude abrir el mapa: ${err}`);
  }
});

/* ---------- bucle de la barra de accion ---------- */

// Guia al objetivo mas cercano (tumba o waypoint) para la barra de accion.
function guiaMasCercana(player) {
  const objetivos = [];
  for (const w of leerWaypoints(player)) {
    if (w.d === player.dimension.id) objetivos.push({ n: `${WP} ${w.n}`, c: "e", p: w });
  }
  if (objetivos.length === 0) return null;
  let mejor = null, mejorD = Infinity;
  for (const o of objetivos) {
    const d = distancia(player.location, o.p);
    if (d < mejorD) { mejorD = d; mejor = o; }
  }
  return `§${mejor.c}${mejor.n} §f${mejorD}m ${rumboHacia(player.location, mejor.p)}`;
}

system.runInterval(() => {
  const dia = world.getDay();
  const hj = horaDelJuego();
  const hr = horaReal();

  let base = `§b☀ Dia ${dia} §7| §f${hj} §7${franja()}`;
  if (hr) base += ` §7| §f${hr} §7real`;

  for (const player of world.getAllPlayers()) {
    try {
      // Todo en UNA linea: la barra de accion de Bedrock no soporta multilinea
      // (es una peticion abierta, no una funcion). Por eso el mapa va aparte, en
      // un formulario, donde si se puede pintar una cuadricula.
      let linea = base;

      const rot = player.getRotation();
      linea += ` §7| §f${YO} ${rumboDesdeYaw(rot.y)}`;

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
