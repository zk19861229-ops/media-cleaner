#!/usr/bin/env python3
"""Create ONLY synthetic media in a new directory. Uses Python standard library.
ffmpeg is optional for actual video fixtures. Never reads personal media.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import struct
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("directory", type=Path)
args = parser.parse_args()
root = args.directory
root.mkdir(parents=True, exist_ok=False)
(root / "nested").mkdir()
def png(path, variant=0, unique=False):
    width, height = 640, 480
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            color = (223, 235, 228)
            if 35 < x < 600 and 50 < y < 400:
                color = (101, 86, 219)
            if (x - 410 - variant) ** 2 + (y - 190) ** 2 < 110 ** 2:
                color = (255, 225, 168)
            if unique:
                color = (250, 130, 58) if (x // 40 + y // 40) % 2 else (40, 190, 150)
            pixels.extend(color)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))

png(root / "original.png")
shutil.copyfile(root / "original.png", root / "duplicate.png")
shutil.copyfile(root / "original.png", root / "nested/copy.png")
png(root / "similar_variant_a.png", variant=8)
png(root / "similar_variant_b.png", variant=10)
png(root / "unique.png", unique=True)
shutil.copyfile(root / "unique.png", root / "Screenshot_protected.png")
(root / "corrupt.jpg").write_bytes(b"intentionally not a valid image")
(root / "ignore.txt").write_text("This non-media document must never be targeted.\n")
if shutil.which("ffmpeg"):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(root / "original.mp4")], check=True)
    shutil.copyfile(root / "original.mp4", root / "nested/video_copy.mp4")
print(f"Created synthetic fixtures at {root}")
