/*
 * Cerebria HUD
 *
 * 1. Muestra dia, hora del juego y hora real en la barra de accion.
 * 2. Al morir, guarda donde quedo la tumba y te lo recuerda con distancia en vivo.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs, porque activar
 * experimentos marcaria el mundo de forma permanente e irreversible.
 *
 * Se usa la barra de accion a proposito: WAILA ocupa ui/hud_screen.json y Bedrock
 * no fusiona los JSON de UI, asi que cualquier cosa que tocara ese archivo
 * apagaria WAILA por completo. La barra de accion no la toca nadie.
 */

import { world, system } from "@minecraft/server";

const PROP_TUMBA = "cerebria:tumba";   // "x,y,z,dimensionId"
const RADIO_LLEGADA = 4;               // bloques: a esta distancia se considera encontrada
const UTC_OFFSET_HORAS = -5;           // Colombia, sin horario de verano

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
  const [x, y, z] = [Number(p[0]), Number(p[1]), Number(p[2])];
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return undefined;
  return { x, y, z, dimensionId: p[3] };
}

function borrarTumba(player) {
  player.setDynamicProperty(PROP_TUMBA, undefined);
}

function nombreDimension(id) {
  if (id.endsWith("nether")) return "Nether";
  if (id.endsWith("the_end")) return "End";
  return "Overworld";
}

function textoTumba(player) {
  const t = leerTumba(player);
  if (!t) return null;
  // Solo tiene sentido mostrar distancia dentro de la misma dimension.
  if (player.dimension.id !== t.dimensionId) {
    return `§7⚰ Tumba en §f${nombreDimension(t.dimensionId)}§7: ${t.x} ${t.y} ${t.z}`;
  }
  const l = player.location;
  const d = Math.round(Math.hypot(l.x - t.x, l.y - t.y, l.z - t.z));
  if (d <= RADIO_LLEGADA) {
    borrarTumba(player);
    player.sendMessage("§a⚰ Llegaste a tu tumba.");
    return null;
  }
  return `§e⚰ Tumba: §f${t.x} ${t.y} ${t.z} §7(${d} m)`;
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
    e.sendMessage("§7Usa una §fbrujula§7 para volver a ver donde quedo.");
  } catch (err) {
    console.warn(`[cerebria-hud] no pude guardar la tumba: ${err}`);
  }
});

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (ev.initialSpawn) return;   // solo tras morir, no al entrar al servidor
  const t = leerTumba(ev.player);
  if (!t) return;
  ev.player.sendMessage(
    `§e⚰ Tu tumba quedo en §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.dimensionId)})`
  );
});

// Sustituto del comando de chat: world.beforeEvents.chatSend es EXPERIMENTAL, y
// usarlo obligaria a activar Beta APIs y marcar el mundo para siempre.
world.afterEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack?.typeId !== "minecraft:compass") return;
  const t = leerTumba(ev.source);
  if (!t) {
    ev.source.sendMessage("§7No tienes ninguna tumba pendiente.");
    return;
  }
  ev.source.sendMessage(
    `§e⚰ Tumba: §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.dimensionId)})`
  );
});

/* ---------- bucle de la barra de accion ---------- */

system.runInterval(() => {
  const dia = world.getDay();
  const hj = horaDelJuego();
  const hr = horaReal();

  let base = `§b☀ Dia ${dia} §7| §f${hj} §7${franja()}`;
  if (hr) base += ` §7| §f${hr} §7real`;

  for (const player of world.getAllPlayers()) {
    try {
      const tumba = textoTumba(player);
      player.onScreenDisplay.setActionBar(tumba ? `${base}   ${tumba}` : base);
    } catch (err) {
      // Un jugador que se desconecta a mitad del tick no debe romper el resto.
    }
  }
}, 20);

console.log("[cerebria-hud] cargado");
