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
 *
 * SOBRE LOS IMPORTS RELATIVOS: aqui se usan (./extensions/forms.js). Antes se
 * concluyo que Bedrock no los soportaba, porque al dividir el HUD en dos el pack
 * dejo de cargar; esa conclusion era ERRONEA. Chest-UI los usa como forma normal
 * de uso, esta mantenido y tiene cientos de usuarios, asi que la caida de entonces
 * tuvo otra causa. Aun asi el riesgo queda contenido: este pack es independiente.
 *
 * INTERFAZ DE COFRE
 * Bedrock no permite abrir un contenedor real desde script (no existe
 * player.openContainer()), pero Chest-UI reskinea el ActionForm para que se vea y
 * funcione como un cofre: rejilla, iconos reales, cantidades y brillo de encantado.
 * El tamano se codifica en el titulo del formulario con una cadena magica.
 * Sigue siendo hacer CLIC, no arrastrar y soltar: eso no existe en la API.
 *
 * show() de Chest-UI agrega el inventario del jugador como botones DESPUES de los
 * huecos del cofre, asi que un clic ahi mete el objeto. Para saber que ranura se
 * toco hay que reconstruir la misma lista de ranuras no vacias, en el mismo orden.
 *
 * POR QUE max_stack_size ES 1
 * ItemStack.setDynamicProperty solo funciona en items NO apilables. Es la
 * condicion que hace posible guardar el contenido dentro del propio item.
 */

import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const PROP = "cerebria:contenido";

/* ---------- diagnostico por chat ----------
 * BDS NO manda la salida de console.log/warn de los scripts a su stdout: va al
 * Content Log, que esta apagado. Lo comprobamos con un `reload`: la linea
 * "[mochilas] cargado" no aparecio en los logs pese a que el latido demuestra
 * que el script corre. Instrumentar con console.warn no sirve de nada aqui.
 *
 * El unico canal que si llega a una persona es el chat del propio jugador.
 * Cuando la mochila vuelva a funcionar, poner DIAG en false.
 */
const DEPURA = new Set();   // jugadores con el diagnostico encendido
function diag(player, texto) {
  console.warn(`[mochilas] ${texto}`);
  if (!player || !DEPURA.has(player.id)) return;
  try { player.sendMessage(`§8[dbg] §7${texto}`); } catch (e) { }
}

/* Si cambias un tamano de `huecos`, hay que ACTIVAR ese layout en
 * RP/ui/_global_variables.json ($disable_N_slots_layout: false). Chest-UI viene
 * con casi todos apagados, y abrir un cofre de un tamano apagado no da ningun
 * error: sale una pantalla transparente y sin boton de cerrar. */
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

/* ---------- interfaz de cofre ---------- */

// Misma lista que recorre show() de Chest-UI: ranuras NO vacias, en orden. Es lo
// que permite traducir el boton pulsado a una ranura real del inventario.
function ranurasConItems(contenedor) {
  const salida = [];
  for (let i = 0; i < contenedor.size; i++) {
    if (contenedor.getItem(i)) salida.push(i);
  }
  return salida;
}

// Chest-UI espera la durabilidad como porcentaje RESTANTE de 0 a 99.
function durabilidadRestante(stack) {
  try {
    const d = stack.getComponent("minecraft:durability");
    if (!d || !d.maxDurability) return 0;
    return Math.round((d.maxDurability - d.damage) / d.maxDurability * 99);
  } catch (e) {
    return 0;
  }
}

function tieneEncantamientos(stack) {
  try {
    const e = stack.getComponent("minecraft:enchantable");
    return !!(e && e.getEnchantments().length > 0);
  } catch (e) {
    return false;
  }
}

/* Jugadores que pidieron la vista de LISTA en vez de la de cofre (!mochilaplana).
 * Los indices de los botones son los mismos en las dos vistas, asi que el
 * manejador de la respuesta no cambia: solo cambia como se dibuja. */
const PLANO = new Set();

