/*
 * Cerebria HUD
 *
 * 1. Dia, hora del juego, hora real y rumbo en la barra de accion.
 * 2. Waypoints en la BARRA LOCALIZADORA nativa de Bedrock, con haz de luz.
 * 3. Al morir marca la tumba igual, con su propio marcador y haz.
 * 4. La brujula abre el menu: conseguir mapa y gestionar waypoints.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs, porque activar
 * experimentos marcaria el mundo de forma permanente e irreversible.
 *
 * POR QUE LOS WAYPOINTS SON NATIVOS
 * Antes se dibujaban como texto en la barra de accion, ocupandola todo el tiempo.
 * Eso era una reimplementacion peor de algo que el juego ya resuelve:
 * player.locatorBar es API estable y pinta el marcador en el HUD, con color e
 * icono. El haz usa player.spawnParticle, que la doc describe como "Only visible
 * to the target player": cada uno ve solo sus propios puntos.
 *
 * TODO EN UN SOLO ARCHIVO a proposito. Al dividirlo en main.js + mapa.js con un
 * import relativo, el pack dejo de cargar entero y hasta el reloj desaparecio. El
 * unico addon con scripts que funciona en este servidor, WAILA, es un unico bundle
 * sin imports relativos. No dividir esto.
 *
 * POR QUE EL MAPA NO LO DIBUJA EL ADDON
 * Bedrock no tiene puente script->UI para dibujar: solo se puede empujar texto.
 * Una cuadricula de caracteres quedaba fea (los codigos § dan 28 colores contra
 * los 248 de un mapa real, y las filas quedan separadas). Lo que si se ve bien es
 * el mapa de Minecraft, asi que el addon te entrega uno.
 */

import { world, system, LocationWaypoint, WaypointTexture } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

const PROP_TUMBA = "cerebria:tumba";        // "x,y,z,dimensionId"
const PROP_WAYPOINTS = "cerebria:waypoints";

const RADIO_LLEGADA = 4;        // bloques: a esta distancia la tumba se da por hallada
const UTC_OFFSET_HORAS = -5;    // Colombia, sin horario de verano

// Haz de luz. Acotado a proposito: mas alla de ~96 bloques el cliente no lo
// renderiza igual, asi que emitir seria gastar por nada.
const HAZ_DISTANCIA = 96;
const HAZ_ALTURA = 40;
const HAZ_PASO = 2;
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

function guardarWaypoints(player, lista) {
  player.setDynamicProperty(PROP_WAYPOINTS, JSON.stringify(lista.slice(0, 20)));
  sincronizarBarra(player);
}

/* ---------- barra localizadora nativa ---------- */
/*
 * La barra NO persiste entre sesiones: la doc avisa que los waypoints invalidos se
 * limpian al tick siguiente. Por eso hay que re-sincronizarla al entrar, al
 * reaparecer y al cambiar de dimension, ademas de en cada cambio.
 *
 * Se borra todo y se vuelve a añadir porque `removeAllWaypoints` solo alcanza a
 * los waypoints de ESTE pack ("You can only modify, remove, or query waypoints
 * that were added by this pack"), asi que es seguro e idempotente.
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

  const puntos = [];
  for (const w of leerWaypoints(player)) {
    puntos.push({
      loc: { dimension: dimensionDe(w.d), x: w.x, y: w.y, z: w.z },
      textura: WaypointTexture.Square,
      color: (COLORES[w.c] || COLORES[0]).rgb
    });
  }
  const t = leerTumba(player);
  if (t) {
    puntos.push({
      loc: { dimension: dimensionDe(t.d), x: t.x, y: t.y, z: t.z },
      textura: WaypointTexture.SmallStar,
      color: COLOR_TUMBA
    });
  }

  for (const p of puntos) {
    if (!p.loc.dimension) continue;
    // maxCount es un tope real: addWaypoint lanza error al pasarse.
    if (barra.maxCount && barra.count >= barra.maxCount) {
      player.sendMessage("§7La barra localizadora esta llena; algunos puntos no se muestran.");
      break;
    }
    try {
      barra.addWaypoint(new LocationWaypoint(p.loc, selectorTextura(p.textura), p.color));
    } catch (e) {
      console.warn(`[cerebria-hud] no pude añadir un waypoint a la barra: ${e}`);
    }
  }
}

function dimensionDe(id) {
  try {
    return world.getDimension(id);
  } catch (e) {
    return undefined;
  }
}

/* ---------- haz de luz ---------- */
/*
 * player.spawnParticle es privado del jugador ("Only visible to the target
 * player"), asi que cada uno ve solo sus puntos y no se ensucia la pantalla ajena.
 */
