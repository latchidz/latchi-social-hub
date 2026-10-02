#!/usr/bin/env python3
"""Generates ALL LATCHI SOCIAL HUB visual assets as precise vector SVGs
(dev tool — re-runnable, deterministic; needs rsvg-convert for PNG twins).

Outputs:
  src/assets/platforms/<id>.svg + .png   8 rectangular 3:6 (300x600) tiles
  src/assets/branding/banner.svg         1200x400 home banner
  src/assets/backgrounds/*.svg           1920x1080 home backgrounds (5)

Identity: dark navy #0A0D14 / #111A2C + gold #F2C14E + per-platform accents.
No emoji, no raster sources — pure geometry.
"""
import os, subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
P_DIR = os.path.join(ROOT, 'src', 'assets', 'platforms')
B_DIR = os.path.join(ROOT, 'src', 'assets', 'branding')
G_DIR = os.path.join(ROOT, 'src', 'assets', 'backgrounds')
for d in (P_DIR, B_DIR, G_DIR):
    os.makedirs(d, exist_ok=True)

GOLD = '#F2C14E'
GOLD_L = '#F6D47A'
GOLD_D = '#D9A441'
TEXT = '#E9EDF6'

# exact 24x24 logo marks reused from the shell symbol library ────────────
L24 = {
    'instagram': '''<defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".45" stop-color="#FA7E1E"/><stop offset=".72" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs>
      <circle cx="12" cy="12" r="11" fill="url(#ig)"/>
      <rect x="7" y="7" width="10" height="10" rx="3.2" fill="none" stroke="#fff" stroke-width="1.7"/>
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="#fff" stroke-width="1.7"/>
      <circle cx="14.9" cy="9.1" r=".9" fill="#fff"/>''',
    'facebook': '''<circle cx="12" cy="12" r="11" fill="#1877F2"/>
      <path fill="#fff" d="M13.4 20v-7.3h2.5l.4-2.9h-2.9V7.9c0-.8.2-1.4 1.4-1.4h1.6V3.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.2H8v2.9h2.5V20z"/>''',
    'messenger': '''<defs><linearGradient id="ms" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00B2FF"/><stop offset="1" stop-color="#A033FF"/></linearGradient></defs>
      <circle cx="12" cy="12" r="11" fill="url(#ms)"/>
      <path fill="#fff" d="M12 5.1c-3.9 0-7 2.8-7 6.3 0 1.9.9 3.6 2.4 4.8V19l2.3-1.2c.7.2 1.5.3 2.3.3 3.9 0 7-2.9 7-6.4S15.9 5.1 12 5.1Zm.8 9.6-2-2.2-3.7 2 4.1-4.3 2 2.2 3.7-2-4.1 4.3Z"/>''',
    'telegram': '''<circle cx="12" cy="12" r="11" fill="#229ED9"/>
      <path fill="#fff" d="m21.9 4.6-3.1 14.5c-.2 1-.8 1.2-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-.9.5l.3-4.8L18.2 7c.4-.3-.1-.5-.6-.2L7.3 13.2l-4.6-1.4c-1-.3-1-1 .2-1.5L20.4 3.3c.8-.3 1.6.2 1.5 1.3Z"/>''',
}

# custom marks drawn inside the 300x600 tile around center (150, 250) ────
def mark_whatsapp():
    return f'''<circle cx="150" cy="250" r="55" fill="#25D366"/>
      <g transform="translate(118,218) scale(2.66)">
        <path fill="#fff" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
      </g>
      <path d="M118 291 L112 308 L131 299 Z" fill="#25D366"/>'''

def mark_gmail():
    return f'''<rect x="105" y="218" width="90" height="64" rx="9" fill="none" stroke="#E9EDF6" stroke-width="5"/>
      <path d="M109 227 L150 262 L191 227" fill="none" stroke="#EA4335" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="150" cy="284" r="3.4" fill="#4285F4"/>
      <circle cx="136" cy="284" r="3.4" fill="#EA4335"/>
      <circle cx="164" cy="284" r="3.4" fill="#34A853"/>'''

def mark_outlook():
    return f'''<circle cx="150" cy="250" r="55" fill="#0078D4"/>
      <rect x="110" y="224" width="80" height="54" rx="7" fill="#fff"/>
      <path d="M113 230 L150 256 L187 230" fill="none" stroke="#0078D4" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="150" cy="250" r="11" fill="none" stroke="#0A5FA8" stroke-width="4.5"/>'''

def mark_youtube():
    return f'''<rect x="100" y="222" width="100" height="56" rx="17" fill="#FF0000"/>
      <path d="M138 236 L166 250 L138 264 Z" fill="#fff"/>'''

