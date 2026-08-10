#!/usr/bin/env python
"""Optimize boot memory-wall source art into web-ready WebP tiles.

Reads a fixed, ordered list of source PNGs (kept OUTSIDE the repo, read-only),
downscales each to max-width 960 with LANCZOS, strips metadata, flattens onto
the app's near-black ground (--void #05070b) and writes lossy WebP (quality 70)
to public/boot/kira-01.webp … kira-08.webp.

The output order is stable and IS the contract: it maps 1:1 to
BOOT_COLLAGE_ART in src/ui/BootCollage.tsx. Re-run whenever the art
changes; edit SOURCES (or pass paths as argv) to point at new source files.

Run with the project interpreter, e.g.:
    E:/Miniconda/envs/flux_env/python.exe scripts/optimize-boot-art.py
"""

from __future__ import annotations

import sys
from pathlib import Path

MAX_WIDTH = 960
WEBP_QUALITY = 70
VOID_RGB = (5, 7, 11)  # --void, so any transparent art flattens to the app ground

# Stable source order — output index N comes from SOURCES[N-1].
SOURCES = [
    r"C:/Users/tavo_/Downloads/Generated image 6.png",
    r"C:/Users/tavo_/Downloads/Generated image 1.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_0685d7d083266450016a3e09940594819985e84b69b00ad42b.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_0685d7d083266450016a3e0892ea20819982e3fffb0868b348.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_0f023f2186e5dd74016a3e06458e90819a8fd19ee072226119.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_0f023f2186e5dd74016a3e06fb96f0819abcd4884a2dff42a5.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_0875cb642634c1f1016a3cce0f73b4819886a3bf25c27f8b31.png",
    r"C:/Users/tavo_/Downloads/Diseño_2D/Codex IA/ig_059432c4ac233196016a3cb494db34819bbed836a3e6337f37.png",
]


def _human(nbytes: int) -> str:
    return f"{nbytes / 1024:.0f} KB" if nbytes < 1024 * 1024 else f"{nbytes / 1024 / 1024:.2f} MB"


def optimize(sources: list[str], out_dir: Path) -> int:
    try:
        from PIL import Image
    except ImportError:
        print("ERROR: Pillow (PIL) is not available in this interpreter.", file=sys.stderr)
        print("Install it in the project env, then re-run. Not auto-installing.", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"{'file':<16} {'source':>12} {'webp':>12} {'saved':>8}")
    print("-" * 52)

    failures = 0
    for index, src_path in enumerate(sources, start=1):
        src = Path(src_path)
        dst = out_dir / f"kira-{index:02d}.webp"
        if not src.is_file():
            print(f"{dst.name:<16} {'MISSING':>12} — source not found: {src}")
            failures += 1
            continue

        before = src.stat().st_size
        with Image.open(src) as img:
            img = img.convert("RGBA")
            if img.width > MAX_WIDTH:
                height = round(img.height * MAX_WIDTH / img.width)
                img = img.resize((MAX_WIDTH, height), Image.Resampling.LANCZOS)
            ground = Image.new("RGB", img.size, VOID_RGB)
            ground.paste(img, mask=img.getchannel("A"))
            # New image carries no source metadata (exif/icc); nothing extra passed to save.
            ground.save(dst, format="WEBP", quality=WEBP_QUALITY, method=6)

        after = dst.stat().st_size
        saved = 100 * (before - after) / before if before else 0
        print(f"{dst.name:<16} {_human(before):>12} {_human(after):>12} {saved:>6.0f}%")

    print("-" * 52)
    print(f"wrote {len(sources) - failures}/{len(sources)} tiles to {out_dir}")
    return 1 if failures else 0


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "public" / "boot"
    sources = sys.argv[1:] if len(sys.argv) > 1 else SOURCES
    return optimize(sources, out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
