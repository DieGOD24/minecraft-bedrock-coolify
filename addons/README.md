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
