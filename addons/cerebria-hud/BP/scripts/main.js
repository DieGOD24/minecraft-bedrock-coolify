/*
 * Cerebria HUD
 *
 * 1. Dia, hora del juego, hora real y rumbo en la barra de accion.
 * 2. Waypoints en la BARRA LOCALIZADORA nativa, con haz de luz de colores.
 * 3. Al morir marca la tumba, con marcador y haz propios.
 * 4. La brujula abre el menu de waypoints.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs, porque activar
 * experimentos marcaria el mundo de forma permanente e irreversible.
 *
 * TODO EN UN SOLO ARCHIVO a proposito. Al dividirlo en dos con un import relativo,
 * el pack dejo de cargar entero y hasta el reloj desaparecio: en Bedrock, si un
 * modulo falla al importar no corre NADA. El unico addon con scripts que funciona
 * en este servidor, WAILA, es un unico bundle sin imports relativos. No dividir.
 *
 * SIN TOPE DE WAYPOINTS
 * Antes guardaba con `lista.slice(0, 20)`: a partir del waypoint 21 se descartaban
 * EN SILENCIO al guardar. Eso era el "se buguea". Ya no hay recorte.
 * La barra del HUD si tiene un maxCount que impone Bedrock y no se puede quitar,
 * pero se llena con los puntos de TU dimension ordenados del mas cercano, asi que
 * en la practica no estorba. El numero real se muestra en el menu.
 *
 * SIN CODIGOS § EN LOS BOTONES
 * Un "§7Volver" quedaba gris sobre boton gris: invisible. Bedrock aplica su propio
 * estilo a los botones, asi que el color ahi no es fiable. Va solo en el cuerpo de
 * los formularios y en los mensajes de chat.
 */

import {
  world, system, ItemStack, LocationWaypoint, WaypointTexture, MolangVariableMap
} from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PROP_TUMBA = "cerebria:tumba";        // "x,y,z,dimensionId"
const PROP_WAYPOINTS = "cerebria:waypoints";

const RADIO_LLEGADA = 4;        // bloques: a esta distancia la tumba se da por hallada
const UTC_OFFSET_HORAS = -5;    // Colombia, sin horario de verano
const MAX_LARGO_NOMBRE = 20;    // recorte del NOMBRE, no de la cantidad

// Haz de luz. Se corta a 128 bloques porque mas lejos el cliente no lo renderiza
// igual y emitir seria gasto puro.
const HAZ_DISTANCIA = 128;
const HAZ_ALTURA = 90;
const HAZ_PASO = 3;             // ~30 particulas por punto cercano
const HAZ_INTERVALO = 10;       // ticks

const COLORES = [
  { n: "Blanco",   rgb: { red: 1.0, green: 1.0,  blue: 1.0 } },
  { n: "Rojo",     rgb: { red: 1.0, green: 0.2,  blue: 0.2 } },
  { n: "Naranja",  rgb: { red: 1.0, green: 0.6,  blue: 0.1 } },
  { n: "Amarillo", rgb: { red: 1.0, green: 0.95, blue: 0.2 } },
  { n: "Verde",    rgb: { red: 0.3, green: 1.0,  blue: 0.3 } },
  { n: "Cian",     rgb: { red: 0.3, green: 0.9,  blue: 1.0 } },
  { n: "Azul",     rgb: { red: 0.3, green: 0.4,  blue: 1.0 } },
  { n: "Morado",   rgb: { red: 0.7, green: 0.3,  blue: 1.0 } },
  { n: "Rosa",     rgb: { red: 1.0, green: 0.5,  blue: 0.8 } }
];
const COLOR_TUMBA = { red: 1.0, green: 0.15, blue: 0.15 };

function colorDe(w) {
  return (COLORES[w.c] || COLORES[0]);
}

function selectorTextura(textura) {
  return { textureBoundsList: [{ lowerBound: 0, texture: textura }] };
}

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

/* ---------- almacenamiento ---------- */

