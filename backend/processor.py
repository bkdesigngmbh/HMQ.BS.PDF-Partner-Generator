"""
Partner conversion of HMQ evidence reports (Beweissicherungsberichte).

Input is an HMQ report as exported by the Beweissicherungsapp (Adobe HTML2PDF).
Output is the same report issued under a partner's name: HMQ branding removed,
author block, footer and HMQ mentions in the body replaced by partner data.

Every change is located by text or inside a verified zone. Anything that does
not match the known report layout raises ConversionError, and a final check
scans the result for remaining HMQ traces and lost content before it is
returned. User-facing messages are German.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import fitz

FONT_DIR = Path(__file__).parent / "fonts"
# Liberation Sans is metric-compatible with Arial, the font of the reports.
FONT_REGULAR = fitz.Font(fontfile=str(FONT_DIR / "LiberationSans-Regular.ttf"))
FONT_BOLD = fitz.Font(fontfile=str(FONT_DIR / "LiberationSans-Bold.ttf"))

# Page 1: the HMQ banner column (logo, business units, offices, SGS seal)
# starts at x=488.5 pt; report content ends at x=472.5 pt.
COVER_BANNER_X = 480.0
# Page 1: box for the partner logo, top-left aligned with the title text.
COVER_LOGO_BOX = fitz.Rect(65.5, 74.0, 253.0, 149.0)
# Pages 2+: HMQ logo at 527-551 / 35-59 pt; the header rule at y=63 stays.
HEADER_LOGO_ZONE = fitz.Rect(525.0, 33.0, 554.0, 61.5)
FOOTER_MIN_Y = 760.0
TEXT_RIGHT_EDGE = 552.0
AUTHOR_HEADING = "Verfasser des Berichts"

FOOTER_RE = re.compile(r"^HMQ AG,\s*(\d{2}\.\d{2}\.\d{4})$")
ZIP_LINE_RE = re.compile(r"^CH-\d{4}\s")
PHONE_LINE_RE = re.compile(r"^\+\d[\d ]+$")
HMQ_CONTACT_RE = re.compile(r"^(www\.beweissicherungen\.ch|\S+@hmq\.ch)$", re.IGNORECASE)

# Body wording, applied in order; "{name}" is the partner name.
BODY_REPLACEMENTS = (
    ("neben den Experten der HMQ ", "neben den Experten "),
    ("HMQ AG", "{name}"),
)

# HMQ traces that must not survive (offices as listed in the cover banner).
FORBIDDEN = (
    ("HMQ", re.compile(r"hmq", re.IGNORECASE)),
    ("beweissicherungen.ch", re.compile(r"beweissicherungen\.ch", re.IGNORECASE)),
    (
        "HMQ-Adresse",
        re.compile(
            r"Schützenweg 8|Sommeraustrasse 30|Balz-Zimmermann|Promenada 14d"
            r"|Via Hans Erni 15|Vordere Hauptgasse 104|Johann-Aberli 15"
        ),
    ),
    (
        "HMQ-Telefon",
        re.compile(
            r"81\s?650\s?05\s?05|44\s?925\s?50\s?00|81\s?920\s?02\s?90"
            r"|62\s?752\s?00\s?22|32\s?552\s?15\s?05"
        ),
    ),
)


class ConversionError(Exception):
    """The report does not match the known layout or the result is not clean."""


@dataclass(frozen=True)
class Partner:
    name: str
    address: tuple[str, ...]
    phone: str
    email: str | None = None
    web: str | None = None

    @classmethod
    def from_dict(cls, data: object) -> Partner:
        if not isinstance(data, dict):
            raise ConversionError("Partnerdaten fehlen.")
        name, address, phone = data.get("name"), data.get("address"), data.get("phone")
        if not isinstance(name, str) or not name.strip():
            raise ConversionError("Partnername fehlt.")
        if not isinstance(address, list) or not address or not all(
            isinstance(line, str) and line.strip() for line in address
        ):
            raise ConversionError("Partneradresse fehlt.")
        if not isinstance(phone, str) or not phone.strip():
            raise ConversionError("Telefonnummer des Partners fehlt.")
        optional: dict[str, str | None] = {}
        for key in ("email", "web"):
            value = data.get(key)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ConversionError(f"Partnerfeld «{key}» ist ungültig.")
            optional[key] = value.strip() if value else None
        return cls(name.strip(), tuple(line.strip() for line in address), phone.strip(), **optional)

    @property
    def contact_lines(self) -> list[str]:
        return [line for line in (self.web, self.email) if line]


@dataclass(eq=False)
class Line:
    text: str
    bbox: fitz.Rect
    origin: fitz.Point
    size: float


@dataclass(frozen=True)
class TextStyle:
    """Colour and opacity of the replaced text (body text uses 87 % black)."""

    color: tuple[float, float, float]
    opacity: float


@dataclass
class PagePlan:
    redactions: list[fitz.Rect] = field(default_factory=list)
    texts: list[tuple[fitz.Point, str, fitz.Font, float, TextStyle]] = field(default_factory=list)
    images: list[tuple[fitz.Rect, bytes]] = field(default_factory=list)


def decode_base64(value: object, label: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise ConversionError(f"{label} fehlt.")
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ConversionError(f"{label} ist nicht korrekt übertragen worden.") from exc


def convert(pdf_bytes: bytes, partner: Partner, logo_bytes: bytes) -> tuple[bytes, list[str]]:
    """Returns the partner report and a list of the applied changes."""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ConversionError("Die Datei ist kein lesbares PDF.") from exc
    if doc.needs_pass:
        raise ConversionError("Das PDF ist passwortgeschützt.")
    if doc.page_count < 3:
        raise ConversionError("Unerwarteter Bericht: weniger als 3 Seiten.")

    lines = [read_lines(page) for page in doc]
    traces = [page.get_texttrace() for page in doc]
    drawings = [[d for d in page.get_drawings() if not _is_white(d)] for page in doc]
    images = [_content_images(page) for page in doc]
    plans = [PagePlan() for _ in doc]
    changes: list[str] = []

    changes.append(_plan_cover(doc[0], lines[0], drawings[0], images[0], plans[0], logo_bytes))
    changes.append(_plan_header_logos(doc, drawings, plans))
    changes.append(_plan_footers(doc, lines, traces, drawings, plans, partner))
    changes.append(_plan_author_block(lines, traces, drawings, images, plans, partner))
    changes.extend(_plan_body_mentions(lines, traces, drawings, images, plans, partner))

    expected_words = [_words_outside(page, plan.redactions) for page, plan in zip(doc, plans)]
    expected_shapes = [
        _shapes_outside(page_drawings, plan.redactions) for page_drawings, plan in zip(drawings, plans)
    ]
    for page, plan in zip(doc, plans):
        _apply(page, plan)
    result = doc.tobytes(garbage=4, deflate=True)
    doc.close()

    _verify(result, partner, expected_words, expected_shapes)
    changes.append("Endkontrolle: keine HMQ-Spuren, kein Inhalt verloren")
    return result, changes


def read_lines(page: fitz.Page) -> list[Line]:
    """Text lines of a page, top to bottom; touching pieces on one baseline are merged."""
    raw: list[Line] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = [span for span in line["spans"] if span["text"]]
            if spans:
                raw.append(
                    Line(
                        "".join(span["text"] for span in spans),
                        fitz.Rect(line["bbox"]),
                        fitz.Point(spans[0]["origin"]),
                        spans[0]["size"],
                    )
                )
    raw.sort(key=lambda line: (round(line.origin.y, 1), line.bbox.x0))
    merged: list[Line] = []
    for line in raw:
        prev = merged[-1] if merged else None
        if (
            prev is not None
            and abs(prev.origin.y - line.origin.y) < 0.6
            and -1 < line.bbox.x0 - prev.bbox.x1 < prev.size
        ):
            prev.text += line.text
            prev.bbox |= line.bbox
        else:
            merged.append(line)
    return merged


def _plan_cover(
    page: fitz.Page,
    lines: list[Line],
    drawings: list[dict],
    images: list[fitz.Rect],
    plan: PagePlan,
    logo_bytes: bytes,
) -> str:
    def straddles(rect: fitz.Rect) -> bool:
        return rect.x0 < COVER_BANNER_X < rect.x1

    if not any(d["rect"].x0 >= COVER_BANNER_X for d in drawings):
        raise ConversionError("Titelseite: HMQ-Banner nicht gefunden. Ist das ein HMQ-Bericht?")
    if (
        any(straddles(d["rect"]) for d in drawings)
        or any(straddles(rect) for rect in images)
        or any(straddles(line.bbox) for line in lines)
    ):
        raise ConversionError(
            "Titelseite: Layout weicht von der bekannten Vorlage ab (Banner nicht sauber abtrennbar)."
        )
    plan.redactions.append(fitz.Rect(COVER_BANNER_X, 0, page.rect.width, page.rect.height))
    plan.images.append((_cover_logo_rect(logo_bytes), logo_bytes))
    return "Titelseite: HMQ-Banner entfernt, Partnerlogo eingesetzt"


def _cover_logo_rect(logo_bytes: bytes) -> fitz.Rect:
    try:
        pixmap = fitz.Pixmap(logo_bytes)
    except Exception as exc:
        raise ConversionError("Das Partnerlogo ist kein gültiges Bild.") from exc
    box = COVER_LOGO_BOX
    scale = min(box.width / pixmap.width, box.height / pixmap.height)
    return fitz.Rect(box.x0, box.y0, box.x0 + pixmap.width * scale, box.y0 + pixmap.height * scale)


def _plan_header_logos(doc: fitz.Document, drawings: list[list[dict]], plans: list[PagePlan]) -> str:
    for number in range(1, doc.page_count):
        logo = [d for d in drawings[number] if d["rect"].intersects(HEADER_LOGO_ZONE)]
        if not logo or not all(HEADER_LOGO_ZONE.contains(d["rect"]) for d in logo):
            raise ConversionError(
                f"Seite {number + 1}: HMQ-Logo in der Kopfzeile nicht an der erwarteten Stelle."
            )
        plans[number].redactions.append(HEADER_LOGO_ZONE)
    return f"Kopfzeile: HMQ-Logo entfernt ({doc.page_count - 1} Seiten)"


def _plan_footers(
    doc: fitz.Document,
    lines: list[list[Line]],
    traces: list[list[dict]],
    drawings: list[list[dict]],
    plans: list[PagePlan],
    partner: Partner,
) -> str:
    label = f"{partner.name},"
    for number in range(1, doc.page_count):
        hits = [
            (line, match)
            for line in lines[number]
            if line.bbox.y0 >= FOOTER_MIN_Y and (match := FOOTER_RE.match(line.text.strip()))
        ]
        if len(hits) != 1:
            raise ConversionError(f"Seite {number + 1}: Fusszeile «HMQ AG, Datum» nicht gefunden.")
        line, match = hits[0]
        date = f" {match.group(1)}"
        label_width = FONT_BOLD.text_length(label, line.size)
        end_x = line.origin.x + label_width + FONT_REGULAR.text_length(date, line.size)
        right_neighbours = [
            other.bbox.x0
            for other in lines[number]
            if other is not line and abs(other.origin.y - line.origin.y) < 1 and other.bbox.x0 > line.bbox.x1
        ]
        limit = min(right_neighbours, default=TEXT_RIGHT_EDGE) - 10
        if end_x > limit:
            raise ConversionError("Der Partnername ist zu lang für die Fusszeile.")
        box = line.bbox
        label_probe = fitz.Rect(box.x0, box.y0, box.x0 + 3, box.y1)
        date_probe = fitz.Rect(box.x1 - 3, box.y0, box.x1, box.y1)
        label_style = _style_at(traces[number], drawings[number], label_probe, number)
        date_style = _style_at(traces[number], drawings[number], date_probe, number)
        plan = plans[number]
        plan.redactions.append(box)
        plan.texts.append((line.origin, label, FONT_BOLD, line.size, label_style))
        date_origin = fitz.Point(line.origin.x + label_width, line.origin.y)
        plan.texts.append((date_origin, date, FONT_REGULAR, line.size, date_style))
    return f"Fusszeile: Partnername eingesetzt ({doc.page_count - 1} Seiten)"


def _plan_author_block(
    lines: list[list[Line]],
    traces: list[list[dict]],
    drawings: list[list[dict]],
    images: list[list[fitz.Rect]],
    plans: list[PagePlan],
    partner: Partner,
) -> str:
    hits = [
        (number, index)
        for number, page_lines in enumerate(lines)
        for index, line in enumerate(page_lines)
        if line.text.strip() == AUTHOR_HEADING
    ]
    if len(hits) != 1:
        raise ConversionError(f"Abschnitt «{AUTHOR_HEADING}» nicht eindeutig gefunden.")
    number, index = hits[0]
    heading = lines[number][index]

    block: list[Line] = []
    for line in lines[number][index + 1 :]:
        prev = block[-1] if block else heading
        if (
            line.bbox.y0 >= FOOTER_MIN_Y
            or abs(line.bbox.x0 - heading.bbox.x0) > 1
            or line.origin.y - prev.origin.y > 2.5 * line.size
        ):
            break
        block.append(line)

    texts = [line.text.strip() for line in block]
    if not texts or texts[0] != "HMQ AG":
        raise ConversionError("Verfasser-Block: erste Zeile ist nicht «HMQ AG».")
    zip_index = next((k for k, text in enumerate(texts) if ZIP_LINE_RE.match(text)), None)
    if zip_index is None or zip_index < 3:
        raise ConversionError("Verfasser-Block: Personen und Adresse nicht erkannt.")
    if zip_index + 1 >= len(texts) or not PHONE_LINE_RE.match(texts[zip_index + 1]):
        raise ConversionError("Verfasser-Block: Telefonzeile nicht erkannt.")
    unknown = [text for text in texts[zip_index + 2 :] if not HMQ_CONTACT_RE.match(text)]
    if unknown:
        raise ConversionError(f"Verfasser-Block: unbekannte Zeile «{unknown[0]}».")
    persons = texts[1 : zip_index - 1]

    size = block[0].size
    pitch = block[1].origin.y - block[0].origin.y
    phone_line = block[zip_index + 1]
    has_hmq_contacts = len(block) > zip_index + 2
    contact_gap = block[zip_index + 2].origin.y - phone_line.origin.y if has_hmq_contacts else pitch * 1.5

    x, y = block[0].origin
    rows = [partner.name, *persons, *partner.address, partner.phone]
    placed = [(fitz.Point(x, y + k * pitch), row) for k, row in enumerate(rows)]
    contact_y = y + (len(rows) - 1) * pitch + contact_gap
    placed += [(fitz.Point(x, contact_y + k * pitch), row) for k, row in enumerate(partner.contact_lines)]

    area = fitz.Rect(heading.bbox.x0 - 0.5, block[0].bbox.y0, TEXT_RIGHT_EDGE, block[-1].bbox.y1 + 1.5)
    limit = _content_top_below(lines[number], drawings[number], images[number], area, exclude=block)
    if placed[-1][0].y + 0.3 * size > limit - 1:
        raise ConversionError("Verfasser-Block: Partneradresse passt nicht in den vorhandenen Platz.")

    style = _style_at(traces[number], drawings[number], _line_start(block[0]), number)
    plan = plans[number]
    plan.redactions.append(area)
    plan.texts.extend((point, row, FONT_REGULAR, size, style) for point, row in placed)
    return f"Seite {number + 1}: Verfasser-Block mit Partneradresse ersetzt"


def _plan_body_mentions(
    lines: list[list[Line]],
    traces: list[list[dict]],
    drawings: list[list[dict]],
    images: list[list[fitz.Rect]],
    plans: list[PagePlan],
    partner: Partner,
) -> list[str]:
    changes: list[str] = []
    for number, page_lines in enumerate(lines):
        plan = plans[number]
        for index, line in enumerate(page_lines):
            if not _forbidden_hits(line.text) or _is_covered(line.bbox, plan.redactions):
                continue
            paragraph = _paragraph_around(page_lines, index)
            original = " ".join(part.text.strip() for part in paragraph)
            replaced = original
            for old, new in BODY_REPLACEMENTS:
                replaced = replaced.replace(old, new.format(name=partner.name))
            if _forbidden_hits(replaced):
                raise ConversionError(
                    f"Seite {number + 1}: unbekannte HMQ-Stelle «{original}». "
                    "Bitte Bericht an die Bereichsleitung melden."
                )
            style = _style_at(traces[number], drawings[number], _line_start(paragraph[0]), number)
            _plan_paragraph(
                number, page_lines, drawings[number], images[number], plan, paragraph, replaced, style
            )
            changes.append(f"Seite {number + 1}: Text angepasst: «{_shorten(replaced)}»")
    return changes


def _paragraph_around(lines: list[Line], index: int) -> list[Line]:
    """Consecutive lines with the anchor's indent and size and a regular line pitch."""
    anchor = lines[index]
    peers = sorted(
        (
            line
            for line in lines
            if abs(line.bbox.x0 - anchor.bbox.x0) < 1 and abs(line.size - anchor.size) < 0.2
        ),
        key=lambda line: line.origin.y,
    )
    position = next(k for k, line in enumerate(peers) if line is anchor)
    max_pitch = anchor.size * 1.7

    def joined(upper: Line, lower: Line) -> bool:
        if lower.origin.y - upper.origin.y > max_pitch:
            return False
        return not any(upper.origin.y + 0.5 < line.origin.y < lower.origin.y - 0.5 for line in lines)

    start = position
    while start > 0 and joined(peers[start - 1], peers[start]):
        start -= 1
    end = position
    while end + 1 < len(peers) and joined(peers[end], peers[end + 1]):
        end += 1
    return peers[start : end + 1]


