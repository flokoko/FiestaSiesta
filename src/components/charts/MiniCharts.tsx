/**
 * MiniCharts — Diagramm-Trio für den Bristol-Screen, ohne Diagrammbibliothek.
 *
 * Warum eigene SVG-Komponenten: die Diagrammbibliothek zog einen ~420-kB-Chunk in den
 * Bristol-Screen nach sich, für Balkenverteilung, 14-Tage-Trend und
 * Tagesverlauf gibt es davon nichts zu kaufen — ein paar SVG-Elemente tun es
 * auch. Gestalterische Grundregeln:
 *
 *  - Schrift (Ticks, Wert-Labels, Legende) steht NIE in der gestreckten
 *    Fläche: Pfad-Geometrie läuft über viewBox + preserveAspectRatio="none"
 *    (füllt die Containerbreite), Text und Punkte liegen in einem zweiten,
 *    ungestreckten SVG-Overlay mit %-Koordinaten.
 *  - vector-effect="non-scaling-stroke" hält Liniendicken konstant, egal
 *    wie stark die x-Achse gestreckt ist.
 *  - Tooltips sind native <title>-Elemente — kein Hover-State, kein Portal.
 *  - Keine Hooks, keine Library: die Komponenten sind zustandslos und
 *    rechnen alles aus ihren Props.
 */

import type { CSSProperties } from 'react'

// Auf zwei Nachkommastellen runden — hält das Pfad-d und das DOM klein.
const r2 = (n: number) => Math.round(n * 100) / 100

// ── Geometrie-Helfer ──────────────────────────────────────────────────────

/** Ganzzahlige Ticks zwischen min und max; Schritt so groß wie nötig (~6 Linien). */
function intTicks(min: number, max: number): number[] {
  if (max <= min) return [max]
  const step = Math.max(1, Math.ceil((max - min) / 6))
  const out: number[] = []
  for (let t = min; t <= max; t += step) out.push(t)
  if (out[out.length - 1] !== max) out.push(max)
  return out
}

/** max. 6 x-Ticks: bei 14 Tagen jeder dritte Index ein Label. */
function tickStride(count: number, max = 6): number {
  return Math.max(1, Math.ceil(count / max))
}

/**
 * Lückenlose Index-Runs: null/NaN unterbricht — die Linie wird aufgeteilt
 * und springt NICHT über die Lücke (anders als das frühere connectNulls:
 * ein Tag ohne Eintrag liest sich so als Pause, nicht als Wert).
 */
function gapFreeRuns(values: Array<number | null>): number[][] {
  const runs: number[][] = []
  let cur: number[] = []
  values.forEach((v, i) => {
    if (v === null || Number.isNaN(v)) {
      if (cur.length > 0) runs.push(cur)
      cur = []
    } else {
      cur.push(i)
    }
  })
  if (cur.length > 0) runs.push(cur)
  return runs
}

/**
 * Sanfte Interpolation ohne Library: Catmull-Rom-Punkte direkt als kubische
 * Bézier-Segmente ausgeben (grob das, was früher "monotone" tat). Eine Reihe
 * aus einem einzelnen Punkt ergibt '' — dann kommt nur der Kreis unten.
 */
function catmullRomPath(pts: Array<readonly [number, number]>): string {
  if (pts.length < 2) return ''
  let d = `M ${r2(pts[0][0])} ${r2(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    // Randpunkte duplizieren, damit die Tangenten an den Enden flach bleiben
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${r2(c1x)} ${r2(c1y)}, ${r2(c2x)} ${r2(c2y)}, ${r2(p2[0])} ${r2(p2[1])}`
  }
  return d
}

// ── 1) BarSeries: vertikale Balken (Verteilung der Bristol-Werte) ─────────

export interface BarPoint {
  /** x-Beschriftung (Bristol-Wert, z. B. „4“) */
  label: string
  /** Balkenhöhe (Anzahl Einträge) */
  value: number
  /** nativer Browser-Tooltip (<title>) */
  tooltip?: string
  /** Balkenfarbe; ohne Angabe gilt die Akzentfarbe für alle */
  color?: string
}

interface BarSeriesProps {
  points: BarPoint[]
  /** fixe SVG-Höhe in px; die Breite füllt immer der Container */
  height?: number
  color?: string
  ariaLabel?: string
}

