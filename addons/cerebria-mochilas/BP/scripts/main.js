/*
 * Cerebria Mochilas
 *
 * Tres niveles encadenados: cuero 9 huecos, hierro 18, netherita 27.
 * El contenido viaja DENTRO del item, no atado al jugador: se puede regalar llena.
 *
 * Todo usa @minecraft/server ESTABLE (2.4.0). Nada de Beta APIs.
 *
 * PACK APARTE DEL HUD a proposito: si este script falla al cargar, el reloj y los
 * waypoints siguen vivos. En Bedrock un modulo que falla tumba el pack ENTERO.
 * Y TODO EN UN SOLO ARCHIVO: dividirlo con un import relativo ya tumbo un pack.
 *
 * POR QUE ES UNA LISTA Y NO UN COFRE
 * Bedrock no permite abrir una interfaz de contenedor desde script: no existe un
 * player.openContainer() en la API estable. Asi que la mochila se maneja con
 * formularios: tocas un objeto y pasa de un lado al otro.
 *
 * POR QUE max_stack_size ES 1
 * ItemStack.setDynamicProperty solo funciona en items NO apilables. Es la
 * condicion que hace posible guardar el contenido dentro del propio item.
 */

import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const PROP = "cerebria:contenido";

const MOCHILAS = {
  "cerebria:mochila_cuero":     { nombre: "Mochila de cuero",     huecos: 9,  conservar: false },
  "cerebria:mochila_hierro":    { nombre: "Mochila de hierro",    huecos: 18, conservar: false },
  "cerebria:mochila_netherita": { nombre: "Mochila de netherita", huecos: 27, conservar: true }
};

/* ---------- que NO puede entrar ----------
 * Objetos que llevan datos que no puedo reconstruir al sacarlos. Se rechazan con
 * aviso claro: preferible decir "esto no entra" a comerse la Fortuna III de
 * alguien en silencio.
 */
function motivoBloqueo(stack) {
  const id = stack.typeId;
  if (MOCHILAS[id]) return "no podes meter una mochila dentro de otra";
  if (id.indexOf("shulker_box") !== -1) return "las cajas de shulker llevan su propio contenido";
  if (id.indexOf("written_book") !== -1 || id.indexOf("writable_book") !== -1) return "los libros llevan texto que se perderia";
  if (id.indexOf("filled_map") !== -1) return "los mapas guardan datos del mundo";
  if (id.indexOf("bundle") !== -1) return "las bolsas llevan su propio contenido";
  return null;
}

/* ---------- serializacion ----------
 * A texto, para la propiedad dinamica del item. Se conservan tipo, cantidad,
 * nombre, lore, desgaste y encantamientos.
 */
function serializar(stack) {
  const o = { t: stack.typeId, a: stack.amount };
  try { if (stack.nameTag) o.n = stack.nameTag; } catch (e) { /* sin nombre */ }
  try {
    const lore = stack.getLore();
    if (lore && lore.length) o.l = lore;
  } catch (e) { /* sin lore */ }
  try {
    const dur = stack.getComponent("minecraft:durability");
    if (dur && dur.damage) o.d = dur.damage;
  } catch (e) { /* sin durabilidad */ }
  try {
    const ench = stack.getComponent("minecraft:enchantable");
    if (ench) {
      const lista = [];
      for (const e of ench.getEnchantments()) {
        lista.push([e.type && e.type.id ? e.type.id : String(e.type), e.level]);
      }
      if (lista.length) o.e = lista;
    }
  } catch (e) { /* sin encantamientos */ }
  return o;
}

function deserializar(o) {
  const stack = new ItemStack(o.t, o.a || 1);
  try { if (o.n) stack.nameTag = o.n; } catch (e) { /* ignorado */ }
  try { if (o.l) stack.setLore(o.l); } catch (e) { /* ignorado */ }
  try {
    if (o.d) {
      const dur = stack.getComponent("minecraft:durability");
      if (dur) dur.damage = o.d;
    }
  } catch (e) { /* ignorado */ }
  try {
    if (o.e) {
      const ench = stack.getComponent("minecraft:enchantable");
      if (ench) for (const par of o.e) ench.addEnchantment({ type: par[0], level: par[1] });
    }
  } catch (e) {
    console.warn(`[mochilas] no pude restaurar encantamientos de ${o.t}: ${e}`);
  }
  return stack;
}