def _plan_paragraph(
    number: int,
    page_lines: list[Line],
    drawings: list[dict],
    images: list[fitz.Rect],
    plan: PagePlan,
    paragraph: list[Line],
    text: str,
    style: TextStyle,
) -> None:
    first = paragraph[0]
    size = first.size
    x0 = first.bbox.x0
    justified = len(paragraph) > 1 and all(
        line.bbox.x1 >= TEXT_RIGHT_EDGE - 3 for line in paragraph[:-1]
    )
    right = max(line.bbox.x1 for line in paragraph[:-1]) if justified else TEXT_RIGHT_EDGE
    width = right - x0
    pitch = (
        (paragraph[-1].origin.y - first.origin.y) / (len(paragraph) - 1)
        if len(paragraph) > 1
        else size * 1.5
    )

    rows = _wrap(text.split(), size, width)
    area = fitz.Rect(x0, first.bbox.y0, right, paragraph[-1].bbox.y1)
    limit = _content_top_below(page_lines, drawings, images, area, exclude=paragraph)
    if first.origin.y + (len(rows) - 1) * pitch + 0.3 * size > limit - 1:
        raise ConversionError(
            f"Seite {number + 1}: angepasster Text «{_shorten(text)}» passt nicht in den vorhandenen Platz."
        )

    space = FONT_REGULAR.text_length(" ", size)
    for k, row in enumerate(rows):
        y = first.origin.y + k * pitch
        widths = [FONT_REGULAR.text_length(word, size) for word in row]
        last_row = k == len(rows) - 1
        gap = (width - sum(widths)) / (len(row) - 1) if justified and not last_row and len(row) > 1 else space
        x = x0
        for word, word_width in zip(row, widths):
            plan.texts.append((fitz.Point(x, y), word, FONT_REGULAR, size, style))
            x += word_width + gap
    plan.redactions.extend(line.bbox for line in paragraph)


