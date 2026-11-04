import type { SkyTone } from '../lib/liveWeather'

/**
 * Animierte Wetter-Szene für die Heute-Karte: Sonne mit langsam drehenden
 * Strahlen, treibende Wolken, fallende Tropfen, Schneeflocken, Nebelbänder
 * und ein Wetterleuchten bei Gewitter. Reines SVG + CSS — kein Canvas,
 * keine Bilder, damit die Karte offline und in jedem Renderer gleich aussieht.
 *
 * `prefers-reduced-motion` schaltet alle Bewegungen ab (siehe
 * TodayWeather.css) — dann bleibt eine ruhige, korrekte Szene stehen.
 */

interface CloudSpec {
  x: number
  y: number
  s: number
  /** Sekunden Versatz, damit nicht alle Wolken synchron treiben */
  delay: number
  back?: boolean
}

const CLOUDS: Record<SkyTone, CloudSpec[]> = {
  clear: [],
  partly: [
    { x: 16, y: 18, s: 0.72, delay: -2.4, back: true },
    { x: 42, y: 72, s: 0.96, delay: -0.6 },
  ],
  cloudy: [
    { x: 8, y: 14, s: 0.9, delay: -3.4, back: true },
    { x: 62, y: 58, s: 1.05, delay: -1.2 },
    { x: 96, y: 10, s: 0.7, delay: -5.1, back: true },
  ],
  fog: [
    { x: 16, y: 12, s: 0.85, delay: -1.6, back: true },
    { x: 74, y: 34, s: 0.95, delay: -4.2 },
  ],
  rain: [
    { x: 14, y: 18, s: 0.92, delay: -2.8, back: true },
    { x: 66, y: 30, s: 1.06, delay: -0.9 },
  ],
  snow: [
    { x: 20, y: 20, s: 0.9, delay: -3.2, back: true },
    { x: 70, y: 30, s: 1.05, delay: -1.1 },
  ],
  storm: [
    { x: 10, y: 12, s: 0.95, delay: -3.8, back: true },
    { x: 58, y: 24, s: 1.1, delay: -0.4 },
  ],
}

function Cloud({ spec }: { spec: CloudSpec }) {
  return (
    <g transform={`translate(${spec.x} ${spec.y}) scale(${spec.s})`} opacity={spec.back ? 0.62 : 1}>
      <g className="wx-cloud-drift" style={{ animationDelay: `${spec.delay}s` }}>
        <circle cx="26" cy="27" r="13" fill="url(#wx-cloud-grad)" />
        <circle cx="47" cy="18" r="19" fill="url(#wx-cloud-grad)" />
        <circle cx="68" cy="27" r="13" fill="url(#wx-cloud-grad)" />
        <rect x="26" y="25" width="42" height="15" rx="7.5" fill="url(#wx-cloud-grad)" />
      </g>
    </g>
  )
}