function emitirHaz(player, punto, particula) {
  if (punto.d !== player.dimension.id) return;
  if (distancia(player.location, punto) > HAZ_DISTANCIA) return;
  for (let dy = 0; dy < HAZ_ALTURA; dy += HAZ_PASO) {
    try {
      player.spawnParticle(particula, {
        x: punto.x + 0.5,
        y: punto.y + dy,
        z: punto.z + 0.5
      });
    } catch (e) {
      // Chunk sin cargar o fuera del mundo: se corta el haz, no se rompe el ciclo.
      return;
    }
  }
}

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      for (const w of leerWaypoints(player)) emitirHaz(player, w, "minecraft:endrod");
      const t = leerTumba(player);
      if (t) emitirHaz(player, t, "minecraft:basic_flame_particle");
    } catch (e) {
      // Un jugador que se desconecta a mitad del tick no debe romper el resto.
    }
  }
}, HAZ_INTERVALO);

/* ---------- entrega del mapa localizador ---------- */
/*
 * El valor auxiliar del item no esta documentado de forma fiable, asi que se
 * prueban variantes y se usa la primera que el servidor acepta. Verificado por
 * consola: `give "<nombre>" empty_map 1 2` tiene sintaxis valida.
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
        player.sendMessage("§7Usalo (mantene presionado) para crear el mapa, " +
                           "y despues sostenelo en la mano para verlo.");
        return true;
      }
    } catch (e) {
      // Variante no aceptada por esta version; se prueba la siguiente.
    }
  }
  player.sendMessage("§cNo pude darte el mapa por comando.");
  player.sendMessage("§7Hacelo a mano: papel + brujula en una mesa de cartografia.");
  return false;
}

/* ---------- menu principal (brujula) ---------- */

function abrirMenu(player) {
  const wps = leerWaypoints(player);
  const t = leerTumba(player);
  const l = player.location;

  let cuerpo = `§7Estas en §f${Math.floor(l.x)} ${Math.floor(l.y)} ${Math.floor(l.z)} ` +
               `§7(${nombreDimension(player.dimension.id)})\n` +
               `§7Mirando al §f${rumboDesdeYaw(player.getRotation().y)}`;
  if (t) {
    cuerpo += `\n§cTumba: §f${t.x} ${t.y} ${t.z}`;
    cuerpo += t.d === player.dimension.id
      ? ` §7(${distancia(l, t)}m ${rumboHacia(l, t)})`
      : ` §7en ${nombreDimension(t.d)}`;
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
  const nombresColor = COLORES.map(function (c) { return c.n; });

  new ModalFormData()
    .title("Marcar lugar")
    .textField(etiqueta, "casa")
    .dropdown("Color del marcador", nombresColor, { defaultValueIndex: 4 })
    .show(player).then(function (res) {
      if (res.canceled) return;
      const valores = res.formValues || [];
      const bruto = valores[0] == null ? "" : String(valores[0]);
      const nombre = bruto.trim() || "sin nombre";
      const color = typeof valores[1] === "number" ? valores[1] : 4;
      const lista = leerWaypoints(player);
      lista.push({
        n: nombre.slice(0, 20),
        x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z),
        d: player.dimension.id,
        c: color
      });
      guardarWaypoints(player, lista);
      player.sendMessage(`§eWaypoint §f${nombre}§e guardado (${COLORES[color].n}).`);
    }).catch(function () {});
}

/* ---------- lista y menu de cada waypoint ---------- */