def _wrap(words: list[str], size: float, width: float) -> list[list[str]]:
    rows: list[list[str]] = []
    current: list[str] = []
    for word in words:
        candidate = current + [word]
        if current and FONT_REGULAR.text_length(" ".join(candidate), size) > width:
            rows.append(current)
            current = [word]
        else:
            current = candidate
    if current:
        rows.append(current)
    for row in rows:
        if FONT_REGULAR.text_length(" ".join(row), size) > width:
            raise ConversionError(f"Wort zu lang für die Zeile: «{row[0]}».")
    return rows


def _content_top_below(
    lines: list[Line],
    drawings: list[dict],
    images: list[fitz.Rect],
    area: fitz.Rect,
    exclude: list[Line],
) -> float:
    """Top edge of the nearest content below `area` that overlaps it horizontally."""

    def below(rect: fitz.Rect) -> bool:
        return rect.y0 >= area.y1 and rect.x1 > area.x0 and rect.x0 < area.x1

    tops = [line.bbox.y0 for line in lines if below(line.bbox) and all(line is not e for e in exclude)]
    tops += [rect.y0 for rect in images if below(rect)]
    tops += [d["rect"].y0 for d in drawings if below(d["rect"])]
    return min(tops, default=FOOTER_MIN_Y)


def _apply(page: fitz.Page, plan: PagePlan) -> None:
    for rect in plan.redactions:
        page.add_redact_annot(rect, fill=False)
    if plan.redactions:
        page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )
    writers: dict[TextStyle, fitz.TextWriter] = {}
    for origin, text, font, size, style in plan.texts:
        writer = writers.setdefault(style, fitz.TextWriter(page.rect))
        writer.append(origin, text, font=font, fontsize=size)
    for style, writer in writers.items():
        writer.write_text(page, color=style.color, opacity=style.opacity)
    for rect, data in plan.images:
        page.insert_image(rect, stream=data)


