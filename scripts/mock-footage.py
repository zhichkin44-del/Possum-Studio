"""Макет «съёмки поссума» для проверки оформления (заставка, обложка): тёплый тёмный фон, мягкий свет, зверёк-силуэт летит.
Это НЕ настоящая съёмка и нигде не выкладывается — только чтобы арт-директор оценивал композицию на похожем кадре.
  python scripts/mock-footage.py <out.mp4> [секунд]
"""
import math
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
secs = float(sys.argv[2]) if len(sys.argv) > 2 else 16
W, H, FPS = 720, 1280, 24
ff = "ffmpeg"
cmd = [ff, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
       "-f", "lavfi", "-i", f"sine=frequency=520:duration={secs}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)

yy, xx = np.mgrid[0:H, 0:W]
for i in range(int(secs * FPS)):
    t = i / FPS
    # тёплый тёмный фон с мягким светом сбоку
    cx, cy = 0.25 * W, 0.35 * H
    glow = np.exp(-(((xx - cx) / (0.6 * W)) ** 2 + ((yy - cy) / (0.5 * H)) ** 2))
    base = np.stack([46 + 120 * glow, 32 + 80 * glow, 24 + 45 * glow], axis=-1)
    img = Image.fromarray(np.clip(base, 0, 255).astype("uint8"))
    d = ImageDraw.Draw(img)
    # крупный герой по центру (как в эталонах: 50–70% кадра), светлее фона, лёгкое покачивание
    sway = 14 * math.sin(t * 1.3); bob = 10 * math.sin(t * 2.1)
    cxh, cyh = W // 2 - 24 + sway, int(H * 0.62 + bob)
    rw, rh = 252, 225
    d.ellipse([cxh - rw, cyh - rh, cxh + rw, cyh + rh], fill=(232, 226, 216))
    d.ellipse([cxh - rw - 30, cyh - 150, cxh - 60, cyh + 120], fill=(244, 238, 230))   # ухо
    d.ellipse([cxh + 60, cyh - 190, cxh + 210, cyh - 40], fill=(244, 238, 230))        # ухо
    d.ellipse([cxh - 120, cyh - 60, cxh - 80, cyh - 10], fill=(18, 14, 12)); d.ellipse([cxh + 60, cyh - 60, cxh + 100, cyh - 10], fill=(18, 14, 12))
    d.ellipse([cxh - 20, cyh + 20, cxh + 20, cyh + 50], fill=(210, 150, 150))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    p.stdin.write(img.tobytes())
p.stdin.close(); p.wait()
print(out)
