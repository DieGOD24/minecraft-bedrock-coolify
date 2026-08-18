#!/usr/bin/env python3
"""Empaqueta el script de mochilas en un unico archivo.

POR QUE HACE FALTA
Con Chest-UI importado como `./extensions/forms.js`, el modulo no llegaba a
ejecutarse: la sonda de scoreboard nunca aparecio. El pack de mochilas quedaba sin
el manejador de itemUse y la mochila no abria, aunque los items SI se vieran
(los define el modulo `data`, que es independiente del de script).

En vez de seguir adivinando, se elimina la variable: se concatena todo en
`BP/scripts/main.js`, en orden de dependencia, quitando los import/export locales.
Los imports de `@minecraft/*` se hoistean y deduplican arriba.

Las fuentes se conservan en `src/` y `vendor/chest-ui/` para poder
actualizar Chest-UI y por la atribucion que exige CC-BY-4.0.
"""
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PACK = RAIZ / "addons/cerebria-mochilas"

# Orden de dependencia: typeIds y constants no dependen de nadie; forms de ambos;
# mochilas de forms.
PARTES = [
    PACK / "vendor/chest-ui/typeIds.js",
    PACK / "vendor/chest-ui/constants.js",
    PACK / "vendor/chest-ui/forms.js",
    PACK / "src/mochilas.js",
]
SALIDA = PACK / "BP/scripts/main.js"

RE_IMPORT_LOCAL = re.compile(r"^\s*import\s+.*?from\s+['\"]\./.*?['\"];?\s*$", re.M)
RE_IMPORT_MC = re.compile(r"^\s*import\s+\{([^}]*)\}\s+from\s+['\"](@minecraft/[^'\"]+)['\"];?\s*$", re.M)
RE_EXPORT = re.compile(r"^(\s*)export\s+(const|let|var|function|class)\b", re.M)

modulos = {}   # modulo -> set de nombres importados
cuerpos = []

for parte in PARTES:
    texto = parte.read_text(encoding="utf-8")

    # Recolecta los imports de @minecraft/* y los quita del cuerpo
    for m in RE_IMPORT_MC.finditer(texto):
        nombres = [n.strip() for n in m.group(1).split(",") if n.strip()]
        modulos.setdefault(m.group(2), set()).update(nombres)
    texto = RE_IMPORT_MC.sub("", texto)

    # Los imports relativos desaparecen: todo queda en el mismo ambito
    texto = RE_IMPORT_LOCAL.sub("", texto)

    # `export const X` -> `const X`
    texto = RE_EXPORT.sub(r"\1\2", texto)

    cuerpos.append(f"/* ===== {parte.name} ===== */\n{texto.strip()}\n")

cabecera = [
    "/*",
    " * ARCHIVO GENERADO por tools/bundle-mochilas.py. No editar a mano:",
    " * los cambios van en src/mochilas.js y se regenera.",
    " *",
    " * Se empaqueta en un solo archivo porque con imports relativos el modulo no",
    " * llegaba a ejecutarse y la mochila no abria.",
    " *",
    " * Incluye Chest-UI de Herobrine643928 (CC BY 4.0). Ver CHEST-UI-CREDITOS.md.",
    " */",
    "",
]
for modulo in sorted(modulos):
    nombres = ", ".join(sorted(modulos[modulo]))
    cabecera.append(f'import {{ {nombres} }} from "{modulo}";')
cabecera.append("")

SALIDA.write_text("\n".join(cabecera) + "\n" + "\n".join(cuerpos), encoding="utf-8", newline="\n")

texto = SALIDA.read_text(encoding="utf-8")
print(f"escrito: {SALIDA.relative_to(RAIZ)}")
print(f"  {len(texto)//1024} KB, {len(texto.splitlines())} lineas")
print(f"  imports: {len(modulos)} modulo(s) de @minecraft/*")
for modulo in sorted(modulos):
    print(f"     {modulo}: {', '.join(sorted(modulos[modulo]))}")
sobrantes = RE_IMPORT_LOCAL.findall(texto) + RE_EXPORT.findall(texto)
print(f"  imports relativos o export sobrantes: {len(sobrantes)} (debe ser 0)")