function leerTumba(player) {
  const raw = player.getDynamicProperty(PROP_TUMBA);
  if (typeof raw !== "string") return undefined;
  const p = raw.split(",");
  if (p.length !== 4) return undefined;
  const x = Number(p[0]), y = Number(p[1]), z = Number(p[2]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return undefined;
  return { x: x, y: y, z: z, d: p[3] };
}

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

// SIN recorte de cantidad: antes habia un slice(0, 20) que descartaba en silencio
// todo lo que pasara de 20 waypoints.
function guardarWaypoints(player, lista) {
  player.setDynamicProperty(PROP_WAYPOINTS, JSON.stringify(lista));
  sincronizarBarra(player);
}

// Devuelve pares {w, i} para poder editar por indice real aunque la vista este
// filtrada por dimension.
function waypointsDe(player, dimensionId, ordenarPorDistancia) {
  const lista = leerWaypoints(player);
  const salida = [];
  for (let i = 0; i < lista.length; i++) {
    if (dimensionId && lista[i].d !== dimensionId) continue;
    salida.push({ w: lista[i], i: i });
  }
  if (ordenarPorDistancia) {
    const yo = player.location;
    salida.sort(function (a, b) {
      return distancia(yo, a.w) - distancia(yo, b.w);
    });
  }
  return salida;
}

function waypointsDeOtrasDimensiones(player) {
  const lista = leerWaypoints(player);
  const salida = [];
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].d !== player.dimension.id) salida.push({ w: lista[i], i: i });
  }
  return salida;
}

/* ---------- barra localizadora nativa ---------- */
/*
 * Solo entran los puntos de la dimension ACTUAL, ordenados del mas cercano. Antes
 * se metian los de todas las dimensiones: la doc avisa que los invalidos se
 * limpian al tick siguiente, pero ANTES consumen cupo del maxCount y desplazan a
 * los que si deberian verse. Eso hacia que se portara raro al cambiar de mundo.
 *
 * Se borra todo y se repuebla porque removeAllWaypoints solo alcanza a los de ESTE
 * pack ("You can only modify, remove, or query waypoints that were added by this
 * pack"), asi que es seguro e idempotente.
 *
 * La barra NO persiste entre sesiones: hay que rellenarla al entrar, al reaparecer
 * y al cambiar de dimension.
 */
function sincronizarBarra(player) {
  let barra;
  try {
    barra = player.locatorBar;
    if (!barra) return;
    barra.removeAllWaypoints();
  } catch (e) {
    console.warn(`[cerebria-hud] locatorBar no disponible: ${e}`);
    return;
  }

  const dim = player.dimension;
  const puntos = [];

  for (const par of waypointsDe(player, dim.id, true)) {
    puntos.push({
      loc: { dimension: dim, x: par.w.x, y: par.w.y, z: par.w.z },
      textura: WaypointTexture.Square,
      color: colorDe(par.w).rgb
    });
  }

  // La tumba va primera si esta en esta dimension: es la que mas urge encontrar.
  const t = leerTumba(player);
  if (t && t.d === dim.id) {
    puntos.unshift({
      loc: { dimension: dim, x: t.x, y: t.y, z: t.z },
      textura: WaypointTexture.SmallStar,
      color: COLOR_TUMBA
    });
  }

  for (const p of puntos) {
    // maxCount es un tope real de Bedrock: addWaypoint lanza error al pasarse.
    // Al venir ordenado por cercania, lo que se corta es siempre lo mas lejano.
    if (barra.maxCount && barra.count >= barra.maxCount) break;
    try {
      barra.addWaypoint(new LocationWaypoint(p.loc, selectorTextura(p.textura), p.color));
    } catch (e) {
      console.warn(`[cerebria-hud] no pude anadir un waypoint a la barra: ${e}`);
    }
  }
}

function estadoBarra(player) {
  try {
    const b = player.locatorBar;
    if (!b) return "";
    return `§7Barra: §f${b.count}/${b.maxCount}`;
  } catch (e) {
    return "";
  }
}

