/*
 * Mapa cenital bajo demanda.
 *
 * Por que bajo demanda y no un minimapa permanente: Bedrock no tiene puente
 * script->UI para dibujar; un addon solo puede empujar TEXTO. Para una cuadricula
 * siempre visible hacen falta el canal de ui/hud_screen.json o el del titulo, y
 * WAILA ocupa los dos (su script manda el texto con prefijo "_r4ui:"). La barra de
 * accion es de UNA sola linea y el scoreboard lateral es global del mundo, no por
 * jugador. Un formulario, en cambio, si acepta texto multilinea.
 *
 * Ventaja lateral: al leer terreno solo cuando abris el mapa, el coste continuo
 * sobre el servidor es CERO.
 */

import { world, system } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PROP_TUMBA = "cerebria:tumba";
const PROP_ZOOM = "cerebria:zoom";
const PROP_WAYPOINTS = "cerebria:waypoints";

const RADIO = 12;               // 12 -> rejilla de 25x25 celdas
const ZOOMS = [1, 2, 4, 8];     // bloques por celda

// Glifos de RP/font/glyph_25.png. El resource pack vanilla NO trae esa pagina;
// si el RP no llego al cliente, esto se vera como cajas vacias.
const TILE = "█";      // bloque lleno
const YO = "▲";        // triangulo
const JUGADOR = "●";   // circulo
const TUMBA = "╳";     // cruz
const WP = "◆";        // rombo

/* ---------- paleta ---------- */
// [colores claro, oscuro] segun la altura respecto al jugador, para dar relieve.
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

/* ---------- utilidades compartidas con main.js ---------- */

const RUMBOS = ["S", "SO", "O", "NO", "N", "NE", "E", "SE"];

// Yaw de Bedrock: 0 = Sur (+Z), 90 = Oeste (-X), 180 = Norte (-Z), -90 = Este (+X).
export function rumboDesdeYaw(yaw) {
  const y = ((yaw % 360) + 360) % 360;
  return RUMBOS[Math.round(y / 45) % 8];
}

export function rumboHacia(desde, hasta) {
  const yaw = Math.atan2(-(hasta.x - desde.x), hasta.z - desde.z) * 180 / Math.PI;
  return rumboDesdeYaw(yaw);
}

export function distancia(a, b) {
  return Math.round(Math.hypot(a.x - b.x, a.z - b.z));
}

export function leerWaypoints(player) {
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

export function leerTumbaCruda(player) {
  const raw = player.getDynamicProperty(PROP_TUMBA);
  if (typeof raw !== "string") return undefined;
  const p = raw.split(",");
  if (p.length !== 4) return undefined;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(z)) return undefined;
  return { x: x, y: y, z: z, d: p[3] };
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
        // Chunk sin cargar u otro fallo: se pinta como desconocido en vez de
        // romper el mapa entero.
      }
      fila.push(color);
    }
    salida.push(fila);
    yield;   // una fila por porcion de tiempo
  }
}

/* ---------- render ---------- */

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

  const t = leerTumbaCruda(player);
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
    const fila = m[0][0], col = m[0][1];
    rejilla[fila][col] = "§" + m[1] + m[2];
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

/* ---------- formulario ---------- */

export function abrirMapa(player) {
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
      "§7X §f" + Math.floor(l.x) +
      "  §7Y §f" + Math.floor(l.y) +
      "  §7Z §f" + Math.floor(l.z) +
      "  §7mirando §f" + rumboDesdeYaw(rot.y) + "\n" +
      "§7escala §f1 celda = " + zoom + " bloque" + (zoom > 1 ? "s" : "") +
      " §8(" + lado + " bloques de lado)\n" +
      "§f" + YO + "§7 vos  §f" + JUGADOR + "§7 jugadores  §c" +
      TUMBA + "§7 tumba  §e" + WP + "§7 waypoints";

    const f = new ActionFormData()
      .title("Mapa")
      .body(cuerpo)
      .button("Acercar")
      .button("Alejar")
      .button("Marcar este lugar")
      .button("Waypoints (" + wps.length + ")")
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
  const etiqueta = "X " + Math.floor(l.x) + "  Y " + Math.floor(l.y) +
                   "  Z " + Math.floor(l.z) + "\nNombre:";
  new ModalFormData()
    .title("Marcar lugar")
    .textField(etiqueta, "casa")
    .show(player).then(function (res) {
      if (res.canceled) return;
      const valores = res.formValues || [];
      const nombre = String(valores[0] == null ? "" : valores[0]).trim() || "sin nombre";
      const lista = leerWaypoints(player);
      lista.push({
        n: nombre.slice(0, 20),
        x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
        d: player.dimension.id
      });
      guardarWaypoints(player, lista);
      player.sendMessage("§e" + WP + " Waypoint §f" + nombre + "§e guardado.");
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
    f.button(w.n + "\n§7" + w.x + " " + w.y + " " + w.z + " · " +
             distancia(player.location, w) + " m " + rumboHacia(player.location, w));
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
    player.sendMessage("§7Waypoint §f" + borrado.n + "§7 borrado.");
  }).catch(function () {});
}