def _verify(
    pdf_bytes: bytes, partner: Partner, expected_words: list[Counter], expected_shapes: list[Counter]
) -> None:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    problems: list[str] = []
    if doc.page_count != len(expected_words):
        problems.append("Seitenzahl hat sich verändert")

    metadata = " ".join(str(value) for value in doc.metadata.values() if value) + doc.get_xml_metadata()
    problems += [f"Metadaten: {label}" for label in _forbidden_hits(metadata)]

    for number, page in enumerate(doc):
        where = f"Seite {number + 1}"
        text = page.get_text()
        problems += [f"{where}: {label}" for label in _forbidden_hits(text)]
        for link in page.get_links():
            problems += [f"{where}: Link {label}" for label in _forbidden_hits(link.get("uri") or "")]

        drawings = [d for d in page.get_drawings() if not _is_white(d)]
        if number == 0:
            leftovers = [d["rect"] for d in drawings if d["rect"].x1 > COVER_BANNER_X]
            leftovers += [rect for rect in _content_images(page) if rect.x1 > COVER_BANNER_X]
            leftovers += [line.bbox for line in read_lines(page) if line.bbox.x1 > COVER_BANNER_X]
            if leftovers:
                problems.append(f"{where}: Reste im Bannerbereich ({len(leftovers)} Elemente)")
        else:
            if any(d["rect"].intersects(HEADER_LOGO_ZONE) for d in drawings):
                problems.append(f"{where}: Reste des Kopflogos")
            if partner.name not in text:
                problems.append(f"{where}: Partnername fehlt in der Fusszeile")

        missing = expected_words[number] - Counter(word[4] for word in page.get_text("words"))
        if missing:
            problems.append(f"{where}: Inhalt verloren ({', '.join(list(missing)[:5])})")
        lost_shapes = expected_shapes[number] - _shapes_outside(drawings, [])
        if lost_shapes:
            problems.append(f"{where}: {sum(lost_shapes.values())} Grafikelemente verloren")
    doc.close()

    if problems:
        raise ConversionError("Endkontrolle fehlgeschlagen: " + "; ".join(problems[:15]))


