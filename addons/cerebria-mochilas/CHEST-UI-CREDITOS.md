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

`RP/ui/_ui_defs.json` va **sin modificar**: lista solo los archivos de Chest-UI.
Hubo un intento de fusionarlo con el de WAILA que rompio la vista de cofre. Bedrock
ya fusiona los JSON de UI entre packs, y cada pack debe listar solo lo suyo.

## Por que hacia falta

Bedrock no permite abrir un contenedor real desde script: no existe
`player.openContainer()` en la API estable. Chest-UI resuelve eso reskineando el
ActionForm para que se vea y funcione como un cofre, codificando el tamaño de la
rejilla en el titulo del formulario.

**Sigue siendo hacer clic, no arrastrar y soltar.**