function nombreVisible(o) {
  return o.n || o.t.replace("minecraft:", "").replace(/_/g, " ");
}

// Tamanos de cofre que ofrece Chest-UI. Todos estan activados en
// _global_variables.json, asi que cualquiera vale.
const TAMANOS = [9, 18, 27, 36, 45, 54];

// El cofre crece para que quepan los huecos de la mochila MAS los objetos que
// lleva encima el jugador, porque ahora las dos cosas van en la misma rejilla.
function tamanoCofre(necesarios) {
  for (const t of TAMANOS) if (t >= necesarios) return t;
  return 54;
}

// Pinta un objeto real del inventario o de la mochila en una casilla del cofre.
// `etiqueta` es lo que se lee al tocarla; el resto es lo que Chest-UI necesita
// para dibujar el icono, la cantidad, el desgaste y el brillo de encantado.
function pintar(form, indice, etiqueta, lore, typeId, cantidad, muestra) {
  form.button(indice, etiqueta, lore, typeId, cantidad,
              durabilidadRestante(muestra), tieneEncantamientos(muestra));
}

/* Relleno de los huecos libres de la mochila y linea que separa las dos zonas.
 * Sin esto la rejilla se ve como un bloque continuo y no hay forma de saber donde
 * acaba la mochila y empieza el inventario. */
const ICONO_LIBRE = "minecraft:light_gray_stained_glass_pane";
const ICONO_SEPARADOR = "minecraft:black_stained_glass_pane";
const FILA = 9;

/* Reabre la mochila DESPUES de que se cierre la pantalla actual.
 *
 * Llamar a form.show() dentro del .then() del formulario que se esta cerrando no
 * funciona: en ese instante Bedrock considera que el jugador sigue ocupado y
 * devuelve canceled=true con cancelationReason 'UserBusy'. El manejador hacia
 * return sin decir nada, y desde fuera se veia como "se cierra y no vuelve".
 */
function reabrir(player, ranura) {
  system.runTimeout(function () { abrirMochila(player, ranura); }, 2);
}

/*
 * POR QUE EL INVENTARIO SE DIBUJA DENTRO DE LA REJILLA
 *
 * Chest-UI trae su propia fila de inventario debajo del cofre, y era la forma
 * natural de guardar: tocas tu objeto y entra. No funciona. Se midio en el juego:
 *
 *   rejilla del cofre, casilla llena  -> canceled=false sel=8   (indice correcto)
 *   fila de inventario, objeto propio -> canceled=false sel=1   (indice de la rejilla)
 *   fila de inventario, mochila vacia -> canceled=true UserClosed sel=undefined
 *
 * Y la fila SI muestra los objetos correctos. O sea: lo que se dibuja y lo que se
 * pulsa no coinciden. Con la mochila vacia los botones 0..8 no tienen texto,
 * Chest-UI los hace invisibles, el toque cae al fondo y Bedrock cierra la
 * pantalla -- ese era el "no me deja guardar" del principio.
 *
 * Los archivos de Chest-UI son byte a byte identicos al upstream y estamos en su
 * ultimo commit, asi que no es cosa nuestra ni hay arreglo rio arriba.
 *
 * La salida es no usar esa fila: se apaga ($show_inventory / inventory_enabled) y
 * el inventario se dibuja como casillas normales de la rejilla, que es la unica
 * parte cuyo clic esta demostrado que funciona. Un solo grid, un solo espacio de
 * indices, y el gesto para el jugador no cambia: toca su objeto y se guarda.
 *
 * DISPOSICION
 *
 *   0 .. huecos-1              la mochila (lo guardado, y el resto en gris)
 *   huecos .. inicioInv-1      fila separadora, si cabe
 *   inicioInv ..               tu inventario, etiquetado "Guardar"
 */