/* ---------- haz de luz de colores ---------- */
/*
 * player.spawnParticle es privado del jugador ("Only visible to the target
 * player"), asi que cada uno ve solo sus puntos.
 *
 * colored_flame_particle + MolangVariableMap.setColorRGB("variable.color", ...)
 * sale del ejemplo oficial de Microsoft para Player.spawnParticle. Es lo que
 * permite que el haz salga DEL COLOR elegido en vez de blanco fijo.
 *
 * Aviso: es una hilera de llamas de color, no la columna translucida de un beacon
 * de verdad. Sin una particula propia en un resource pack, es lo mas cercano.
 */
function emitirHaz(player, punto, rgb) {
  if (punto.d !== player.dimension.id) return;
  if (distancia(player.location, punto) > HAZ_DISTANCIA) return;

  const molang = new MolangVariableMap();
  molang.setColorRGB("variable.color", rgb);

  for (let dy = 0; dy < HAZ_ALTURA; dy += HAZ_PASO) {
    try {
      player.spawnParticle("minecraft:colored_flame_particle", {
        x: punto.x + 0.5,
        y: punto.y + dy,
        z: punto.z + 0.5
      }, molang);
    } catch (e) {
      // Chunk sin cargar o fuera del mundo: se corta el haz, no el ciclo.
      return;
    }
  }
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      for (const par of waypointsDe(player, player.dimension.id, false)) {
        emitirHaz(player, par.w, colorDe(par.w).rgb);
      }
      const t = leerTumba(player);
      if (t) emitirHaz(player, t, COLOR_TUMBA);
    } catch (e) {
      // Un jugador que se desconecta a mitad del tick no debe romper el resto.
    }
  }
}, HAZ_INTERVALO);

/* ---------- menu principal (brujula) ---------- */

function abrirMenu(player) {
  const aqui = waypointsDe(player, player.dimension.id, true).length;
  const otras = waypointsDeOtrasDimensiones(player).length;
  const t = leerTumba(player);
  const l = player.location;

  let cuerpo = `§7Estas en §f${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} ` +
               `§7(${nombreDimension(player.dimension.id)})\n` +
               `§7Mirando al §f${rumboDesdeYaw(player.getRotation().y)}\n` +
               `§7Waypoints aqui: §f${aqui}§7, en otras dimensiones: §f${otras}`;
  const eb = estadoBarra(player);
  if (eb) cuerpo += `\n${eb}`;
  if (t) {
    cuerpo += `\n§cTumba: §f${t.x} ${t.y} ${t.z}`;
    cuerpo += t.d === player.dimension.id
      ? ` §7(${distancia(l, t)}m ${rumboHacia(l, t)})`
      : ` §7en ${nombreDimension(t.d)}`;
  }

  new ActionFormData()
    .title("Brujula")
    .body(cuerpo)
    .button("Marcar este lugar")
    .button(`Mis waypoints (${aqui})`)
    .button("Cerrar")
    .show(player).then(function (res) {
      if (res.canceled) return;
      if (res.selection === 0) marcarAqui(player);
      else if (res.selection === 1) listarWaypoints(player);
    }).catch(function () {});
}

function marcarAqui(player) {
  const l = player.location;
  const etiqueta = `X ${Math.floor(l.x)}  Y ${Math.floor(l.y)}  Z ${Math.floor(l.z)}\nNombre:`;
  const nombresColor = COLORES.map(function (c) { return c.n; });

  new ModalFormData()
    .title("Marcar lugar")
    .textField(etiqueta, "casa")
    .dropdown("Color del marcador y del haz", nombresColor, { defaultValueIndex: 4 })
    .show(player).then(function (res) {
      if (res.canceled) return;
      const valores = res.formValues || [];
      const bruto = valores[0] == null ? "" : String(valores[0]);
      const nombre = bruto.trim() || "sin nombre";
      const color = typeof valores[1] === "number" ? valores[1] : 4;
      const lista = leerWaypoints(player);
      lista.push({
        n: nombre.slice(0, MAX_LARGO_NOMBRE),
        x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
        d: player.dimension.id,
        c: color
      });
      guardarWaypoints(player, lista);
      player.sendMessage(
        `§eWaypoint §f${nombre}§e guardado (${COLORES[color].n}). ` +
        `§7Total: ${lista.length}`
      );
    }).catch(function () {});
}

