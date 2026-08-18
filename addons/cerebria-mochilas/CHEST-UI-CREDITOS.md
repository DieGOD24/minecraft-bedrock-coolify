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

**`RP/ui/_ui_defs.json` SE MODIFICA en tiempo de instalacion**: `install-addons.sh`
escribe ahi la union de los `ui_defs` de todos los resource packs. Sin eso, WAILA y
Chest-UI se pisan mutuamente ese archivo y uno de los dos deja de funcionar.

## Por que hacia falta

Bedrock no permite abrir un contenedor real desde script: no existe
`player.openContainer()` en la API estable. Chest-UI resuelve eso reskineando el
ActionForm para que se vea y funcione como un cofre, codificando el tamaño de la
rejilla en el titulo del formulario.

**Sigue siendo hacer clic, no arrastrar y soltar.**
