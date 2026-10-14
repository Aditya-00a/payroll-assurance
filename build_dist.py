#!/usr/bin/env python3
"""Build public/ for static hosting (Vercel serves it with no build step).

app/index.html is written for the claude.ai artifact viewer, which supplies the
<!doctype>, <head> and <body> wrapper. This wraps it in a full document, turns on
the sample-file download links (window.PA_HOSTED), and copies the scripts.

    python3 build_dist.py
"""
import pathlib
import shutil

root = pathlib.Path(__file__).resolve().parent
src = (root / 'app/index.html').read_text()
i = src.index('<header class="top">')
head = src[:i].replace('<meta charset="utf-8">\n', '')
body = src[i:].replace(
    '<script src="sample-data.js"></script>',
    '<script>window.PA_HOSTED = true;</script>\n<script src="sample-data.js"></script>',
)
reset = """<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font-size: 14px; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
"""
doc = (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    f'{reset}{head}</head>\n<body>\n{body}</body>\n</html>\n'
)

out = root / 'public'
if out.exists():
    shutil.rmtree(out)
out.mkdir()
(out / 'index.html').write_text(doc)
for f in ['app.js', 'engine.js', 'sample-data.js']:
    shutil.copy(root / 'app' / f, out / f)
print('built', sorted(p.name for p in out.iterdir()))
