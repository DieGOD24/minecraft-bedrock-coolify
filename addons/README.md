# Addons

Cada `.mcaddon` de esta carpeta se instala y **activa** en el mundo al arrancar,
vía `backup/install-addons.sh`.

## Por qué la instalación no la hace la imagen

`MC_PACK` de itzg no alcanza para este caso:

1. Solo reconoce los layouts `behavior_packs/`+`resource_packs/`, `data/`+`resources/`
   o `addon/<sub>/`. Este addon usa `BP/`+`RP/`, que no matchea ninguno.
2. Aunque matcheara, solo escribe `world_behavior_packs.json` en un directorio
   temporal, y ese archivo únicamente llega al mundo si el pack trae su propio
   `level.dat`. Un addon normal no lo trae, así que **el pack queda instalado pero
   el mundo lo ignora**.

El sidecar sí tiene el volumen montado, así que instala los packs en
`/data/{behavior_packs,resource_packs}/<uuid>/` y escribe la activación en
`/data/worlds/<LEVEL_NAME>/world_*_packs.json`.

**La activación surte efecto en el arranque siguiente**, porque BDS lee esos
archivos al cargar el mundo y el sidecar arranca después que el servidor.

## graves.mcaddon

[Hatchibombotar/graves-addon](https://github.com/Hatchibombotar/graves-addon) v2.1.42, **licencia MIT**
(ver `graves-LICENCE.md`), redistribuido aquí para que el despliegue sea reproducible.

Se eligió sobre las alternativas de CurseForge/MCPEDL porque:

- Sus módulos son de tipo `data`/`resources`, **no `script`** → no necesita Beta APIs
  ni experimentos, que marcarían el mundo de forma permanente e irreversible.
- `min_engine_version` 1.20.60, por debajo del 1.26.44 del servidor.
- Licencia MIT y descarga directa desde GitHub Releases, o sea versionable y pinneado.

| pack | uuid | versión |
|---|---|---|
| Graves BP | `f5741565-6be8-4ad5-879a-130c644ff694` | 2.1.4 |
| Graves RP | `6181e449-d2b7-4482-8740-544e645bdd5f` | 2.1.4 |

## waila.mcaddon

[r4isen1920/WAILA](https://github.com/r4isen1920/WAILA) v5.1.1, **licencia MIT**
(ver `waila-LICENSE.md`). Muestra en el HUD el nombre del bloque o mob al que apuntás.

**Se eligió el original en vez del fork "HoverInfo"**, que es este mismo addon
repackageado:

| | HoverInfo | WAILA original |
|---|---|---|
| licencia | **ninguna** — no se puede redistribuir | MIT |
| idiomas | 1, con los textos en chino | 28, incluye `es_ES` y `es_MX` |
| tamaño | 7,9 MB | 195 KB |
| versión | v2.1.0 | v5.1.1 (activo) |

Los 7,9 MB los descarga **cada jugador al entrar**, así que la diferencia se nota.
La falta de licencia en HoverInfo era además un bloqueo real: este repo es público.

Usa `@minecraft/server@2.4.0`, versión **estable** de la Script API — no la `beta`,
así que **no exige experimentos**. `min_engine_version` 1.21.100, por debajo del
1.26.44 del servidor.

### Cuidado al agregar minimapas u otros packs de HUD

WAILA sobrescribe `ui/hud_screen.json`. Bedrock **no fusiona** los JSON de UI: si
otro pack define el mismo archivo, gana el de mayor prioridad y el otro deja de
verse por completo. Cualquier minimapa de Bedrock toca ese mismo archivo, así que
convivirían solo fusionando ambos a mano en un pack combinado.

## vanilla-pvp-16x.mcpack

[spzxn/Vanilla-PvP-16x](https://github.com/spzxn/Vanilla-PvP-16x) V0.1-beta, **licencia MIT**.
Texturas 16x que mantienen el aspecto clasico, optimizadas para rendimiento.

Elegido por el peso: **1,7 MB**. Como el servidor corre con
`texturepack-required=true`, cada jugador *debe* aceptar la descarga para entrar,
y con gente en datos moviles un pack pesado deja gente afuera. Para comparar, la
alternativa jg-rtx va de 10,6 MB (32x) a **527 MB** (256x).

Solo modulo `resources`, sin scripts ni APIs -> no toca experimentos. No define
`ui/hud_screen.json`, asi que convive con WAILA.

### PureBDcraft: no es posible

Para Bedrock existe **unicamente en el Minecraft Marketplace**, y el contenido del
Marketplace esta **cifrado y atado a la cuenta compradora**: un servidor dedicado
no puede servirlo aunque se haya pagado. Ademas los terminos de BDcraft prohiben
hospedarlo o redistribuirlo. No hay workaround.

## cerebria-hud/ (pack propio)

Behavior pack escrito para este servidor. Vive como **directorio**, no como
`.mcaddon`: `install-addons.sh` acepta ambos, asi el codigo queda legible y
revisable en git sin paso de empaquetado.

Hace dos cosas:

1. **Barra de accion permanente** con dia, hora del juego y hora real:
   `☀ Dia 47 | 14:35 Tarde | 22:10 real`
2. **Aviso de tumba**: al morir guarda la posicion, la manda por chat, y mientras
   no llegues la muestra en la barra de accion con la **distancia en vivo**. Se
   borra sola a ~4 bloques. Una **brujula** vuelve a mostrar el dato.

### Decisiones que no son obvias

**Por que la barra de accion y no un HUD propio.** WAILA ocupa `ui/hud_screen.json`
y Bedrock no fusiona los JSON de UI: cualquier pack que tocara ese archivo apagaria
WAILA por completo. La barra de accion no la usa nadie.

**Por que una brujula y no un comando de chat.** `world.beforeEvents.chatSend` es
**experimental**. Un `!tumba` obligaria a activar Beta APIs, que marca el mundo de
forma permanente e irreversible. `world.afterEvents.itemUse` es estable.

**Por que no se reemplazo el addon Graves.** Cambiarlo dejaria huerfanas las
entidades `hatchi:grave` que ya existen en el mundo, y quien tenga objetos dentro
los perderia. Este pack lo complementa.

**La hora real usa un offset fijo UTC-5** en vez del TZ del contenedor, porque no
esta garantizado que el motor de scripts lo respete. Colombia no tiene horario de
verano, asi que es correcto todo el año. Si `Date` no existiera en el motor, el
codigo omite la hora real y sigue mostrando el resto.

Todo con `@minecraft/server@2.4.0`, la version **estable** que ya usa WAILA en este
servidor. Sin experimentos.

## Nota: por que NO se usa la variable OPS

`OPS` resuelve gamertags a XUID contra `mcprofile.io`, y esa API devuelve
**HTTP 523**. Ante el fallo, `resolveXuid()` de la imagen hace
`echo "${xuid:-$value}"`: escribe el **gamertag crudo** en el campo `xuid`, sin
error. Eso genero un `permissions.json` invalido que dejo a todos sin comandos.

En su lugar: `AUTO_OP_PLAYERS` en el sidecar manda `op <nombre>` por la consola SSH
apenas ve al jugador conectado, y **BDS resuelve el XUID el mismo**. Ademas
`fix-permissions.sh` limpia en cada arranque las entradas con `xuid` invalido.

## Mapa: por que el addon NO dibuja uno

Bedrock no tiene puente script->UI para dibujar: un behavior pack solo puede
empujar **texto**. Se intento una cuadricula de caracteres coloreados y quedo mal:
los codigos `§` dan **28 colores** como maximo contra los **248** de un mapa real,
y las filas de texto quedan separadas entre si.

Lo que si se ve bien es el mapa de Minecraft, porque *es* un mapa de Minecraft.
Asi que la brujula abre un menu con la opcion **Conseguir mapa**, que entrega un
mapa localizador vacio.

El valor auxiliar del item no esta documentado de forma fiable, asi que
`darMapa()` **prueba variantes y usa la primera que el servidor acepta**
(`runCommand` lanza `CommandError` si falla), y registra cual funciono.

### Y tampoco hay minimapa permanente

Para una cuadricula siempre visible existen cuatro canales y ninguno queda libre:

| Canal | Estado |
|---|---|
| `ui/hud_screen.json` | Lo ocupa WAILA. Bedrock **no fusiona** los JSON de UI: gana uno, el otro desaparece entero |
| Titulo (si es multilinea) | Lo **secuestra WAILA**: su script manda el texto con prefijo `_r4ui:` |
| Barra de accion | Libre, pero de **una sola linea** |
| Scoreboard lateral | Multilinea, pero el slot es **global del mundo**, no por jugador |

### Sin fuente propia

Hubo una version con `RP/font/glyph_25.png` generada a medida, porque el resource
pack vanilla no trae esa pagina y `█ ▲ ● ╳ ◆` no existen en la fuente de Bedrock.
Al quitar el mapa de texto dejo de hacer falta: se borro. El script usa solo ASCII
y `§`, asi que no depende de ninguna fuente.

### No dividir el script en varios archivos

Se intento separarlo en `main.js` + `mapa.js` con `import ... from "./mapa.js"` y
el pack **dejo de cargar entero**: en Bedrock, si un modulo falla al importar no
corre NADA, asi que hasta el reloj de dia/hora desaparecio. WAILA, el unico addon
con scripts que funciona aqui, es un unico bundle de 239 KB sin imports relativos.

## Waypoints: nativos, no dibujados a mano

Antes se pintaban como texto en la barra de accion, ocupandola todo el tiempo. Eso
era una **reimplementacion peor de algo que el juego ya resuelve**: `player.locatorBar`
es API estable y pinta el marcador en el HUD con color e icono propios.

| API usada | Para que |
|---|---|
| `player.locatorBar` | marcadores nativos en el HUD (`addWaypoint`, `removeAllWaypoints`, `count`, `maxCount`) |
| `new LocationWaypoint(dimLoc, selector, color)` | punto fijo con color RGB e icono |
| `WaypointTexture` | `Square` para waypoints, `SmallStar` para la tumba |
| `player.spawnParticle(...)` | el haz de luz, **privado del jugador** |

### Dos trampas de la API

**La barra localizadora NO persiste entre sesiones.** La doc avisa que los
waypoints invalidos se limpian al tick siguiente. Por eso `sincronizarBarra()` se
llama en `playerSpawn`, en `playerDimensionChange` y en cada cambio. Si los
marcadores desaparecen al reconectar, ese es el primer sitio a mirar.

**`maxCount` es un tope real**: `addWaypoint` lanza error al pasarse, asi que se
comprueba antes y se avisa por chat en vez de reventar.

Se borra y se repuebla la barra entera en cada sincronizacion porque
`removeAllWaypoints` solo alcanza a los waypoints de **este** pack ("You can only
modify, remove, or query waypoints that were added by this pack"), asi que es
seguro e idempotente.

### El haz de luz

`player.spawnParticle` esta documentado como *"Only visible to the target player"*,
o sea que cada jugador ve solo sus propios puntos y nadie ensucia la pantalla ajena.

- `minecraft:endrod` para waypoints, `minecraft:basic_flame_particle` para la tumba.
- Columna de 40 bloques, una particula cada 2, dos veces por segundo.
- **Solo a menos de 96 bloques**: mas lejos el cliente no lo renderiza igual, asi
  que emitir seria gasto puro. Peor caso medido: 240 particulas/s por jugador.

### Tocar un waypoint ya no lo borra

Abre un submenu: ir aqui (con confirmacion), renombrar, mover aqui
(`setDimensionLocation`), cambiar color y borrar (tambien con confirmacion).

El teletransporte usa `player.teleport()` con respaldo por `tp` en comando. La
confirmacion esta a proposito: un toque accidental en survival puede costar caro.
