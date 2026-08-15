#!/usr/bin/env python
"""Optimize boot memory-wall source art into web-ready WebP tiles.

Reads an ordered list of source PNGs (kept OUTSIDE the repo, read-only) passed
as argv, downscales each to max-width 960 with LANCZOS, strips metadata,
flattens onto the app's near-black ground (--void #05070b) and writes lossy
WebP (quality 70) to public/boot/kira-01.webp … kira-08.webp.

The output order is stable and IS the contract: argv order maps 1:1 to
BOOT_COLLAGE_ART in src/ui/BootCollage.tsx, so pass exactly 8 source paths in
the order they should appear.

Run with the project interpreter, e.g.:
    python scripts/optimize-boot-art.py <src1.png> <src2.png> ... <src8.png>
"""

from __future__ import annotations

import sys
from pathlib import Path

MAX_WIDTH = 960
WEBP_QUALITY = 70
VOID_RGB = (5, 7, 11)  # --void, so any transparent art flattens to the app ground


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
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        print("ERROR: no source paths given.", file=sys.stderr)
        print(
            "Usage: python scripts/optimize-boot-art.py <src1.png> ... <src8.png>",
            file=sys.stderr,
        )
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "public" / "boot"
    sources = sys.argv[1:]
    return optimize(sources, out_dir)


if __name__ == "__main__":
    raise SystemExit(main())