/* ---------- listas ---------- */

function etiquetaWaypoint(player, w, conDimension) {
  const mismaDim = w.d === player.dimension.id;
  const detalle = mismaDim
    ? `${distancia(player.location, w)}m ${rumboHacia(player.location, w)}`
    : nombreDimension(w.d);
  const sufijo = conDimension && mismaDim ? ` - ${nombreDimension(w.d)}` : "";
  return `${w.n}\n§7${w.x} ${w.y} ${w.z} - ${detalle}${sufijo}`;
}

function listarWaypoints(player) {
  const pares = waypointsDe(player, player.dimension.id, true);
  const otras = waypointsDeOtrasDimensiones(player);

  if (pares.length === 0 && otras.length === 0) {
    player.sendMessage("§7No tenes waypoints. Usa \"Marcar este lugar\".");
    return;
  }

  let cuerpo = `§7${nombreDimension(player.dimension.id)}: §f${pares.length}§7 puntos, ` +
               `del mas cercano al mas lejano.`;
  const eb = estadoBarra(player);
  if (eb) cuerpo += `\n${eb}§7 visibles en el HUD.`;

  const f = new ActionFormData().title("Waypoints").body(cuerpo);
  for (const par of pares) f.button(etiquetaWaypoint(player, par.w, false));
  if (otras.length > 0) f.button(`Otras dimensiones (${otras.length})`);
  f.button("Volver");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection < pares.length) {
      menuWaypoint(player, pares[res.selection].i);
      return;
    }
    if (otras.length > 0 && res.selection === pares.length) {
      listarOtrasDimensiones(player);
      return;
    }
    abrirMenu(player);
  }).catch(function () {});
}

// Permite administrar puntos de otras dimensiones sin tener que viajar hasta alla.
function listarOtrasDimensiones(player) {
  const pares = waypointsDeOtrasDimensiones(player);
  if (pares.length === 0) { listarWaypoints(player); return; }

  const f = new ActionFormData()
    .title("Otras dimensiones")
    .body("§7Podes renombrar, cambiar color o borrar.\n" +
          "§7Para viajar tenes que estar en la misma dimension.");
  for (const par of pares) {
    f.button(`${par.w.n}\n§7${par.w.x} ${par.w.y} ${par.w.z} - ${nombreDimension(par.w.d)}`);
  }
  f.button("Volver");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection < pares.length) menuWaypoint(player, pares[res.selection].i);
    else listarWaypoints(player);
  }).catch(function () {});
}

/* ---------- menu de un waypoint ---------- */

function menuWaypoint(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) { listarWaypoints(player); return; }

  const mismaDim = w.d === player.dimension.id;
  const cuerpo = `§f${w.n}\n§7${w.x} ${w.y} ${w.z} (${nombreDimension(w.d)})\n` +
                 (mismaDim
                   ? `§7A ${distancia(player.location, w)}m hacia el ${rumboHacia(player.location, w)}`
                   : `§6Estas en ${nombreDimension(player.dimension.id)}, este punto esta en ${nombreDimension(w.d)}`) +
                 `\n§7Color: §f${colorDe(w).n}`;

  // El boton se deja visible aunque no se pueda viajar: uno ausente deja al
  // jugador sin saber si es un fallo. Al tocarlo explica por que.
  new ActionFormData()
    .title(w.n)
    .body(cuerpo)
    .button(mismaDim ? "Ir aqui" : "Ir aqui (otra dimension)")
    .button("Renombrar")
    .button("Mover aqui")
    .button("Cambiar color")
    .button("Borrar")
    .button("Volver")
    .show(player).then(function (res) {
      if (res.canceled) return;
      if (res.selection === 0) {
        if (!mismaDim) {
          player.sendMessage(
            `§6No puedo llevarte: §f${w.n}§6 esta en ${nombreDimension(w.d)} ` +
            `y vos estas en ${nombreDimension(player.dimension.id)}.`
          );
          player.sendMessage("§7Viaja por un portal y desde alli podras usarlo.");
          return;
        }
        confirmarViaje(player, indice);
      } else if (res.selection === 1) renombrar(player, indice);
      else if (res.selection === 2) moverAqui(player, indice);
      else if (res.selection === 3) cambiarColor(player, indice);
      else if (res.selection === 4) confirmarBorrado(player, indice);
      else listarWaypoints(player);
    }).catch(function () {});
}