export function BarSeries({ points, height = 180, color = 'var(--accent)', ariaLabel }: BarSeriesProps) {
  const n = points.length
  if (n === 0) return null

  // y-Ticks ganzzahlig ab 0 (Anzahl-Achse); die alte Bibliothek zeigte hier ebenfalls ~5 Ticks
  const top = Math.max(1, ...points.map(p => p.value))
  const yTicks = intTicks(0, top)
  const yMaxTick = yTicks[yTicks.length - 1]

  // Plotbereich: unten Band für x-Labels, oben Platz fürs Wert-Label
  const plotTop = 18
  const plotBottom = height - 16
  const plotH = plotBottom - plotTop
  const yPos = (v: number) => plotBottom - (v / yMaxTick) * plotH

  // Spalten in Prozent: die Breite skaliert mit dem Container, ohne dass
  // die Schrift mitgestreckt wird (Text liegt in echtem px im selben SVG)
  const padL = 9 // % links für die y-Beschriftung
  const colW = (100 - padL) / n
  // Obergrenze ≈ 24 px auf Handybreite, wie das alte maxBarSize
  const barW = Math.min(colW * 0.6, 9)

  return (
    <div className="mini-chart" role="img" aria-label={ariaLabel}>
      <svg width="100%" height={height} aria-hidden="true">
        {/* dezente y-Gitterlinien */}
        {yTicks.map(t => (
          <line
            key={`grid-${t}`}
            className="mini-grid"
            x1={`${padL}%`}
            x2="100%"
            y1={r2(yPos(t))}
            y2={r2(yPos(t))}
          />
        ))}
        {points.map((p, i) => {
          const cx = padL + (i + 0.5) * colW
          if (p.value <= 0) return null // leerer Wert: weder Balken noch Label
          const y0 = r2(yPos(p.value))
          return (
            <g key={p.label}>
              {/* rx 3 = runde Balkenköpfe; unten rundet mit, auf der Basislinie fällt das nicht auf */}
              <rect
                className="mini-bar"
                style={{ '--i': i } as CSSProperties}
                x={`${r2(cx - barW / 2)}%`}
                y={y0}
                width={`${r2(barW)}%`}
                height={r2(plotBottom - y0)}
                rx={3}
                fill={p.color ?? color}
              >
                <title>{p.tooltip ?? `${p.label}: ${p.value}`}</title>
              </rect>
              {/* Wert über dem Balken — nur, wenn es einen gibt */}
              <text className="mini-value" x={`${r2(cx)}%`} y={y0 - 4} textAnchor="middle">
                {p.value}
              </text>
            </g>
          )
        })}
        {/* x-Beschriftung: Werte-Achse mit ≤ 8 einstelligen Labels — jede Spalte
            beschriften, sonst verliert man die 1:1-Zuordnung Wert → Balken. Die
            max-6-Ticks-Regel gilt für die Zeitachsen (TrendLine/MultiLine),
            wo der Ticktext viel Platz frisst. */}
        {points.map((p, i) => (
          <text
            key={`x-${p.label}`}
            className="mini-tick"
            x={`${r2(padL + (i + 0.5) * colW)}%`}
            y={height - 4}
            textAnchor="middle"
          >
            {p.label}
          </text>
        ))}
        {/* y-Beschriftung links, rechtsbündig an die Gutter-Kante */}
        {yTicks.map(t => (
          <text
            key={`y-${t}`}
            className="mini-tick"
            x={`${padL - 1}%`}
            y={r2(yPos(t)) + 3}
            textAnchor="end"
          >
            {t}
          </text>
        ))}
      </svg>
    </div>
  )
}

// ── 2) TrendLine: Durchschnitt über die letzten 14 Tage ───────────────────

export interface TrendPoint {
  /** x-Beschriftung (TT.MM) */
  label: string
  /** null = Tag ohne Eintrag → Lücke im Pfad */
  value: number | null
  /** nativer Browser-Tooltip (<title>) */
  tooltip?: string
}

interface TrendLineProps {
  points: TrendPoint[]
  height?: number
  color?: string
  yMin?: number
  yMax: number
  /** feste y-Ticks; ohne Angabe rechnet die Komponente welche */
  yTicks?: number[]
  ariaLabel?: string
}

