#!/usr/bin/env python3
"""Generate Tauri app icons from a small procedural source.

The icon is intentionally simple: a graphite macOS tile, a paper note, and a
spruce V mark. This avoids adding design-tool exports or binary-only sources.
"""

from __future__ import annotations

import math
import os
import struct
import subprocess
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "src-tauri" / "icons"
TMP_DIR = ROOT / ".tmp-iconset"
SCALE = 4


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
        alpha,
    )


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(round(a[i] * (1 - t) + b[i] * t) for i in range(4))  # type: ignore[return-value]


def blend(dst: list[int], color: tuple[int, int, int, int]) -> None:
    sr, sg, sb, sa = color
    if sa <= 0:
        return
    da = dst[3]
    out_a = sa + da * (255 - sa) // 255
    if out_a == 0:
        dst[:] = [0, 0, 0, 0]
        return
    dst[0] = (sr * sa + dst[0] * da * (255 - sa) // 255) // out_a
    dst[1] = (sg * sa + dst[1] * da * (255 - sa) // 255) // out_a
    dst[2] = (sb * sa + dst[2] * da * (255 - sa) // 255) // out_a
    dst[3] = out_a


def rounded_rect_mask(px: float, py: float, x: float, y: float, w: float, h: float, r: float) -> bool:
    cx = min(max(px, x + r), x + w - r)
    cy = min(max(py, y + r), y + h - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r**2


def in_polygon(px: float, py: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(points) - 1
    for i, point in enumerate(points):
        xi, yi = point
        xj, yj = points[j]
        intersects = (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi
        if intersects:
            inside = not inside
        j = i
    return inside


def line_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    length = vx * vx + vy * vy
    t = 0 if length == 0 else max(0, min(1, (wx * vx + wy * vy) / length))
    cx, cy = ax + t * vx, ay + t * vy
    return math.hypot(px - cx, py - cy)


class Canvas:
    def __init__(self, size: int) -> None:
        self.size = size
        self.pixels = [[[0, 0, 0, 0] for _ in range(size)] for _ in range(size)]

    def rect(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        r: float,
        top: tuple[int, int, int, int],
        bottom: tuple[int, int, int, int] | None = None,
    ) -> None:
        bottom = bottom or top
        for yy in range(max(0, math.floor(y)), min(self.size, math.ceil(y + h))):
            t = (yy - y) / max(h, 1)
            color = mix(top, bottom, t)
            for xx in range(max(0, math.floor(x)), min(self.size, math.ceil(x + w))):
                if rounded_rect_mask(xx + 0.5, yy + 0.5, x, y, w, h, r):
                    blend(self.pixels[yy][xx], color)

    def polygon(self, points: list[tuple[float, float]], color: tuple[int, int, int, int]) -> None:
        min_x = max(0, math.floor(min(p[0] for p in points)))
        max_x = min(self.size, math.ceil(max(p[0] for p in points)))
        min_y = max(0, math.floor(min(p[1] for p in points)))
        max_y = min(self.size, math.ceil(max(p[1] for p in points)))
        for yy in range(min_y, max_y):
            for xx in range(min_x, max_x):
                if in_polygon(xx + 0.5, yy + 0.5, points):
                    blend(self.pixels[yy][xx], color)

    def line(self, a: tuple[float, float], b: tuple[float, float], width: float, color: tuple[int, int, int, int]) -> None:
        radius = width / 2
        min_x = max(0, math.floor(min(a[0], b[0]) - radius))
        max_x = min(self.size, math.ceil(max(a[0], b[0]) + radius))
        min_y = max(0, math.floor(min(a[1], b[1]) - radius))
        max_y = min(self.size, math.ceil(max(a[1], b[1]) + radius))
        for yy in range(min_y, max_y):
            for xx in range(min_x, max_x):
                dist = line_distance(xx + 0.5, yy + 0.5, a[0], a[1], b[0], b[1])
                if dist <= radius:
                    blend(self.pixels[yy][xx], color)

    def downsample(self, target_size: int) -> list[list[list[int]]]:
        factor = self.size // target_size
        output: list[list[list[int]]] = []
        for y in range(target_size):
            row: list[list[int]] = []
            for x in range(target_size):
                acc = [0, 0, 0, 0]
                for yy in range(y * factor, (y + 1) * factor):
                    for xx in range(x * factor, (x + 1) * factor):
                        px = self.pixels[yy][xx]
                        for i in range(4):
                            acc[i] += px[i]
                div = factor * factor
                row.append([round(v / div) for v in acc])
            output.append(row)
        return output


def write_png(path: Path, pixels: list[list[list[int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend([r, g, b, a])

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def render_base() -> Canvas:
    size = 512 * SCALE
    c = Canvas(size)
    s = SCALE

    # App tile and soft depth.
    c.rect(34 * s, 34 * s, 444 * s, 444 * s, 112 * s, rgba("#101513"), rgba("#202923"))
    c.rect(52 * s, 380 * s, 408 * s, 62 * s, 34 * s, rgba("#000000", 34))

    # Back page, then main page.
    c.rect(156 * s, 88 * s, 236 * s, 334 * s, 34 * s, rgba("#dce7df", 88))
    c.rect(116 * s, 74 * s, 282 * s, 356 * s, 36 * s, rgba("#fbfbf7"), rgba("#eef3ee"))

    # Folded page corner.
    c.polygon([(336 * s, 74 * s), (398 * s, 136 * s), (336 * s, 136 * s)], rgba("#dbe6de"))
    c.line((340 * s, 136 * s), (394 * s, 136 * s), 3 * s, rgba("#cad7cf", 190))

    # Note spine.
    c.rect(116 * s, 74 * s, 54 * s, 356 * s, 36 * s, rgba("#177155"), rgba("#0f6049"))
    c.rect(148 * s, 92 * s, 22 * s, 320 * s, 12 * s, rgba("#125640", 110))

    # Paper rules.
    for y in (174, 205, 236):
        c.rect(206 * s, y * s, 122 * s, 6 * s, 3 * s, rgba("#cbd6ce"))
    c.rect(206 * s, 267 * s, 88 * s, 6 * s, 3 * s, rgba("#d7ded8"))

    # Spruce V mark with rounded strokes.
    c.line((204 * s, 274 * s), (256 * s, 360 * s), 30 * s, rgba("#167055"))
    c.line((256 * s, 360 * s), (322 * s, 274 * s), 30 * s, rgba("#167055"))
    c.line((204 * s, 274 * s), (256 * s, 360 * s), 14 * s, rgba("#74c7a8", 110))
    return c


def make_iconset(base: Canvas) -> None:
    _ = base
    subprocess.run(
        ["sips", "-s", "format", "icns", str(ICON_DIR / "icon.png"), "--out", str(ICON_DIR / "icon.icns")],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def write_ico(path: Path, pngs: list[tuple[int, bytes]]) -> None:
    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + len(pngs) * 16
    entries = bytearray()
    payload = bytearray()
    for size, data in pngs:
        entries.extend(
            struct.pack(
                "<BBBBHHII",
                0 if size >= 256 else size,
                0 if size >= 256 else size,
                0,
                0,
                1,
                32,
                len(data),
                offset,
            )
        )
        payload.extend(data)
        offset += len(data)
    path.write_bytes(header + entries + payload)


def main() -> None:
    ICON_DIR.mkdir(exist_ok=True)
    base = render_base()

    targets = {
        "icon.png": 512,
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in targets.items():
        write_png(ICON_DIR / name, base.downsample(size))

    ico_sizes = [16, 32, 48, 256]
    ico_payloads: list[tuple[int, bytes]] = []
    for size in ico_sizes:
        tmp = TMP_DIR / f"ico-{size}.png"
        TMP_DIR.mkdir(exist_ok=True)
        write_png(tmp, base.downsample(size))
        ico_payloads.append((size, tmp.read_bytes()))
    write_ico(ICON_DIR / "icon.ico", ico_payloads)
    make_iconset(base)

    # Keep the repo tidy after generating binary assets.
    if TMP_DIR.exists():
        for root, dirs, files in os.walk(TMP_DIR, topdown=False):
            for file in files:
                Path(root, file).unlink()
            for directory in dirs:
                Path(root, directory).rmdir()
        TMP_DIR.rmdir()


if __name__ == "__main__":
    main()