CUSTOM = {
    'whatsapp': ('#25D366', 'WhatsApp', mark_whatsapp()),
    'gmail':    ('#EA4335', 'Gmail',    mark_gmail()),
    'outlook':  ('#0078D4', 'Outlook',  mark_outlook()),
    'youtube':  ('#FF0000', 'YouTube',  mark_youtube()),
}
L24_META = {
    'instagram': ('#E1306C', 'Instagram'),
    'facebook':  ('#1877F2', 'Facebook'),
    'messenger': ('#00B2FF', 'Messenger'),
    'telegram':  ('#229ED9', 'Telegram'),
}

def tile_svg(accent, name, logo_markup):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600" viewBox="0 0 300 600">
  <defs>
    <linearGradient id="tbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#131C30"/><stop offset="1" stop-color="#0A0D14"/>
    </linearGradient>
    <radialGradient id="tglow" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0" stop-color="{accent}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="{accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tgold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="{GOLD_L}"/><stop offset="1" stop-color="{GOLD_D}"/>
    </linearGradient>
  </defs>
  <rect width="300" height="600" rx="28" fill="url(#tbg)"/>
  <rect width="300" height="600" rx="28" fill="url(#tglow)"/>
  <rect x="7" y="7" width="286" height="586" rx="23" fill="none" stroke="{GOLD}" stroke-opacity="0.28" stroke-width="2"/>
  {logo_markup}
  <rect x="126" y="344" width="48" height="3.5" rx="1.75" fill="url(#tgold)"/>
  <text x="150" y="412" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="27" font-weight="600" letter-spacing="2.5" fill="{TEXT}">{name}</text>
</svg>
'''

def l24_wrap(inner):
    return f'<svg x="95" y="195" width="110" height="110" viewBox="0 0 24 24">{inner}</svg>'

# ── generate platform tiles ──────────────────────────────────────────────
for pid, (accent, name) in L24_META.items():
    svg = tile_svg(accent, name, l24_wrap(L24[pid]))
    open(os.path.join(P_DIR, pid + '.svg'), 'w').write(svg)
for pid, (accent, name, markup) in CUSTOM.items():
    svg = tile_svg(accent, name, markup)
    open(os.path.join(P_DIR, pid + '.svg'), 'w').write(svg)

# ── banner 1200x400 ─────────────────────────────────────────────────────
def hub_glyph(x, y, s=1.0):
    return f'''<g transform="translate({x},{y}) scale({s})">
    <rect x="-34" y="-34" width="68" height="68" rx="18" fill="none" stroke="url(#bgold)" stroke-width="3"/>
    <path d="M-19 -19 L-8 -8 M19 -19 L8 -8 M-19 19 L-8 8 M19 19 L8 8" stroke="url(#bgold)" stroke-width="2.4" stroke-linecap="round"/>
    <circle r="6" fill="url(#bgold)"/>
    <circle cx="-19" cy="-19" r="4.6" fill="url(#bgold)"/><circle cx="19" cy="-19" r="4.6" fill="url(#bgold)"/>
    <circle cx="-19" cy="19" r="4.6" fill="url(#bgold)"/><circle cx="19" cy="19" r="4.6" fill="url(#bgold)"/>
  </g>'''

banner = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <defs>
    <radialGradient id="bglow" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0" stop-color="#1A2440"/><stop offset="1" stop-color="#0A0D14"/>
    </radialGradient>
    <linearGradient id="bgold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{GOLD_L}"/><stop offset="1" stop-color="{GOLD_D}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="400" fill="url(#bglow)"/>
  <path d="M60 46 H1140" stroke="{GOLD}" stroke-opacity="0.25" stroke-width="1.5"/>
  <path d="M60 354 H1140" stroke="{GOLD}" stroke-opacity="0.25" stroke-width="1.5"/>
  <circle cx="60" cy="46" r="3" fill="{GOLD}"/><circle cx="1140" cy="46" r="3" fill="{GOLD}"/>
  <circle cx="60" cy="354" r="3" fill="{GOLD}"/><circle cx="1140" cy="354" r="3" fill="{GOLD}"/>
  {hub_glyph(150, 200)}
  {hub_glyph(1050, 200)}
  <text x="600" y="215" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="64" font-weight="700" letter-spacing="9" fill="url(#bgold)">LATCHI SOCIAL HUB</text>
  <g fill="{GOLD}" fill-opacity="0.55">
    <circle cx="470" cy="262" r="2.6"/><circle cx="600" cy="262" r="2.6"/><circle cx="730" cy="262" r="2.6"/>
  </g>
</svg>
'''
open(os.path.join(B_DIR, 'banner.svg'), 'w').write(banner)

