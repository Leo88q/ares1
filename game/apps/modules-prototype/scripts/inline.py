import re, pathlib, sys

# Inlines dist/index.html css+js into a single portable colony.html (file:// safe)
d = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'dist')
html = (d / 'index.html').read_text()

def in_css(m):
    return '<style>' + (d / m.group(1).lstrip('/')).read_text() + '</style>'

def in_js(m):
    return '<script type="module">' + (d / m.group(1).lstrip('/')).read_text() + '</script>'

html = re.sub(r'<link[^>]+href="([^"]+\.css)"[^>]*>', in_css, html)
html = re.sub(r'<script[^>]+src="([^"]+\.js)"[^>]*></script>', in_js, html)
html = re.sub(r'//# sourceMappingURL=[^\n]*', '', html)  # не мусорим в консоли file://
(d / 'colony.html').write_text(html)
print('inline ok:', (d / 'colony.html').stat().st_size, 'bytes')
