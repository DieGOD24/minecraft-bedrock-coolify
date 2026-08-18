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

## Waypoints: el tope de 20 era un bug propio

`guardarWaypoints()` guardaba con `JSON.stringify(lista.slice(0, 20))`. Ese recorte
lo puse yo, no Bedrock: **a partir del waypoint 21 se descartaban EN SILENCIO al
guardar**, sin aviso ni error. Ya no hay recorte de cantidad. Lo que si sigue
recortado es el **nombre** a 20 caracteres, que es otra cosa.

### El tope que si existe, y no se puede quitar

`player.locatorBar` tiene un `maxCount` impuesto por Bedrock. No se puede subir.
La mitigacion: la barra se llena **solo con los puntos de la dimension actual,
ordenados del mas cercano**, asi que lo que se corta es siempre lo mas lejano.
El menu muestra `Barra: N/M` para que el numero real este a la vista: la
documentacion no lo publica.

### Un segundo bug, encadenado al primero

`sincronizarBarra()` metia en la barra los waypoints de **todas** las dimensiones.
La doc avisa que los invalidos se limpian al tick siguiente, pero **antes consumen
cupo** del `maxCount` y desplazan a los que si deberian verse. Eso explicaba el
comportamiento raro al cambiar de dimension. Ahora filtra por dimension antes de
tocar la barra.

## Nada de codigos § en los botones

Un boton etiquetado `§7Volver` quedaba **gris sobre boton gris: invisible**.
Bedrock aplica su propio estilo a los botones, asi que el color ahi no es fiable.
Regla: `§` solo en el **cuerpo** de los formularios y en los mensajes de chat.
En los botones se admite unicamente en la **segunda linea** (el detalle bajo el
nombre), donde la primera linea sigue siendo legible.

## Haz de luz de colores

`minecraft:colored_flame_particle` con
`MolangVariableMap.setColorRGB("variable.color", rgb)` — combinacion tomada del
**ejemplo oficial de Microsoft** para `Player.spawnParticle`. Antes era
`minecraft:endrod`, que es blanco fijo y no admite color.

Columna de 90 bloques, una particula cada 3, dos veces por segundo (~30 por punto),
solo dentro de 128 bloques.

**Limitacion**: es una hilera de llamas del color elegido, no la columna
translucida de un beacon de verdad. Sin definir una particula propia en un resource
pack, es lo mas cercano que permite la API.

## La brujula se entrega al reaparecer

La brujula es la **unica** via de entrada al sistema de waypoints: todo cuelga de
`afterEvents.itemUse` con `minecraft:compass`. Al morir sin `keepinventory` se
pierde, y con ella queda inaccesible marcar, renombrar, viajar... justo cuando mas
hacen falta los waypoints para volver a la tumba. Era un agujero de diseño.

`asegurarBrujula()` corre en `playerSpawn`, **antes** del early return de
`initialSpawn`, asi que aplica tambien al entrar: un jugador nuevo sin brujula no
puede usar el sistema en absoluto.

### Tres detalles que no son obvios

**Va con retardo (`system.runTimeout(..., 10)`).** Dar objetos exactamente en el
evento de reaparicion falla a veces porque el jugador todavia no esta cargado del
todo. Es la clase de fallo intermitente que despues cuesta diagnosticar.

**Recorre los slots en vez de usar `container.contains()`.** La documentacion no
aclara si `contains` compara tambien la cantidad, y 36 slots una vez por
reaparicion no cuestan nada. Si ya tiene una brujula no se le da otra: si no, se
acumularian una por muerte.

**`addItem` devuelve lo que no cupo.** Con el inventario lleno, la brujula se
suelta a los pies con `spawnItem()` y se avisa por chat, en vez de desaparecer en
silencio.

Brujula vanilla, sin renombrar: asi cualquier brujula abre el menu y se comporta
como una normal.

## Bug: los items de mochila salian invisibles

Se escribio `"minecraft:icon": { "texture": "..." }`. La referencia oficial del
componente dice de ese campo: **"Deprecated - no longer in use"**. Con
`format_version 1.21.30` el icono no resuelve a nada y el item se dibuja vacio,
tambien en la mano. La forma vigente, la que usan los items vanilla:

```json
"minecraft:icon": { "textures": { "default": "cerebria:mochila_cuero" } }
```

## Interfaz de cofre: se dijo que no se podia, y si

Antes se afirmo que era imposible porque no existe `player.openContainer()` en la
API estable. Eso sigue siendo cierto, pero hay otra via: **reskinear el formulario**.