# ── backgrounds 1920x1080 ───────────────────────────────────────────────
bg = {}
bg['mesh'] = '''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <radialGradient id="m1" cx="0.22" cy="0.28" r="0.55"><stop offset="0" stop-color="#1B2A4A"/><stop offset="1" stop-color="#0A0D14" stop-opacity="0"/></radialGradient>
    <radialGradient id="m2" cx="0.8" cy="0.75" r="0.6"><stop offset="0" stop-color="#152238"/><stop offset="1" stop-color="#0A0D14" stop-opacity="0"/></radialGradient>
    <radialGradient id="m3" cx="0.62" cy="0.18" r="0.45"><stop offset="0" stop-color="#F2C14E" stop-opacity="0.07"/><stop offset="1" stop-color="#F2C14E" stop-opacity="0"/></radialGradient>
    <radialGradient id="m4" cx="0.35" cy="0.85" r="0.5"><stop offset="0" stop-color="#F2C14E" stop-opacity="0.05"/><stop offset="1" stop-color="#F2C14E" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="#0A0D14"/>
  <rect width="1920" height="1080" fill="url(#m1)"/>
  <rect width="1920" height="1080" fill="url(#m2)"/>
  <rect width="1920" height="1080" fill="url(#m3)"/>
  <rect width="1920" height="1080" fill="url(#m4)"/>
</svg>'''

stripe_lines = '\n'.join(f'<path d="M{x} -200 L{x} 1280" stroke="#F2C14E" stroke-opacity="0.055" stroke-width="2"/>' for x in range(-400, 2400, 84))
bg['stripes'] = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><radialGradient id="sg" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#121A2C"/><stop offset="1" stop-color="#0A0D14"/></radialGradient></defs>
  <rect width="1920" height="1080" fill="url(#sg)"/>
  <g transform="rotate(28 960 540)">
{stripe_lines}
  </g>
</svg>'''

dots = '\n'.join(f'<circle cx="{x}" cy="{y}" r="2.4" fill="#F2C14E" fill-opacity="0.075"/>' for y in range(40, 1080, 58) for x in range(40, 1920, 58))
bg['dots'] = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><radialGradient id="dg" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#121A2C"/><stop offset="1" stop-color="#0A0D14"/></radialGradient></defs>
  <rect width="1920" height="1080" fill="url(#dg)"/>
  <g>{dots}</g>
</svg>'''

bg['wave'] = '''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <radialGradient id="wg" cx="0.5" cy="0.5" r="0.75"><stop offset="0" stop-color="#111A2C"/><stop offset="1" stop-color="#0A0D14"/></radialGradient>
    <linearGradient id="wgold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F2C14E" stop-opacity="0"/><stop offset="0.5" stop-color="#F2C14E" stop-opacity="0.35"/><stop offset="1" stop-color="#F2C14E" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#wg)"/>
  <path d="M0 420 C 320 340, 640 500, 960 430 S 1600 340, 1920 410" fill="none" stroke="url(#wgold)" stroke-width="2.6"/>
  <path d="M0 560 C 320 640, 640 480, 960 550 S 1600 660, 1920 580" fill="none" stroke="url(#wgold)" stroke-width="2.2"/>
  <path d="M0 700 C 320 620, 640 760, 960 690 S 1600 620, 1920 690" fill="none" stroke="url(#wgold)" stroke-width="1.8"/>
</svg>'''

hex_poly = ' '.join(f'{58 + 56*k if k==0 else 58 + 56*k},{0 if k==0 else 0}' for k in range(0))
def hexagon(cx, cy, r):
    import math
    pts = ' '.join(f'{cx + r*math.cos(math.radians(60*k - 30)):.1f},{cy + r*math.sin(math.radians(60*k - 30)):.1f}' for k in range(6))
    return f'<polygon points="{pts}" fill="none" stroke="#F2C14E" stroke-opacity="0.055" stroke-width="1.6"/>'
hexes = []
for row, y in enumerate(range(-40, 1140, 78)):
    xoff = 68 if row % 2 else 0
    for x in range(-80 + xoff, 2000, 136):
        hexes.append(hexagon(x, y, 46))
bg['hex'] = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><radialGradient id="hg" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#121A2C"/><stop offset="1" stop-color="#0A0D14"/></radialGradient></defs>
  <rect width="1920" height="1080" fill="url(#hg)"/>
  <g>{''.join(hexes)}</g>
</svg>'''

for name, svg in bg.items():
    open(os.path.join(G_DIR, name + '.svg'), 'w').write(svg)

# ── PNG twins for platform tiles ────────────────────────────────────────
for pid in list(L24_META) + list(CUSTOM):
    src = os.path.join(P_DIR, pid + '.svg')
    dst = os.path.join(P_DIR, pid + '.png')
    subprocess.run(['rsvg-convert', '-w', '300', '-h', '600', src, '-o', dst], check=True)

print('assets generated:')
print(' platforms:', sorted(os.listdir(P_DIR)))
print(' branding:', sorted(os.listdir(B_DIR)))
print(' backgrounds:', sorted(os.listdir(G_DIR)))