// Comprueba en caliente si los encantamientos sobreviven el ida y vuelta. Si no,
// se bloquea la entrada de objetos encantados en vez de perderlos.
let encantamientosOk = null;
function conservaEncantamientos() {
  if (encantamientosOk !== null) return encantamientosOk;
  try {
    const p = new ItemStack("minecraft:diamond_pickaxe", 1);
    const ench = p.getComponent("minecraft:enchantable");
    if (!ench) { encantamientosOk = false; return false; }
    ench.addEnchantment({ type: "fortune", level: 3 });
    const round = deserializar(serializar(p));
    const e2 = round.getComponent("minecraft:enchantable");
    encantamientosOk = !!(e2 && e2.getEnchantments().length > 0);
  } catch (e) {
    encantamientosOk = false;
  }
  console.log(`[mochilas] encantamientos preservables: ${encantamientosOk}`);
  return encantamientosOk;
}

/* ---------- acceso al contenido ---------- */

function leerContenido(stack) {
  const raw = stack.getDynamicProperty(PROP);
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    console.warn("[mochilas] contenido ilegible, se trata como vacia");
    return [];
  }
}

// Escribe y DEVUELVE el item modificado: hay que volver a ponerlo en la ranura,
// porque el ItemStack que se lee del contenedor es una copia.
function escribirContenido(stack, lista) {
  stack.setDynamicProperty(PROP, JSON.stringify(lista));
  return stack;
}

function contenedorDe(player) {
  const inv = player.getComponent("minecraft:inventory");
  return inv && inv.container ? inv.container : undefined;
}

function guardarEnRanura(player, ranura, stack) {
  const c = contenedorDe(player);
  if (c) c.setItem(ranura, stack);
}

/* ---------- formularios ---------- */

function etiqueta(o) {
  const nombre = o.n || o.t.replace("minecraft:", "").replace(/_/g, " ");
  const extras = [];
  if (o.d) extras.push("usado");
  if (o.e) extras.push(`${o.e.length} ench.`);
  return `${nombre} x${o.a || 1}` + (extras.length ? `\n§7${extras.join(" · ")}` : "");
}

function abrirMochila(player, ranura) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;

  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);

  const f = new ActionFormData()
    .title(def.nombre)
    .body(`§7${lista.length} de ${def.huecos} huecos usados.\n` +
          `§7Toca un objeto para sacarlo.`);
  for (const o of lista) f.button(etiqueta(o));
  f.button("Guardar objetos");
  f.button("Guardar todo lo que quepa");
  f.button("Sacar todo");
  f.button("Cerrar");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    const n = lista.length;
    if (res.selection < n) sacarUno(player, ranura, res.selection);
    else if (res.selection === n) listarInventario(player, ranura);
    else if (res.selection === n + 1) guardarTodo(player, ranura);
    else if (res.selection === n + 2) sacarTodo(player, ranura);
  }).catch(function () {});
}

function sacarUno(player, ranura, indice) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;

  const lista = leerContenido(stack);
  const o = lista[indice];
  if (!o) return;

  if (c.emptySlotsCount === 0) {
    player.sendMessage("§cNo tenes espacio libre en el inventario.");
    return;
  }
  const sobra = c.addItem(deserializar(o));
  if (sobra) {
    player.sendMessage("§cNo entro; queda en la mochila.");
    return;
  }
  lista.splice(indice, 1);
  guardarEnRanura(player, ranura, escribirContenido(stack, lista));
  abrirMochila(player, ranura);
}

function sacarTodo(player, ranura) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;

  const lista = leerContenido(stack);
  const quedan = [];
  let sacados = 0;
  for (const o of lista) {
    if (c.emptySlotsCount === 0) { quedan.push(o); continue; }
    const sobra = c.addItem(deserializar(o));
    if (sobra) quedan.push(o); else sacados++;
  }
  guardarEnRanura(player, ranura, escribirContenido(stack, quedan));
  player.sendMessage(`§aSacaste ${sacados} objeto(s).` +
    (quedan.length ? ` §7Quedan ${quedan.length} por falta de espacio.` : ""));
}