def _style_at(trace: list[dict], drawings: list[dict], probe: fitz.Rect, number: int) -> TextStyle:
    """Colour and opacity of what paints the original text at `probe`.

    Regular fonts paint as visible text spans; Type3 fonts paint their glyphs
    as filled paths, so both are considered and the largest overlap wins.
    """
    painters = [
        (fitz.Rect(span["bbox"]), span["color"], span["opacity"]) for span in trace if span["type"] == 0
    ]
    painters += [(d["rect"], d["fill"], d["fill_opacity"]) for d in drawings if d.get("fill")]
    best, best_area = None, 0.0
    for rect, color, opacity in painters:
        overlap = rect & probe
        if overlap.is_valid and overlap.get_area() > best_area:
            best, best_area = (color, opacity), overlap.get_area()
    if best is None:
        raise ConversionError(f"Seite {number + 1}: Textformat des Originals nicht bestimmbar.")
    return TextStyle(_rgb(best[0]), round(best[1], 4))


def _rgb(color: tuple[float, ...]) -> tuple[float, float, float]:
    if len(color) == 1:
        return (color[0], color[0], color[0])
    if len(color) == 3:
        return (color[0], color[1], color[2])
    if len(color) == 4:
        c, m, y, k = color
        return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    raise ConversionError("Unbekannter Farbraum im Original.")