// Confirmacion a proposito: un toque accidental que te teletransporte en survival
// puede costar caro.
function confirmarViaje(player, indice) {
  const w = leerWaypoints(player)[indice];
  if (!w) return;
  new ActionFormData()
    .title("Ir aqui")
    .body(`§7Te vas a teletransportar a §f${w.n}\n§7${w.x} ${w.y} ${w.z} ` +
          `(${nombreDimension(w.d)})`)
    .button("Si, llevame")
    .button("Cancelar")
    .show(player).then(function (res) {
      if (res.canceled || res.selection !== 0) return;
      viajar(player, w);
    }).catch(function () {});
}

function viajar(player, w) {
  // Doble comprobacion: entre abrir el menu y confirmar, el jugador pudo cambiar
  // de dimension.
  if (w.d !== player.dimension.id) {
    player.sendMessage("§6Cambiaste de dimension; el viaje se cancelo.");
    return;
  }
  const destino = { x: w.x + 0.5, y: w.y + 1, z: w.z + 0.5 };
  try {
    player.teleport(destino);
    player.sendMessage(`§aTe llevaste a §f${w.n}§a.`);
    return;
  } catch (e) {
    console.warn(`[cerebria-hud] teleport() fallo, se prueba por comando: ${e}`);
  }
  // Respaldo por comando: ya probado en este servidor.
  try {
    const nombre = player.name.replace(/"/g, "");
    player.dimension.runCommand(`tp "${nombre}" ${destino.x} ${destino.y} ${destino.z}`);
    player.sendMessage(`§aTe llevaste a §f${w.n}§a.`);
  } catch (e2) {
    player.sendMessage("§cNo pude teletransportarte.");
    console.warn(`[cerebria-hud] tp por comando tambien fallo: ${e2}`);
  }
}

function renombrar(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) return;
  new ModalFormData()
    .title("Renombrar")
    .textField("Nombre nuevo:", w.n, { defaultValue: w.n })
    .show(player).then(function (res) {
      if (res.canceled) return;
      const valores = res.formValues || [];
      const bruto = valores[0] == null ? "" : String(valores[0]);
      const nombre = bruto.trim();
      if (!nombre) { player.sendMessage("§7Nombre vacio, no se cambio nada."); return; }
      const anterior = w.n;
      w.n = nombre.slice(0, MAX_LARGO_NOMBRE);
      guardarWaypoints(player, lista);
      player.sendMessage(`§7Waypoint §f${anterior}§7 ahora se llama §f${w.n}§7.`);
    }).catch(function () {});
}

function moverAqui(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) return;
  const l = player.location;
  const dimAnterior = w.d;
  w.x = Math.floor(l.x); w.y = Math.floor(l.y); w.z = Math.floor(l.z);
  w.d = player.dimension.id;
  guardarWaypoints(player, lista);
  player.sendMessage(`§eWaypoint §f${w.n}§e movido a §f${w.x} ${w.y} ${w.z}§e.`);
  if (dimAnterior !== w.d) {
    player.sendMessage(
      `§7Cambio de ${nombreDimension(dimAnterior)} a ${nombreDimension(w.d)}.`
    );
  }
}

function cambiarColor(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) return;
  const f = new ActionFormData().title("Color").body(`§7Color de §f${w.n}`);
  for (const c of COLORES) f.button(c.n);
  f.button("Volver");
  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection >= COLORES.length) { menuWaypoint(player, indice); return; }
    w.c = res.selection;
    guardarWaypoints(player, lista);
    player.sendMessage(`§7Color de §f${w.n}§7 cambiado a §f${COLORES[w.c].n}§7.`);
  }).catch(function () {});
}

