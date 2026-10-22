# PDF Partner Generator

Wandelt HMQ-Beweissicherungsberichte (Export der Beweissicherungsapp) in Berichte um, die unter dem Namen eines Partnerbüros ausgeliefert werden. Partner werden fest hinterlegt und in der Oberfläche per Dropdown gewählt.

## Was angepasst wird

- **Titelseite:** HMQ-Banner (Logo, Geschäftsbereiche, Standorte, SGS-Siegel) wird entfernt, Partnerlogo oben links eingesetzt.
- **Kopfzeile ab Seite 2:** HMQ-Logo wird entfernt, die Kopflinie bleibt.
- **Fusszeile ab Seite 2:** «HMQ AG, Datum» wird zu «Partnername, Datum» (Name fett, Datum normal, wie im Original).
- **Verfasser des Berichts:** Firma, Adresse, Telefon und Kontaktzeilen kommen vom Partner; die Personen bleiben.
- **Fliesstext:** Jede Erwähnung wird gesucht, nicht über feste Seitenzahlen. «HMQ AG» wird durch den Partnernamen ersetzt (Anmerkungen, Schlussbemerkung), «neben den Experten der HMQ» wird zu «neben den Experten». Der Absatz wird im Blocksatz neu gesetzt, Farbe und Deckkraft des Originals bleiben.

Schrift für eingesetzten Text: Liberation Sans (gleiche Zeichenbreiten wie Arial, SIL Open Font License, siehe `backend/fonts/LICENSE-LiberationSans.txt`).

## Endkontrolle

Bevor ein PDF zurückgegeben wird, prüft das Backend das Ergebnis. Schlägt eine Prüfung fehl, gibt es eine Fehlermeldung mit Seitenangabe statt eines PDF:

- keine Spuren von HMQ (Text, Links, Metadaten), beweissicherungen.ch, HMQ-Standortadressen und -Telefonnummern
- Bannerbereich der Titelseite und Kopflogo-Bereich leer
- Partnername in jeder Fusszeile
- kein anderer Text und keine andere Grafik verloren

Weicht ein Bericht von der bekannten Vorlage ab (z.B. unbekannte HMQ-Formulierung, verschobenes Banner), bricht das Tool mit einer Meldung ab.

## Aufbau

| Teil | Technik | Ort |
|---|---|---|
| Oberfläche | Next.js 14, statischer Export, Vercel (Auto-Deploy von `main`) | `src/` |
| Verarbeitung | Python, PyMuPDF, Modal.com (Workspace `bkdesigngmbh`, App `hmq-pdf-processor`) | `backend/` |
| Partnerprofile | JSON plus Logo | `src/config/partners.json`, `public/partners/` |

Die Oberfläche schickt PDF, Partnerdaten und Logo an `NEXT_PUBLIC_MODAL_URL` (Vercel-Umgebungsvariable).

## Partner erfassen

1. Logo als PNG oder JPEG nach `public/partners/<id>.png`.
2. Eintrag in `src/config/partners.json`:

   ```json
   {
     "id": "jermann",
     "name": "Jermann Ingenieure + Geometer AG",
     "address": ["Altenmatteweg 1", "CH-4144 Arlesheim"],
     "phone": "+41 61 706 93 93",
     "email": "info@jermann-ag.ch",
     "logo": "/partners/jermann.png"
   }
   ```

   `web` ist optional wie `email`.
3. Mit `backend/convert_local.py` gegen einen Musterbericht testen, dann PR und Merge (Vercel deployt).

## Lokal testen

```bash
python3 backend/convert_local.py "<bericht>.pdf" "<ausgabe>.pdf" --partner jermann
```

Voraussetzung: `pip install pymupdf==1.28.2` (gleiche Version wie im Modal-Image).

## Deploy

- **Backend:** `modal deploy backend/app.py` aus dem Repo-Root. Die URL bleibt gleich, solange App- und Funktionsname gleich bleiben.
- **Oberfläche:** Merge auf `main`, Vercel baut automatisch.

## Entwicklung Oberfläche

```bash
npm ci
npm run dev
```

`NEXT_PUBLIC_MODAL_URL` in `.env.local` setzen (Vorlage `.env.example`).

## Hinweise

- Die Berichte werden zur Verarbeitung an Modal.com übertragen; das Tool speichert dort nichts.
- PDF und Ergebnis werden als Base64 in JSON übertragen; bei grossen Berichten (20 MB) dauert die Übertragung je nach Leitung über eine Minute, die Verarbeitung selbst wenige Sekunden.
- Das Backend nimmt höchstens zwei Berichte gleichzeitig an, weitere warten. Eine Anfrage darf samt Übertragung 150 s dauern, danach bricht Modal ab.

## Lizenz

Proprietär, nur für internen Gebrauch der HMQ AG.