export default function WeatherScene({ tone, isDay }: { tone: SkyTone; isDay: boolean }) {
  const night = !isDay
  const sun = !night && (tone === 'clear' || tone === 'partly')
  const moon = night && tone !== 'storm' && tone !== 'rain'
  const drops = tone === 'rain' || tone === 'storm'
  const flakes = tone === 'snow'
  const fog = tone === 'fog'
  const stars = night && (tone === 'clear' || tone === 'partly')

  return (
    <div className={`wx-scene is-${tone}${night ? ' is-night' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <radialGradient id="wx-sun-grad" cx="42%" cy="38%" r="62%">
            <stop offset="0%" stopColor="#FFF6CE" />
            <stop offset="55%" stopColor="#FFD976" />
            <stop offset="100%" stopColor="#FFB347" />
          </radialGradient>
          <radialGradient id="wx-sun-halo">
            <stop offset="0%" stopColor="rgba(255, 226, 150, 0.85)" />
            <stop offset="60%" stopColor="rgba(255, 206, 120, 0.28)" />
            <stop offset="100%" stopColor="rgba(255, 206, 120, 0)" />
          </radialGradient>
          <radialGradient id="wx-moon-halo">
            <stop offset="0%" stopColor="rgba(255, 244, 210, 0.5)" />
            <stop offset="70%" stopColor="rgba(255, 244, 210, 0.12)" />
            <stop offset="100%" stopColor="rgba(255, 244, 210, 0)" />
          </radialGradient>
          {/* Wolken mit heller Oberseite und leicht grauer Unterseite — flach
              gefüllt sehen sie wie Aufkleber aus. Die Stop-Farben setzt das CSS
              aus der Wetterlage (Tag/Nacht/Regen). */}
          <linearGradient id="wx-cloud-grad" gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="42">
            <stop className="wx-cloud-top" offset="0%" />
            <stop className="wx-cloud-bottom" offset="100%" />
          </linearGradient>
          <mask id="wx-moon-mask">
            <rect x="0" y="0" width="200" height="150" fill="#fff" />
            <circle cx="144" cy="39" r="16.5" fill="#000" />
          </mask>
        </defs>

        {stars && (
          <g className="wx-stars">
            <circle cx="26" cy="24" r="1.5" style={{ animationDelay: '0s' }} />
            <circle cx="58" cy="52" r="1.2" style={{ animationDelay: '-1.1s' }} />
            <circle cx="96" cy="18" r="1.7" style={{ animationDelay: '-2.2s' }} />
            <circle cx="124" cy="96" r="1.2" style={{ animationDelay: '-0.6s' }} />
            <circle cx="178" cy="118" r="1.4" style={{ animationDelay: '-1.7s' }} />
            <circle cx="148" cy="12" r="1.1" style={{ animationDelay: '-2.8s' }} />
          </g>
        )}

        {sun && (
          <g className="wx-sun">
            <circle className="wx-sun-halo" cx="134" cy="46" r="50" fill="url(#wx-sun-halo)" />
            <g className="wx-sun-rays">
              {Array.from({ length: 8 }).map((_, i) => {
                const angle = (i * Math.PI) / 4
                const r1 = 23
                const r2 = i % 2 === 0 ? 34 : 30
                const cx = 134
                const cy = 46
                return (
                  <line
                    key={i}
                    x1={cx + Math.cos(angle) * r1}
                    y1={cy + Math.sin(angle) * r1}
                    x2={cx + Math.cos(angle) * r2}
                    y2={cy + Math.sin(angle) * r2}
                  />
                )
              })}
            </g>
            <circle className="wx-sun-core" cx="134" cy="46" r="19" fill="url(#wx-sun-grad)" />
          </g>
        )}

        {moon && (
          <g className="wx-moon">
            <circle cx="132" cy="46" r="44" fill="url(#wx-moon-halo)" />
            <circle className="wx-moon-core" cx="132" cy="46" r="17" fill="#FFF3CE" mask="url(#wx-moon-mask)" />
          </g>
        )}

        {CLOUDS[tone].map((spec, i) => (
          <g key={`${tone}-${i}`} className="wx-cloud">
            <Cloud spec={spec} />
          </g>
        ))}

        {drops && (
          <g className="wx-rain">
            {Array.from({ length: 12 }).map((_, i) => (
              <line
                key={i}
                x1={52 + i * 9}
                y1={78}
                x2={46 + i * 9}
                y2={96}
                style={{ animationDelay: `${(i % 4) * 0.24 + (tone === 'storm' ? 0.1 : 0)}s` }}
              />
            ))}
          </g>
        )}

        {flakes && (
          <g className="wx-snow">
            {Array.from({ length: 7 }).map((_, i) => (
              <circle
                key={i}
                cx={58 + i * 13}
                cy={84 + (i % 3) * 6}
                r={i % 2 === 0 ? 2.4 : 1.8}
                style={{ animationDelay: `${(i % 5) * 0.7}s` }}
              />
            ))}
          </g>
        )}

        {fog && (
          <g className="wx-fog">
            <rect x="54" y="86" width="112" height="7" rx="3.5" style={{ animationDelay: '0s' }} />
            <rect x="30" y="102" width="136" height="7" rx="3.5" style={{ animationDelay: '-2.4s' }} />
            <rect x="66" y="118" width="104" height="7" rx="3.5" style={{ animationDelay: '-4.1s' }} />
          </g>
        )}

        {tone === 'storm' && (
          <g className="wx-bolt">
            <polygon points="126,66 110,102 123,102 112,136 138,92 124,92 134,66" />
          </g>
        )}
      </svg>
    </div>
  )
}