function listarWaypoints(player) {
  const lista = leerWaypoints(player);
  if (lista.length === 0) {
    player.sendMessage("§7No tenes waypoints. Usa \"Marcar este lugar\".");
    return;
  }
  const f = new ActionFormData().title("Waypoints").body("§7Toca uno para abrirlo.");
  for (const w of lista) {
    const detalle = w.d === player.dimension.id
      ? `${distancia(player.location, w)}m ${rumboHacia(player.location, w)}`
      : nombreDimension(w.d);
    f.button(`${w.n}\n§7${w.x} ${w.y} ${w.z} - ${detalle}`);
  }
  f.button("§7Volver");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection === lista.length) { abrirMenu(player); return; }
    menuWaypoint(player, res.selection);
  }).catch(function () {});
}

// Tocar un waypoint YA NO lo borra: abre este menu.
function menuWaypoint(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) { listarWaypoints(player); return; }

  const mismaDim = w.d === player.dimension.id;
  const cuerpo = `§f${w.n}\n§7${w.x} ${w.y} ${w.z} (${nombreDimension(w.d)})\n` +
                 (mismaDim
                   ? `§7A ${distancia(player.location, w)}m hacia el ${rumboHacia(player.location, w)}`
                   : "§7En otra dimension") +
                 `\n§7Color: §f${(COLORES[w.c] || COLORES[0]).n}`;

  new ActionFormData()
    .title(w.n)
    .body(cuerpo)
    .button("Ir aqui")
    .button("Renombrar")
    .button("Mover aqui")
    .button("Cambiar color")
    .button("Borrar")
    .button("§7Volver")
    .show(player).then(function (res) {
      if (res.canceled) return;
      if (res.selection === 0) confirmarViaje(player, indice);
      else if (res.selection === 1) renombrar(player, indice);
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
    .button("§aSi, llevame")
    .button("§cCancelar")
    .show(player).then(function (res) {
      if (res.canceled || res.selection !== 0) return;
      viajar(player, w);
    }).catch(function () {});
}

function viajar(player, w) {
  const destino = { x: w.x + 0.5, y: w.y + 1, z: w.z + 0.5 };
  const dim = dimensionDe(w.d);
  try {
    player.teleport(destino, dim ? { dimension: dim } : undefined);
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
      w.n = nombre.slice(0, 20);
      guardarWaypoints(player, lista);
      player.sendMessage(`§7Waypoint §f${anterior}§7 ahora se llama §f${w.n}§7.`);
    }).catch(function () {});
}

function moverAqui(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) return;
  const l = player.location;
  w.x = Math.floor(l.x); w.y = Math.floor(l.y); w.z = Math.floor(l.z);
  w.d = player.dimension.id;
  guardarWaypoints(player, lista);
  player.sendMessage(`§eWaypoint §f${w.n}§e movido a §f${w.x} ${w.y} ${w.z}§e.`);
}

function cambiarColor(player, indice) {
  const lista = leerWaypoints(player);
  const w = lista[indice];
  if (!w) return;
  const f = new ActionFormData().title("Color").body(`§7Color de §f${w.n}`);
  for (const c of COLORES) f.button(c.n);
  f.button("§7Volver");
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
    .button("§cSi, borrar")
    .button("Cancelar")
    .show(player).then(function (res) {
      if (res.canceled || res.selection !== 0) return;
      const lista = leerWaypoints(player);
      const borrado = lista.splice(indice, 1)[0];
      guardarWaypoints(player, lista);
      player.sendMessage(`§7Waypoint §f${borrado ? borrado.n : "?"}§7 borrado.`);
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
    e.sendMessage("§7Segui la estrella roja de la barra y el haz de fuego.");
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
  if (ev.initialSpawn) return;
  const t = leerTumba(ev.player);
  if (!t) return;
  ev.player.sendMessage(
    `§eTu tumba quedo en §f${t.x} ${t.y} ${t.z} §7(${nombreDimension(t.d)})`
  );
});

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
 * Queda limpia: solo dia, hora y rumbo. Los waypoints y la tumba ya no se dibujan
 * aqui porque tienen marcador nativo en la barra localizadora y haz de luz.
 * La barra de accion de Bedrock es de UNA sola linea (el multilinea es una
 * peticion abierta, no una funcion), asi que el espacio es escaso.
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

console.log("[cerebria-hud] cargado");
