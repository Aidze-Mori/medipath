#!/usr/bin/env python3
"""Rebuild the authored two-page PDF from the canonical doctor-report fixture.

Requires reportlab (available in the Codex bundled Python runtime).
Run from any directory: python3 scripts/build-doctor-report.py
No report text is maintained here; the synthetic fixture is the source of truth.
The PDF uses deterministic metadata so rebuilding unchanged inputs keeps its hash.
"""
from html import escape
from pathlib import Path
import hashlib
import json

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/examples/synthetic-doctor-report.pdf'
FONT_DIR = ROOT / 'node_modules/pdfjs-dist/standard_fonts'
FIXTURE = next(item for item in json.loads((ROOT / 'data/synthetic/fixtures.json').read_text()) if item['id'] == 'doctor-report')
assert FIXTURE['provenance'] == 'authored_synthetic' and FIXTURE['clinicalReviewed'] is False
pdfmetrics.registerFont(TTFont('Report', str(FONT_DIR / 'LiberationSans-Regular.ttf')))
pdfmetrics.registerFont(TTFont('Report-Bold', str(FONT_DIR / 'LiberationSans-Bold.ttf')))

# Clinic-series tokens. Only vector decoration is added; every text run belongs
# to a canonical source section. Repeated section headings are parser labels.
TOKENS = json.loads((ROOT / 'docs/design/tokens.json').read_text())['colors']
INK = colors.HexColor(TOKENS['text'])
MUTED = colors.HexColor(TOKENS['muted'])
PRIMARY = colors.HexColor(TOKENS['primary'])
SOFT = colors.HexColor(TOKENS['surfaceSoft'])
BORDER = colors.HexColor(TOKENS['border'])
WIDTH, HEIGHT = A4
LEFT, RIGHT, BOTTOM = 52, 52, 48
CONTENT = WIDTH - LEFT - RIGHT
styles = {
    'body': ParagraphStyle('body', fontName='Report', fontSize=11.2, leading=16.5, textColor=INK, splitLongWords=0),
    'title': ParagraphStyle('title', fontName='Report-Bold', fontSize=20, leading=26, textColor=INK, splitLongWords=0),
    'heading': ParagraphStyle('heading', fontName='Report-Bold', fontSize=15, leading=21, textColor=PRIMARY),
    'meta': ParagraphStyle('meta', fontName='Report', fontSize=10, leading=14.5, textColor=MUTED, splitLongWords=0),
    'note': ParagraphStyle('note', fontName='Report', fontSize=9.7, leading=14, textColor=PRIMARY, splitLongWords=0),
}
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas = Canvas(str(OUTPUT), pagesize=A4, invariant=1, pageCompression=1)
canvas.setTitle(FIXTURE['title'])
canvas.setAuthor('MediPath synthetic demonstration')
canvas.setSubject('Authored synthetic example; not a real patient record')


def page_start():
    canvas.setFillColor(PRIMARY)
    canvas.roundRect(LEFT, HEIGHT - 41, 56, 4, 2, fill=1, stroke=0)
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(.7)
    canvas.line(LEFT, 31, WIDTH - RIGHT, 31)
    return HEIGHT - 60


def paragraph(text, y, style='body', gap=10, inset=0):
    item = Paragraph(escape(text), styles[style])
    _, height = item.wrap(CONTENT - inset * 2, HEIGHT)
    if y - height < BOTTOM:
        raise ValueError(f'Synthetic PDF page overflow in {style}; revise layout before publishing.')
    item.drawOn(canvas, LEFT + inset, y - height)
    return y - height - gap


def paragraphs(text, y):
    for part in text.split('\n\n'):
        y = paragraph(part, y)
    return y


sections = FIXTURE['sections']
description = sections['description'].split('\n\n')
assert len(description) == 4, 'Review the intentional page boundary if the source structure changes.'
y = page_start()
y = paragraph('Источник', y, 'meta', gap=8)
source_lines = sections['other'].split('\n')
y = paragraph(source_lines[0], y, 'title', gap=14)
y = paragraph(source_lines[1], y, 'note', gap=14)
for line in source_lines[2:]:
    y = paragraph(line, y, 'meta', gap=3)
y -= 18
y = paragraph('Описание', y, 'heading', gap=10)
y = paragraphs('\n\n'.join(description[:2]), y)
canvas.showPage()

y = page_start()
y = paragraph('Описание', y, 'heading', gap=10)
y = paragraphs('\n\n'.join(description[2:]), y)
y -= 7
y = paragraph('Заключение', y, 'heading', gap=10)
y = paragraphs(sections['conclusion'], y)
y -= 7
y = paragraph('Рекомендации', y, 'heading', gap=10)
recommendation = Paragraph(escape(sections['recommendations']), styles['body'])
_, height = recommendation.wrap(CONTENT - 28, HEIGHT)
if y - height - 28 < BOTTOM:
    raise ValueError('Recommendations exceed the source page; revise layout before publishing.')
canvas.setFillColor(SOFT)
canvas.roundRect(LEFT, y - height - 28, CONTENT, height + 28, 8, fill=1, stroke=0)
recommendation.drawOn(canvas, LEFT + 14, y - height - 14)
canvas.save()
print(f'{OUTPUT.relative_to(ROOT)} | 2 pages | sha256 {hashlib.sha256(OUTPUT.read_bytes()).hexdigest()}')
