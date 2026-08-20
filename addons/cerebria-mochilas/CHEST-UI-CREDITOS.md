# Chest-UI

La interfaz de cofre de las mochilas usa **[Chest-UI](https://github.com/Herobrine643928/Chest-UI)**
de **Herobrine643928**, bajo licencia **CC BY 4.0** (ver `CHEST-UI-LICENSE.md`).

Archivos vendorizados sin modificar salvo donde se indica:

- `BP/scripts/extensions/forms.js`, `constants.js`, `typeIds.js`
- `RP/ui/server_form.json`, `chest_server_form.json`, `chest_inventory_system.json`,
  `furnace_server_form.json`, `_global_variables.json`
- `RP/textures/ui/*`

**`BP/scripts/extensions/constants.js` SE MODIFICA**: se registran las tres
mochilas en `custom_content` para que se dibujen dentro de la rejilla.

**`vendor/chest-ui/constants.js` SE MODIFICA otra vez**: `inventory_enabled` pasa a
`false`, junto con `$show_inventory: false` en `RP/ui/_global_variables.json`. Van
las dos: una oculta los paneles en la UI, la otra evita que `show()` anada esos
botones desde JS.

**Por que**, medido en el juego y no supuesto:

| Donde se toca | Respuesta |
|---|---|
| rejilla del cofre, casilla llena | `canceled=false sel=8` — indice correcto |
| fila de inventario, objeto propio | `canceled=false sel=1` — indice de la rejilla |
| fila de inventario, mochila vacia | `canceled=true UserClosed sel=undefined` |

Y la fila **si muestra los objetos correctos**. Es decir: en la fila de inventario
de Chest-UI, lo que se dibuja y lo que se pulsa no coinciden. Con la mochila vacia
sus botones no tienen texto, Chest-UI los hace invisibles, el toque cae al fondo y
Bedrock cierra la pantalla.

No es cosa nuestra: los tres JSON de UI son **byte a byte identicos al upstream** y
estamos en su ultimo commit (`115d95c8`, "26.40 Update", 14 ago 2026). Tampoco hay
arreglo rio arriba.

El inventario del jugador se dibuja ahora dentro de la propia rejilla, que es la
unica parte cuyo clic esta demostrado que funciona. Ver `abrirMochila()` en
`src/mochilas.js`. **Si algun dia se actualiza Chest-UI, hay que volver a poner las
dos banderas en false o la mochila deja de guardar.**

`RP/ui/_ui_defs.json` va **sin modificar**: lista solo los archivos de Chest-UI.
Hubo un intento de fusionarlo con el de WAILA que rompio la vista de cofre. Bedrock
ya fusiona los JSON de UI entre packs, y cada pack debe listar solo lo suyo.

## Por que hacia falta

Bedrock no permite abrir un contenedor real desde script: no existe
`player.openContainer()` en la API estable. Chest-UI resuelve eso reskineando el
ActionForm para que se vea y funcione como un cofre, codificando el tamaño de la
rejilla en el titulo del formulario.

**Sigue siendo hacer clic, no arrastrar y soltar.**
