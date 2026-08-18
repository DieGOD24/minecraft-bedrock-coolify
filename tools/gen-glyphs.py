#!/usr/bin/env python3
"""Genera RP/font/glyph_25.png para el mapa de cerebria-hud.

Por que hace falta: el resource pack vanilla de Bedrock NO trae glyph_25.png
(sus paginas arrancan en glyph_2E). Esa pagina cubre U+2500-U+25FF, donde viven
los caracteres de bloque y las figuras que usa el mapa. Sin ella, `█` y compania
se renderizan como cajas vacias.

Formato de pagina de fuente en Bedrock: PNG de 256x256 con una rejilla de 16x16
celdas de 16 px. La celda de un caracter se ubica por el byte bajo de su
codepoint: fila = byte >> 4, columna = byte & 15.

Los glifos se dibujan en BLANCO: Minecraft multiplica la textura por el color del
texto, asi que los codigos § los tiñen.

Todos ocupan el ANCHO COMPLETO de la celda a proposito. Bedrock deduce el ancho
del glifo buscando el pixel no transparente mas a la derecha; si los marcadores
fueran mas angostos que `█`, la rejilla del mapa se desalinearia.
"""
from PIL import Image, ImageDraw
import pathlib

CELDA = 16
PAGINA = CELDA * 16          # 256x256
BLANCO = (255, 255, 255, 255)

img = Image.new("RGBA", (PAGINA, PAGINA), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

def celda(codepoint):
    """Esquina superior izquierda de la celda de un codepoint de la pagina 25xx."""
    assert 0x2500 <= codepoint <= 0x25FF, f"U+{codepoint:04X} no pertenece a glyph_25"
    bajo = codepoint & 0xFF
    return (bajo & 15) * CELDA, (bajo >> 4) * CELDA

def bloque(cp):
    """Bloque lleno: la baldosa del mapa. Ocupa la celda entera."""
    x, y = celda(cp)
    d.rectangle([x, y, x + CELDA - 1, y + CELDA - 1], fill=BLANCO)

def triangulo(cp):
    x, y = celda(cp)
    d.polygon([(x, y + CELDA - 1), (x + CELDA - 1, y + CELDA - 1), (x + CELDA // 2, y)], fill=BLANCO)

def circulo(cp):
    x, y = celda(cp)
    d.ellipse([x, y, x + CELDA - 1, y + CELDA - 1], fill=BLANCO)

def cruz(cp):
    x, y = celda(cp)
    for grosor in range(3):
        d.line([(x + grosor, y), (x + CELDA - 1, y + CELDA - 1 - grosor)], fill=BLANCO)
        d.line([(x, y + grosor), (x + CELDA - 1 - grosor, y + CELDA - 1)], fill=BLANCO)
        d.line([(x + CELDA - 1 - grosor, y), (x, y + CELDA - 1 - grosor)], fill=BLANCO)
        d.line([(x + CELDA - 1, y + grosor), (x + grosor, y + CELDA - 1)], fill=BLANCO)

def rombo(cp):
    x, y = celda(cp)
    m = CELDA // 2
    d.polygon([(x + m, y), (x + CELDA - 1, y + m), (x + m, y + CELDA - 1), (x, y + m)], fill=BLANCO)

GLIFOS = [
    (0x2588, "█ bloque lleno - baldosa del mapa", bloque),
    (0x25B2, "▲ triangulo    - tu posicion y rumbo", triangulo),
    (0x25CF, "● circulo      - otros jugadores", circulo),
    (0x2573, "╳ cruz         - tu tumba", cruz),
    (0x25C6, "◆ rombo        - waypoints", rombo),
]

for cp, desc, dibujar in GLIFOS:
    dibujar(cp)
    cx, cy = celda(cp)
    print(f"  U+{cp:04X}  celda fila {cy//CELDA:2} col {cx//CELDA:2}  {desc}")

destino = pathlib.Path(__file__).resolve().parent.parent / "addons/cerebria-hud/RP/font/glyph_25.png"
destino.parent.mkdir(parents=True, exist_ok=True)
img.save(destino)
print(f"\nescrito: {destino}  ({destino.stat().st_size} bytes)")