function confirmarBorrado(player, indice) {
  const w = leerWaypoints(player)[indice];
  if (!w) return;
  new ActionFormData()
    .title("Borrar")
    .body(`§7Vas a borrar §f${w.n}§7. Esto no se puede deshacer.`)
    .button("Si, borrar")
    .button("Cancelar")
    .show(player).then(function (res) {
      if (res.canceled || res.selection !== 0) return;
      const lista = leerWaypoints(player);
      const borrado = lista.splice(indice, 1)[0];
      guardarWaypoints(player, lista);
      player.sendMessage(`§7Waypoint §f${borrado ? borrado.n : "?"}§7 borrado.`);
    }).catch(function () {});
}

/* ---------- brujula siempre a mano ---------- */
/*
 * La brujula es la UNICA via de entrada al sistema de waypoints (ver el
 * afterEvents.itemUse mas abajo). Al morir sin keepinventory se pierde, y con ella
 * queda inaccesible todo: marcar, renombrar, viajar. Justo cuando mas hacen falta
 * los waypoints para volver a la tumba. Por eso se garantiza al reaparecer.
 */
function asegurarBrujula(player) {
  let contenedor;
  try {
    const inv = player.getComponent("minecraft:inventory");
    contenedor = inv && inv.container;
    if (!contenedor) return;
  } catch (e) {
    console.warn(`[cerebria-hud] no pude leer el inventario: ${e}`);
    return;
  }

  // Se recorren los slots en vez de usar contenedor.contains(): la doc no aclara
  // si `contains` compara tambien la cantidad, y 36 slots una vez por reaparicion
  // no cuestan nada. Si ya tiene una, no se le da otra: si no, se acumularian.
  try {
    for (let i = 0; i < contenedor.size; i++) {
      const it = contenedor.getItem(i);
      if (it && it.typeId === "minecraft:compass") return;
    }
  } catch (e) {
    return;   // inventario invalido a mitad de la lectura
  }

  try {
    const sobra = contenedor.addItem(new ItemStack("minecraft:compass", 1));
    if (sobra) {
      // addItem devuelve lo que no cupo. Se suelta a los pies para que no se
      // pierda en silencio.
      player.dimension.spawnItem(sobra, player.location);
      player.sendMessage("§7Inventario lleno: la brujula quedo en el suelo.");
    } else {
      player.sendMessage("§7Brujula entregada. Usala para tus waypoints.");
    }
  } catch (e) {
    console.warn(`[cerebria-hud] no pude entregar la brujula: ${e}`);
  }
}

/* ---------- kit de inicio ---------- */
/*
 * Se entrega UNA sola vez por jugador, marcado con una propiedad dinamica: sin
 * eso lo recibiria en cada reconexion. Como los datos del jugador viven en el
 * mundo, en un mundo nuevo todos vuelven a recibirlo, que es lo buscado.
 */
const PROP_KIT = "cerebria:kit";
const KIT = [
  ["cerebria:mochila_cuero", 1],
  ["minecraft:stone_pickaxe", 1],
  ["minecraft:stone_axe", 1],
  ["minecraft:stone_shovel", 1],
  ["minecraft:stone_sword", 1],
  ["minecraft:bread", 16],
  ["minecraft:torch", 32]
];

function entregarKit(player) {
  if (player.getDynamicProperty(PROP_KIT)) return;

  let contenedor;
  try {
    const inv = player.getComponent("minecraft:inventory");
    contenedor = inv && inv.container;
    if (!contenedor) return;
  } catch (e) { return; }

  let entregados = 0;
  for (const par of KIT) {
    try {
      // La mochila viene de OTRO pack: si ese pack no cargo, esto lanza. Se
      // captura por item para que el resto del kit llegue igual.
      const sobra = contenedor.addItem(new ItemStack(par[0], par[1]));
      if (sobra) player.dimension.spawnItem(sobra, player.location);
      entregados++;
    } catch (e) {
      console.warn(`[cerebria-hud] no pude dar ${par[0]} del kit: ${e}`);
    }
  }

  player.setDynamicProperty(PROP_KIT, true);
  player.sendMessage(`§aKit de inicio entregado (${entregados} objetos).`);
  player.sendMessage("§7Usa la mochila para abrirla y la brujula para tus waypoints.");
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
    e.sendMessage("§7Segui la estrella roja de la barra y el haz rojo.");
    sincronizarBarra(e);
  } catch (err) {
    console.warn(`[cerebria-hud] no pude guardar la tumba: ${err}`);
  }
});

