# PDF Partner Generator

White-Label Tool zur Erstellung von Partner-Beweissicherungsberichten. Das Tool entfernt HMQ-Branding aus PDF-Dokumenten und ersetzt es durch Partner-Branding.

## Features

- **PDF-Upload**: Drag & Drop oder Klick zum Hochladen von HMQ-Beweissicherungsberichten
- **Partner-Branding**: Eingabe des Partner-Firmennamens
- **Logo-Integration**: Optionaler Upload eines Partner-Logos (PNG/JPG)
- **Sichere Verarbeitung**: Alle Daten werden lokal im Browser verarbeitet - keine Server-Übertragung
- **White-Label**: Entfernt HMQ-Branding durch überdeckende Elemente

## Tech Stack

- Next.js 14 (App Router)
- TypeScript (Strict Mode)
- pdf-lib für PDF-Manipulation
- Tailwind CSS

## Installation

```bash
npm install
```

## Entwicklung

```bash
npm run dev
```

Das Tool ist dann unter [http://localhost:3000](http://localhost:3000) erreichbar.

## Build

```bash
npm run build
```

## Deployment auf Vercel

1. Repository mit Vercel verbinden
2. Framework Preset: Next.js (automatisch erkannt)
3. Build-Einstellungen werden automatisch aus `next.config.js` übernommen
4. Deploy!

Das Projekt ist für Static Export konfiguriert (`output: 'export'`), was optimales Hosting auf Vercel ermöglicht.

## PDF-Koordinaten anpassen

Falls sich das Layout der Quell-PDFs ändert, können die Koordinaten in `src/config/pdf-positions.ts` angepasst werden:

```typescript
export const PDF_POSITIONS = {
  // Seite 1: Rechter Banner (komplette Höhe)
  page1Banner: {
    x: 496,
    y: 0,
    width: 99,
    height: 842
  },

  // Seite 2+: HMQ-Logo oben rechts
  headerLogo: {
    x: 533,
    y: 782,
    width: 62,
    height: 60
  },

  // Seite 1: Position für Partner-Logo
  partnerLogo: {
    x: 57,
    y: 750,
    maxWidth: 150,
    maxHeight: 60
  }
};
```

### Koordinatensystem

- PDF-Koordinaten haben den Ursprung (0,0) in der **unteren linken Ecke**
- A4-Format: 595 x 842 Punkte (1 Punkt = 1/72 Zoll)
- X-Achse: von links nach rechts
- Y-Achse: von unten nach oben

## Funktionsweise

### Seite 1
- Rechter Banner wird mit weissem Rechteck überdeckt (HMQ-Logo, Adressen, SGS-Logo)
- Partner-Logo wird oben links eingefügt (falls vorhanden)

### Seiten 2+
- HMQ-Logo oben rechts wird mit weissem Rechteck überdeckt

### Sicherheit
Die weissen Rechtecke werden direkt in den PDF-Inhaltsstrom geschrieben und sind keine separaten Annotationen. Mehrere überlappende Schichten erschweren das Entfernen mit PDF-Editoren.

## Hinweise

- **Text-Ersetzung**: Das Ersetzen von "HMQ AG" durch den Partner-Namen im PDF-Text ist technisch nicht möglich, da pdf-lib keinen Zugriff auf bestehende Textinhalte hat. Die PDF-Metadaten werden jedoch mit dem Partner-Namen aktualisiert.
- **Bildformate**: Unterstützt werden PNG und JPEG für das Partner-Logo
- **Datenschutz**: Alle Verarbeitung findet clientseitig statt - keine Daten verlassen den Browser

## Lizenz

Proprietär - Nur für internen Gebrauch bei HMQ AG