// Lista el inventario para elegir que meter. Se salta la ranura de la propia
// mochila para que no intente guardarse a si misma.
function listarInventario(player, ranura) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;
  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);

  if (lista.length >= def.huecos) {
    player.sendMessage("§cLa mochila esta llena.");
    return;
  }

  const candidatos = [];
  for (let i = 0; i < c.size; i++) {
    if (i === ranura) continue;
    const it = c.getItem(i);
    if (!it) continue;
    candidatos.push({ i: i, it: it, motivo: motivoBloqueo(it) });
  }
  if (candidatos.length === 0) {
    player.sendMessage("§7No tenes nada mas en el inventario.");
    return;
  }

  const f = new ActionFormData()
    .title("Guardar objetos")
    .body(`§7Quedan ${def.huecos - lista.length} huecos. Toca lo que quieras guardar.`);
  for (const cand of candidatos) {
    const nom = cand.it.nameTag || cand.it.typeId.replace("minecraft:", "").replace(/_/g, " ");
    f.button(cand.motivo ? `${nom} x${cand.it.amount}\n§cno entra` : `${nom} x${cand.it.amount}`);
  }
  f.button("Volver");

  f.show(player).then(function (res) {
    if (res.canceled) return;
    if (res.selection >= candidatos.length) { abrirMochila(player, ranura); return; }
    const elegido = candidatos[res.selection];
    if (elegido.motivo) {
      player.sendMessage(`§cNo entra: ${elegido.motivo}.`);
      listarInventario(player, ranura);
      return;
    }
    meterUno(player, ranura, elegido.i);
  }).catch(function () {});
}

function meterUno(player, ranura, ranuraOrigen) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  const origen = c.getItem(ranuraOrigen);
  if (!stack || !MOCHILAS[stack.typeId] || !origen) return;

  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);
  if (lista.length >= def.huecos) {
    player.sendMessage("§cLa mochila esta llena.");
    return;
  }
  const motivo = motivoBloqueo(origen);
  if (motivo) { player.sendMessage(`§cNo entra: ${motivo}.`); return; }
  if (!conservaEncantamientos() && origen.getComponent("minecraft:enchantable") &&
      origen.getComponent("minecraft:enchantable").getEnchantments().length > 0) {
    player.sendMessage("§cNo entra: los encantamientos se perderian.");
    return;
  }

  lista.push(serializar(origen));
  c.setItem(ranuraOrigen, undefined);
  guardarEnRanura(player, ranura, escribirContenido(stack, lista));
  listarInventario(player, ranura);
}

function guardarTodo(player, ranura) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;

  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);
  let metidos = 0, rechazados = 0;

  for (let i = 0; i < c.size && lista.length < def.huecos; i++) {
    if (i === ranura) continue;
    const it = c.getItem(i);
    if (!it) continue;
    if (motivoBloqueo(it)) { rechazados++; continue; }
    lista.push(serializar(it));
    c.setItem(i, undefined);
    metidos++;
  }
  guardarEnRanura(player, ranura, escribirContenido(stack, lista));
  player.sendMessage(`§aGuardaste ${metidos} objeto(s).` +
    (rechazados ? ` §7${rechazados} no entraban.` : "") +
    (lista.length >= def.huecos ? " §7Mochila llena." : ""));
}

/* ---------- eventos ---------- */

world.afterEvents.itemUse.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item || !MOCHILAS[item.typeId]) return;
  const player = ev.source;
  try {
    // El item usado esta en la ranura seleccionada del hotbar. Hace falta la
    // ranura, no la copia, para poder escribir el contenido de vuelta.
    abrirMochila(player, player.selectedSlotIndex);
  } catch (err) {
    console.warn(`[mochilas] no pude abrir la mochila: ${err}`);
  }
});

/*
 * Solo la de netherita se conserva al morir. keepOnDeath es una propiedad estable
 * del ItemStack, asi que no hace falta logica de recuperacion: lo marca el juego.
 * Se aplica al usarla, que es cuando tenemos la ranura para reescribirla.
 */
world.afterEvents.itemUse.subscribe((ev) => {
  const item = ev.itemStack;
  if (!item) return;
  const def = MOCHILAS[item.typeId];
  if (!def || !def.conservar) return;
  try {
    const c = contenedorDe(ev.source);
    const ranura = ev.source.selectedSlotIndex;
    const actual = c && c.getItem(ranura);
    if (actual && actual.typeId === item.typeId && !actual.keepOnDeath) {
      actual.keepOnDeath = true;
      c.setItem(ranura, actual);
    }
  } catch (e) { /* ignorado */ }
});

console.log("[mochilas] cargado");