function abrirMochila(player, ranura, intento) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  if (!stack || !MOCHILAS[stack.typeId]) return;

  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);
  // Las ranuras del inventario que se dibujan DESPUES de los huecos, en su mismo
  // orden. Es lo que traduce el boton pulsado a una ranura real del inventario.
  const ranurasInv = ranurasConItems(c);
  const plano = PLANO.has(player.id);

  let form;
  let inicioInv = def.huecos;
  let mostrados = ranurasInv.length;

  if (plano) {
    form = new ActionFormData().title(def.nombre)
      .body("§7Vista de lista. Volve al cofre con §f/scriptevent cerebria:cofre");
    for (let i = 0; i < def.huecos; i++) {
      const o = lista[i];
      form.button(o ? `${nombreVisible(o)} §7x${o.a || 1}` : "§8(vacio)");
    }
    for (const s of ranurasInv) {
      const it = c.getItem(s);
      const n = it.typeId.replace("minecraft:", "").replace(/_/g, " ");
      form.button(`§2Guardar §r${n} §7x${it.amount}`);
    }
  } else {
    // La separadora solo si hay algo debajo que separar y si no le roba sitio a
    // los objetos: el cofre no pasa de 54.
    const separadora = (ranurasInv.length > 0 &&
                        def.huecos + FILA + ranurasInv.length <= 54) ? FILA : 0;
    inicioInv = def.huecos + separadora;

    const tamano = tamanoCofre(inicioInv + ranurasInv.length);
    mostrados = Math.min(ranurasInv.length, tamano - inicioInv);

    form = new ChestFormData(String(tamano))
      .title(`${def.nombre}  §7${lista.length}/${def.huecos}`);

    // Zona 1: lo que ya hay guardado. Tocarlo lo saca.
    for (let i = 0; i < lista.length && i < def.huecos; i++) {
      const o = lista[i];
      let vista;
      try {
        vista = deserializar(o);
      } catch (e) {
        continue;   // entrada corrupta: se salta en vez de romper la apertura
      }
      pintar(form, i, nombreVisible(o), o.l || [], o.t, o.a || 1, vista);
    }
    // ...y el resto de la mochila en gris, para que la zona se vea entera aunque
    // este vacia. Un boton sin texto lo hace invisible Chest-UI.
    for (let i = lista.length; i < def.huecos; i++) {
      form.button(i, "§7Hueco libre", [], ICONO_LIBRE, 1, 0, false);
    }

    // Zona 2: la linea que separa las dos mitades.
    for (let i = def.huecos; i < inicioInv; i++) {
      form.button(i, "§8▼ Tu inventario ▼", [], ICONO_SEPARADOR, 1, 0, false);
    }

    // Zona 3: el inventario del jugador. Tocarlo lo guarda.
    for (let k = 0; k < mostrados; k++) {
      const it = c.getItem(ranurasInv[k]);
      if (!it) continue;
      const nombre = it.nameTag || it.typeId.replace("minecraft:", "").replace(/_/g, " ");
      let lore = [];
      try { lore = it.getLore() || []; } catch (e) { lore = []; }
      pintar(form, inicioInv + k, `§aGuardar §r${nombre}`, lore,
             it.typeId, it.amount, it);
    }

    if (mostrados < ranurasInv.length) {
      player.sendMessage(`§7Quedaron ${ranurasInv.length - mostrados} objetos sin mostrar: no caben en el cofre.`);
    }
  }

  diag(player, `abriendo (${plano ? "lista" : "cofre"}): huecos=${def.huecos} guardados=${lista.length} inicioInv=${inicioInv} ranurasInv=${ranurasInv.length} mostrados=${mostrados}`);

  form.show(player).then(function (res) {
    diag(player, `respuesta: canceled=${res.canceled} motivo=${res.cancelationReason} sel=${res.selection}`);

    // UserBusy = el jugador todavia tiene una pantalla encima; se reintenta. No se
    // reintenta UserClosed: ahi cerro a proposito y hay que dejarlo en paz.
    if (res.canceled) {
      const n = intento || 0;
      if (res.cancelationReason === "UserBusy" && n < 8) {
        system.runTimeout(function () { abrirMochila(player, ranura, n + 1); }, 4);
      }
      return;
    }

    const sel = res.selection;
    if (sel < def.huecos) {
      if (sel < lista.length) sacarUno(player, ranura, sel);
      else reabrir(player, ranura);        // hueco libre: no hay nada que sacar
      return;
    }
    if (sel < inicioInv) { reabrir(player, ranura); return; }   // la separadora

    const origen = ranurasInv[sel - inicioInv];
    if (origen === undefined) { reabrir(player, ranura); return; }
    if (origen === ranura) {
      player.sendMessage("§7Esa es la mochila que tenes abierta.");
      reabrir(player, ranura);
      return;
    }
    meterUno(player, ranura, origen);
  }).catch(function (e) {
    // NUNCA vacio: este catch se tragaba en silencio cualquier error del manejador
    // (meterUno, sacarUno, serializar...) y el sintoma era "el clic no hace nada".
    diag(player, `ERROR al procesar el clic: ${e}${e && e.stack ? " | " + e.stack : ""}`);
  });
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
    reabrir(player, ranura);
    return;
  }
  const sobra = c.addItem(deserializar(o));
  if (sobra) {
    player.sendMessage("§cNo entro; queda en la mochila.");
    reabrir(player, ranura);
    return;
  }
  lista.splice(indice, 1);
  guardarEnRanura(player, ranura, escribirContenido(stack, lista));
  reabrir(player, ranura);
}