// La barra localizadora no persiste entre sesiones: hay que rellenarla al entrar
// y al reaparecer.
world.afterEvents.playerSpawn.subscribe((ev) => {
  try {
    sincronizarBarra(ev.player);
  } catch (e) { /* ignorado */ }

  // Con retardo a proposito: dar objetos exactamente en el evento de reaparicion
  // falla a veces porque el jugador todavia no esta cargado del todo, y es la
  // clase de fallo intermitente que despues cuesta diagnosticar.
  // Va antes del early return para que aplique tambien al entrar: un jugador
  // nuevo sin brujula no tiene forma de usar los waypoints.
  system.runTimeout(function () {
    try {
      asegurarBrujula(ev.player);
      entregarKit(ev.player);
    } catch (e) { /* el jugador pudo desconectarse en el intervalo */ }
  }, 10);

  if (ev.initialSpawn) return;
  const t = leerTumba(ev.player);
  if (!t) return;
  ev.player.sendMessage(
    `§eTu tumba quedo en §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.d)})`
  );
});

// Cada dimension muestra sus propios puntos, asi que al cruzar hay que repoblar.
world.afterEvents.playerDimensionChange.subscribe((ev) => {
  try {
    sincronizarBarra(ev.player);
  } catch (e) { /* ignorado */ }
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

/* ---------- barra de accion ---------- */
/*
 * Solo dia, hora y rumbo. Los waypoints y la tumba no se dibujan aqui: tienen
 * marcador nativo en la barra localizadora y haz de luz. La barra de accion de
 * Bedrock es de UNA sola linea (el multilinea es una peticion abierta, no una
 * funcion), asi que el espacio es escaso.
 */
system.runInterval(() => {
  const dia = world.getDay();
  const hj = horaDelJuego();
  const hr = horaReal();

  let base = `§bDia ${dia} §7| §f${hj} §7${franja()}`;
  if (hr) base += ` §7| §f${hr} §7real`;

  for (const player of world.getAllPlayers()) {
    try {
      // Al llegar a la tumba se limpia sola, y con ella su marcador y su haz.
      const t = leerTumba(player);
      if (t && t.d === player.dimension.id &&
          distancia(player.location, t) <= RADIO_LLEGADA) {
        player.setDynamicProperty(PROP_TUMBA, undefined);
        player.sendMessage("§aLlegaste a tu tumba.");
        sincronizarBarra(player);
      }

      player.onScreenDisplay.setActionBar(
        `${base} §7| §f${rumboDesdeYaw(player.getRotation().y)}`
      );
    } catch (err) {
      // Un jugador que se desconecta a mitad del tick no debe romper el resto.
    }
  }
}, 20);

/* ---------- latido: prueba de que este script sigue VIVO ----------
 * Un objetivo de scoreboard es PERSISTENTE: vive en el mundo. Que exista solo
 * prueba que el script corrio alguna vez, no que corra ahora. La sonda anterior
 * era justo eso, y por eso no servia para nada.
 *
 * Lo que se comprueba es que el numero SUBA entre dos lecturas. El sidecar lo
 * lee con `scoreboard players list <participante>` y compara.
 *
 * Va dentro de runInterval y no al nivel superior del modulo: ahi estariamos en
 * early-execution mode, con funciones restringidas, y fallaria sola.
 */
system.runInterval(function () {
  try {
    const sb = world.scoreboard;
    const obj = sb.getObjective("salud") || sb.addObjective("salud", "salud de los scripts");
    let n = 0;
    try { n = obj.getScore("hud") || 0; } catch (e) { n = 0; }
    obj.setScore("hud", (n + 1) % 1000000);
  } catch (e) {
    // No debe tumbar nada: es diagnostico, no funcionalidad.
  }
}, 40);

console.log("[cerebria-hud] cargado");