[Chest-UI](https://github.com/Herobrine643928/Chest-UI) (CC-BY-4.0) sustituye la UI
del ActionForm para que se vea y funcione como un cofre, codificando el tamaño de
la rejilla en el titulo con una cadena magica. Soporta 9, 18, 27, 36, 45 y 54
huecos; los tres niveles encajan exacto.

Su `show()` agrega el inventario del jugador como botones DESPUES de los huecos del
cofre, asi que un clic ahi mete el objeto. Para traducir el boton a una ranura real
hay que reconstruir la misma lista de ranuras no vacias, en el mismo orden: eso hace
`ranurasConItems()`.

**Sigue siendo hacer clic, no arrastrar y soltar.** El arrastre no existe en la API.

## ui/_ui_defs.json: NO fusionarlo (error cometido y corregido)

Al añadir Chest-UI se vio que el y WAILA definen ambos `ui/_ui_defs.json`, se
asumio que se pisaban, y se metio en `install-addons.sh` una funcion que escribia
la **union** de rutas en cada pack. **Estaba mal en las dos puntas** y rompio la
vista de cofre: la mochila abria como lista de texto, mostrando crudo el
`stack#01dur#00` que la UI deberia interpretar como icono y cantidad.

El Bedrock Wiki lo dice claro:

> *"JSON UI files automatically get merged with other packs, so you don't need to
> reference vanilla files nor other third-party JSON UI files. You should only
> reference **new UI files you have added in your pack**."*

O sea:

1. **Bedrock ya fusiona los JSON de UI entre packs.** No habia conflicto.
2. **Cada pack debe listar SOLO archivos propios.** La union metia rutas que no
   existen dentro del pack, y con rutas colgantes Bedrock descarta las
   definiciones: el reskin nunca se registraba.

Como los packs se recopian desde `addons/` en cada arranque, bastó con quitar la
funcion para que los archivos originales volvieran solos.

**Regla**: no tocar `_ui_defs.json` de nadie. Cada pack lista lo suyo.

## Correccion: los imports relativos SI funcionan

Se concluyo que Bedrock no los soportaba, porque al dividir el HUD en dos el pack
dejo de cargar. **Esa conclusion era erronea**: Chest-UI los usa como forma normal
de uso y esta mantenido. La caida de entonces tuvo otra causa.

El HUD sigue en un solo archivo por prudencia, pero no por esa razon.

## La cache del cliente: subir la version o el pack no llega (el error mas caro)

**Regla: si cambia cualquier archivo de un resource pack, hay que subir su version.**

El cliente de Bedrock cachea los resource packs de servidor por **UUID + version**.
Si el contenido cambia y la version no, el cliente se queda con la copia vieja para
siempre. El servidor no tiene forma de avisarle.

Asi se perdio la vista de cofre durante varios despliegues:

| Commit | Que paso | Version del RP |
|---|---|---|
| `a748f82` | RP de mochilas creado: texturas, **sin** Chest-UI | `1.0.0` |
| `617d6e8` | Se anadio Chest-UI (`ui/server_form.json`, …) | `1.0.0`, sin tocar |

Los clientes seguian con el `1.0.0` sin carpeta `ui/`, asi que la mochila salia como
lista de texto con `stack#01dur#00` crudo.

**El sintoma es mudo y enganoso**: en el servidor todo se ve perfecto. Se verifico
contra el respaldo que los 12 archivos de Chest-UI estaban desplegados y eran byte a
byte identicos al upstream, que `_ui_defs.json` no tenia rutas colgantes y que el pack
estaba activo en `world_resource_packs.json`. Todo correcto — y aun asi no funcionaba,
porque el problema estaba al otro lado del cable.

Detalles que confundieron el diagnostico, y que conviene tener presentes:

- **La textura del item si se veia**, porque estaba en el `1.0.0` original. Que una
  parte del pack funcione no prueba que el cliente tenga la version actual.
- **El script si corria**, porque el behavior pack se ejecuta en el servidor y no se
  descarga. Un BP al dia no dice nada sobre el RP del cliente.

### Como esta resuelto

`install-addons.sh` lo hace solo, en `version_por_contenido()`: calcula un hash del
contenido del pack (excluyendo `manifest.json`), lo compara con la marca de
`/data/.pack-versions/<uuid>` y, si cambio, sube el numero de parche. El contador vive
en el volumen, asi que **solo sube**: nunca baja ni se repite aunque el contenido
vuelva a un estado anterior.

Dos cosas que hay que respetar si se toca esa funcion:

- **Devuelve la version por stdout**, asi que todos sus `log` van a stderr. Sin eso, la
  linea de log acaba dentro del valor y se escribe basura en `world_resource_packs.json`.
- **El temporal del manifest se crea fuera del pack.** Con `> "$dest/manifest.json.tmp"`
  el redirect crea el archivo aunque `jq` falle, y entonces se queda dentro del pack, se
  sirve al cliente y entra en el hash, que pasa a cambiar en cada arranque.

Solo se aplica a los packs **propios** y de tipo `resources`. Los de terceros declaran
`dependencies` con version exacta: reescribirsela romperia esa resolucion.