function meterUno(player, ranura, ranuraOrigen) {
  const c = contenedorDe(player);
  if (!c) return;
  const stack = c.getItem(ranura);
  const origen = c.getItem(ranuraOrigen);
  if (!stack || !MOCHILAS[stack.typeId] || !origen) { reabrir(player, ranura); return; }

  const def = MOCHILAS[stack.typeId];
  const lista = leerContenido(stack);
  if (lista.length >= def.huecos) {
    player.sendMessage("§cLa mochila esta llena.");
    reabrir(player, ranura);
    return;
  }
  const motivo = motivoBloqueo(origen);
  if (motivo) {
    player.sendMessage(`§cNo entra: ${motivo}.`);
    reabrir(player, ranura);
    return;
  }
  if (!conservaEncantamientos() && tieneEncantamientos(origen)) {
    player.sendMessage("§cNo entra: los encantamientos se perderian.");
    reabrir(player, ranura);
    return;
  }

  lista.push(serializar(origen));
  c.setItem(ranuraOrigen, undefined);
  guardarEnRanura(player, ranura, escribirContenido(stack, lista));
  reabrir(player, ranura);
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

/* ---------- comandos para separar causas ----------
 * Van por /scriptevent y NO por chat. `world.beforeEvents.chatSend` es
 * EXPERIMENTAL: usarlo obliga a activar Beta APIs y, sin ellas, la suscripcion
 * lanza al evaluar el modulo y se lleva por delante el PACK ENTERO. Paso: el
 * latido lo canto en la primera lectura ("MUERTO"), que es exactamente para lo
 * que se puso. cerebria-hud ya tenia escrita esa advertencia.
 * `system.afterEvents.scriptEventReceive` si es estable.
 *
 * Como todos entran como operador, se escriben en el chat tal cual:
 *   /scriptevent cerebria:formtest   formulario NORMAL, sin Chest-UI. Si este
 *                                    tampoco responde, lo roto son TODOS los
 *                                    formularios en el cliente, y el sospechoso
 *                                    es el override de ui/server_form.json que
 *                                    trae Chest-UI -- lo que explicaria ademas
 *                                    que la brujula no responda.
 *   /scriptevent cerebria:plana      mochila como lista. Mismos indices de
 *                                    boton y misma logica: si esta funciona, lo
 *                                    roto es solo la rejilla de cofre.
 *   /scriptevent cerebria:cofre      vuelve a la vista de cofre.
 *   /scriptevent cerebria:debug      enciende o apaga las lineas [dbg]. Apagado
 *                                    por defecto para no llenar el chat, pero el
 *                                    canal se queda: costo demasiado conseguirlo.
 *   /scriptevent cerebria:chesttest  cofre de prueba con las 9 casillas
 *                                    LLENAS, para separar la rejilla de la
 *                                    fila del inventario.
 *
 * Todo el bloque va en try/catch: un diagnostico no debe poder tumbar la
 * funcionalidad que intenta diagnosticar. El latido, en cambio, se queda al
 * FINAL del archivo a proposito: asi "VIVO" significa que el modulo entero se
 * evaluo, no solo su principio.
 */
try {
  system.afterEvents.scriptEventReceive.subscribe(function (ev) {
    const player = ev.sourceEntity;
    if (!player || player.typeId !== "minecraft:player") return;

    if (ev.id === "cerebria:debug") {
      if (DEPURA.has(player.id)) {
        DEPURA.delete(player.id);
        player.sendMessage("§7Diagnostico APAGADO.");
      } else {
        DEPURA.add(player.id);
        player.sendMessage("§aDiagnostico ENCENDIDO: vas a ver las lineas [dbg] al abrir y al tocar.");
      }
      return;
    }
    if (ev.id === "cerebria:plana") {
      PLANO.add(player.id);
      player.sendMessage("§aMochila en vista de LISTA. Abrila otra vez.");
      return;
    }
    if (ev.id === "cerebria:cofre") {
      PLANO.delete(player.id);
      player.sendMessage("§aMochila en vista de COFRE. Abrila otra vez.");
      return;
    }
    /* Cofre de prueba con las casillas LLENAS.
     *
     * Hace falta porque el fallo real se dio con la mochila VACIA: Chest-UI hace
     * invisible (y por tanto no clicable) todo hueco sin texto, asi que lo unico
     * que se podia tocar era la fila del inventario. Esa fila la dibuja
     * chest_inventory_system.json, que es OTRO archivo que el de la rejilla.
     *
     * Con las 9 casillas llenas se puede tocar una de arriba y otra de abajo y
     * ver cual de las dos mitades responde. */
    if (ev.id === "cerebria:chesttest") {
      system.run(function () {
        const f = new ChestFormData("9").title("Prueba de cofre");
        for (let i = 0; i < 9; i++) {
          f.button(i, `Casilla ${i}`, [], "minecraft:diamond", i + 1, 0, false);
        }
        f.show(player).then(function (res) {
          player.sendMessage(`§8[dbg] §7chesttest: canceled=${res.canceled} motivo=${res.cancelationReason} sel=${res.selection}`);
        }).catch(function (e) {
          player.sendMessage(`§8[dbg] §cchesttest ERROR: ${e}`);
        });
      });
      return;
    }
    if (ev.id !== "cerebria:formtest") return;

    system.run(function () {
      new ActionFormData()
        .title("Prueba de formulario")
        .body("Toca cualquier boton. La respuesta sale en el chat.")
        .button("Boton A")
        .button("Boton B")
        .button("Boton C")
        .show(player)
        .then(function (res) {
          player.sendMessage(`§8[dbg] §7formtest: canceled=${res.canceled} motivo=${res.cancelationReason} sel=${res.selection}`);
        })
        .catch(function (e) {
          player.sendMessage(`§8[dbg] §cformtest ERROR: ${e}`);
        });
    });
  }, { namespaces: ["cerebria"] });
} catch (e) {
  console.warn(`[mochilas] no pude registrar los comandos de diagnostico: ${e}`);
}

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
    try { n = obj.getScore("mochilas") || 0; } catch (e) { n = 0; }
    obj.setScore("mochilas", (n + 1) % 1000000);
  } catch (e) {
    // No debe tumbar nada: es diagnostico, no funcionalidad.
  }
}, 40);

console.log("[mochilas] cargado");