export function TrendLine({
  points,
  height = 180,
  color = 'var(--accent)',
  yMin = 1,
  yMax,
  yTicks,
  ariaLabel,
}: TrendLineProps) {
  const n = points.length
  if (n === 0) return null

  const padL = 9 // % links für die y-Beschriftung
  const padR = 2 // % Rand rechts, damit der letzte Punkt nicht an der Kante klebt
  const plotTop = 8
  const plotBottom = height - 16
  const plotH = plotBottom - plotTop

  // n === 1 absichern: sonst Division durch 0
  const xUnit = 1 / Math.max(1, n - 1)
  const xPos = (i: number) => padL + i * xUnit * (100 - padL - padR)
  const yPos = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * plotH

  const ticks = yTicks ?? intTicks(yMin, yMax)

  // max. 6 x-Ticks: bei 14 Tagen jeder dritte; das letzte Datum immer zeigen
  const stride = tickStride(n)
  const showXAt = (i: number) => i % stride === 0 || i === n - 1

  // Lückenwerte splitten den Pfad — keine Linie über einen Tag ohne Eintrag
  const runs = gapFreeRuns(points.map(p => p.value))

  return (
    <div className="mini-chart" role="img" aria-label={ariaLabel}>
      {/* gestreckte Fläche: nur Pfad-Geometrie, keine Schrift */}
      <svg
        className="mini-stretch"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {runs.map(run => {
          const pts = run.map(
            i => [xPos(i), yPos(points[i].value ?? yMin)] as const,
          )
          const d = catmullRomPath(pts)
          if (!d) return null // isolierter Punkt: unten kommt nur der Kreis
          return (
            <path
              key={`seg-${run[0]}`}
              className="mini-line"
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </svg>
      {/* ungestrecktes Overlay: Punkte, Gitter, Ticks in fester Größe */}
      <svg width="100%" height={height} aria-hidden="true">
        {ticks.map(t => (
          <line
            key={`grid-${t}`}
            className="mini-grid"
            x1={`${padL}%`}
            x2="100%"
            y1={r2(yPos(t))}
            y2={r2(yPos(t))}
          />
        ))}
        {/* Punkte mit nativem Tooltip — nur an echten Messwerten */}
        {points.map((p, i) =>
          p.value === null ? null : (
            <circle
              key={`dot-${p.label}`}
              cx={`${r2(xPos(i))}%`}
              cy={r2(yPos(p.value))}
              r={3}
              fill={color}
            >
              <title>{p.tooltip ?? `${p.label}: ${p.value}`}</title>
            </circle>
          ),
        )}
        {ticks.map(t => (
          <text
            key={`y-${t}`}
            className="mini-tick"
            x={`${padL - 1}%`}
            y={r2(yPos(t)) + 3}
            textAnchor="end"
          >
            {t}
          </text>
        ))}
        {points.map((p, i) =>
          showXAt(i) ? (
            <text
              key={`x-${p.label}`}
              className="mini-tick"
              x={`${r2(xPos(i))}%`}
              y={height - 4}
              textAnchor="middle"
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  )
}

// ── 3) MultiLine: Tagesverlauf, eine Linie pro Teilnehmer ─────────────────

export interface MultiRow {
  /** x-Beschriftung (Uhrzeit HH:MM) */
  label: string
  /** indexiert wie `series`; null = dieser Teilnehmer hat zu der Zeit keinen Eintrag */
  values: Array<number | null>
}

export interface MultiSeriesDef {
  name: string
}

// Feste Palette (max. 4) — die ersten vier Farben des alten Farbenrades
const SERIES_PALETTE = ['#F1BF00', '#AA151B', '#1e90ff', '#ff8c00']

/**
 * Farbe einer Linie/des Legendpunkts nach Teilnehmer-Index. Mehr als vier
 * Teilnehmer teilen sich var(--accent) statt einer fünften Palette-Farbe.
 */
export function seriesColor(i: number): string {
  return i < SERIES_PALETTE.length ? SERIES_PALETTE[i] : 'var(--accent)'
}

interface MultiLineProps {
  rows: MultiRow[]
  series: MultiSeriesDef[]
  height?: number
  /** Mindest-Deckel der y-Skala (8, bzw. 14 wenn Mega-Plasma freigeschaltet) */
  yMaxFloor?: number
  ariaLabel?: string
}

export function MultiLine({
  rows,
  series,
  height = 150,
  yMaxFloor = 8,
  ariaLabel,
}: MultiLineProps) {
  if (rows.length === 0 || series.length === 0) return null

  // y-Skala: Deckel mindestens Floor, sonst Maximum gerundet + 1 Puffer
  // (gleiche Semantik wie die frühere Domain-Funktion)
  let dataMax = 0
  rows.forEach(r => r.values.forEach(v => { if (v !== null && v > dataMax) dataMax = v }))
  const yMax = Math.max(yMaxFloor, Math.ceil(dataMax) + 1)
  const yMin = 0

  const padL = 9 // % links für die y-Beschriftung
  const padR = 3 // % Rand rechts (die alte Bibliothek hatte hier 14 px Padding)
  const plotTop = 8
  const plotBottom = height - 16
  const plotH = plotBottom - plotTop

  const xUnit = 1 / Math.max(1, rows.length - 1) // eine Zeile absichern
  const xPos = (i: number) => padL + i * xUnit * (100 - padL - padR)
  const yPos = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * plotH

  const yTicks = intTicks(yMin, yMax)

  // max. 6 x-Ticks über die Uhrzeiten; die letzte Zeit immer zeigen
  const stride = tickStride(rows.length)
  const showXAt = (i: number) => i % stride === 0 || i === rows.length - 1

  return (
    <div className="mini-chart" role="img" aria-label={ariaLabel}>
      {/* gestreckte Fläche nur für die Linienpfade */}
      <svg
        className="mini-stretch"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {series.map((s, si) => {
          const c = seriesColor(si)
          const col = rows.map(r => r.values[si] ?? null)
          // Lücken pro Teilnehmer einzeln splitten — wer zu einer Zeit keinen
          // Eintrag hat, wird nicht über die Lücke hinweg verbunden
          return gapFreeRuns(col).map(run => {
            const pts = run.map(
              i => [xPos(i), yPos(col[i] ?? yMin)] as const,
            )
            const d = catmullRomPath(pts)
            if (!d) return null
            return (
              <path
                key={`line-${s.name}-${run[0]}`}
                className="mini-line"
                d={d}
                fill="none"
                stroke={c}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })
        })}
      </svg>
      {/* ungestrecktes Overlay: Punkte, Gitter, Ticks in fester Größe */}
      <svg width="100%" height={height} aria-hidden="true">
        {yTicks.map(t => (
          <line
            key={`grid-${t}`}
            className="mini-grid"
            x1={`${padL}%`}
            x2="100%"
            y1={r2(yPos(t))}
            y2={r2(yPos(t))}
          />
        ))}
        {series.map((s, si) => {
          const c = seriesColor(si)
          return rows.map((row, ri) => {
            const v = row.values[si] ?? null // undefined (falsch ausgerichtete Reihen) wie null behandeln
            if (v === null) return null
            return (
              <circle
                key={`dot-${s.name}-${row.label}`}
                cx={`${r2(xPos(ri))}%`}
                cy={r2(yPos(v))}
                r={4.5}
                fill={c}
                /* gefüllte Punkte: bei nur einem Eintrag pro Person gibt es
                   keine Linie, nur den Punkt — weiß gefüllt wäre er unsichtbar */
              >
                <title>{`${row.label} · ${s.name}: ${v}`}</title>
              </circle>
            )
          })
        })}
        {yTicks.map(t => (
          <text
            key={`y-${t}`}
            className="mini-tick"
            x={`${padL - 1}%`}
            y={r2(yPos(t)) + 3}
            textAnchor="end"
          >
            {t}
          </text>
        ))}
        {rows.map((row, i) =>
          showXAt(i) ? (
            <text
              key={`x-${row.label}`}
              className="mini-tick"
              x={`${r2(xPos(i))}%`}
              y={height - 4}
              textAnchor="middle"
            >
              {row.label}
            </text>
          ) : null,
        )}
      </svg>
      {/* kleine Legende: farbige Punkte + Name */}
      <div className="mini-legend">
        {series.map((s, i) => (
          <span key={s.name} className="mini-legend-item">
            <span className="mini-legend-dot" style={{ background: seriesColor(i) }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}
