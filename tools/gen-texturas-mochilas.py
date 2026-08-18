#!/usr/bin/env python3
"""Genera las texturas 16x16 de las mochilas.

Son deliberadamente simples y generadas por codigo, no arte. Cumplen su funcion y
se distinguen entre si de un vistazo. Para reemplazarlas por arte de verdad basta
con sobreescribir los PNG: nada mas depende de como se hicieron.
"""
from PIL import Image, ImageDraw
import pathlib

# (cuerpo, solapa, correas, hebilla)
NIVELES = {
    "cuero":     ((150, 92, 48), (120, 72, 36), (92, 56, 28), (200, 170, 90)),
    "hierro":    ((168, 168, 172), (135, 135, 140), (96, 96, 100), (225, 225, 230)),
    "netherita": ((70, 62, 66), (48, 42, 46), (30, 26, 30), (150, 130, 100)),
}

S = 16
destino = pathlib.Path(__file__).resolve().parent.parent / "addons/cerebria-mochilas/RP/textures/items"
destino.mkdir(parents=True, exist_ok=True)

for nombre, (cuerpo, solapa, correa, hebilla) in NIVELES.items():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([3, 5, 12, 14], fill=cuerpo)          # cuerpo
    d.rectangle([3, 3, 12, 6], fill=solapa)           # solapa
    d.rectangle([5, 1, 6, 4], fill=correa)            # correas
    d.rectangle([9, 1, 10, 4], fill=correa)
    d.rectangle([7, 6, 8, 8], fill=hebilla)           # hebilla
    d.rectangle([3, 9, 12, 10], fill=correa)          # cinta
    d.rectangle([3, 3, 12, 14], outline=(0, 0, 0, 190))
    ruta = destino / f"mochila_{nombre}.png"
    img.save(ruta)
    print(f"  {ruta.name}: {ruta.stat().st_size} bytes")