def _line_start(line: Line) -> fitz.Rect:
    return fitz.Rect(line.bbox.x0, line.bbox.y0, line.bbox.x0 + 3, line.bbox.y1)


def _words_outside(page: fitz.Page, rects: list[fitz.Rect]) -> Counter:
    words: Counter = Counter()
    for word in page.get_text("words"):
        if not _is_covered(fitz.Rect(word[:4]), rects):
            words[word[4]] += 1
    return words


def _shapes_outside(drawings: list[dict], rects: list[fitz.Rect]) -> Counter:
    """Visible vector shapes (incl. Type3 glyphs) not fully inside a redaction area."""
    return Counter(
        tuple(round(v, 1) for v in d["rect"]) for d in drawings if not any(r.contains(d["rect"]) for r in rects)
    )


def _is_covered(rect: fitz.Rect, areas: list[fitz.Rect]) -> bool:
    center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    return any(area.contains(center) for area in areas)


def _content_images(page: fitz.Page) -> list[fitz.Rect]:
    """Image areas except the page-wide background pattern of the HTML2PDF export."""
    page_area = page.rect.width * page.rect.height
    rects = [fitz.Rect(info["bbox"]) for info in page.get_image_info()]
    return [rect for rect in rects if rect.width * rect.height < 0.9 * page_area]


def _is_white(drawing: dict) -> bool:
    def white(color: object) -> bool:
        return color is None or all(channel > 0.99 for channel in color)

    return white(drawing.get("fill")) and white(drawing.get("color"))


def _forbidden_hits(text: str) -> list[str]:
    return [label for label, pattern in FORBIDDEN if pattern.search(text)]


def _shorten(text: str, limit: int = 80) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"
