import { CABINET_OFFICE_5, rgbCss } from '../../app/layout/palette'
import type { AlertLevel } from '../../app/layout/types'

export interface Alert {
  level?: AlertLevel
  issuedAt: string
  ja: string
  en: string
}

export interface Scenario {
  id: string
  placeJa: string
  placeEn: string
  date: string
  steps: { setId?: string; seconds: number }[]
}

// Issued times and names from sim/public/alert/sets.json; the bulletins themselves are the stills.
export const ALERTS: Record<string, Alert> = {
  'yurihonjo-lv3': { level: 3, issuedAt: '15:55', ja: '氾濫警報（子吉川）', en: 'Warning (Flood)' },
  'yurihonjo-lv4': { level: 4, issuedAt: '18:15', ja: '氾濫危険警報（子吉川）', en: 'Urgent Warning (Flood)' },
  'yurihonjo-lv5': { level: 5, issuedAt: '19:45', ja: '氾濫特別警報（子吉川）', en: 'Emergency Warning (Flood)' },
  'kashiwazaki-lv4': { level: 4, issuedAt: '16:53', ja: '土砂災害危険警報', en: 'Urgent Warning (Landslide)' },
  'yoshida-tsunami-drill': { issuedAt: '07:13', ja: '大津波警報（訓練）', en: 'Major Tsunami Warning (drill)' },
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'yurihonjo', placeJa: '由利本荘市', placeEn: 'Yurihonjo, Akita', date: '2026-10-21',
    steps: [{ seconds: 6 }, { setId: 'yurihonjo-lv3', seconds: 8 }, { setId: 'yurihonjo-lv4', seconds: 8 }, { setId: 'yurihonjo-lv5', seconds: 8 }],
  },
  {
    id: 'kashiwazaki', placeJa: '柏崎市', placeEn: 'Kashiwazaki, Niigata', date: '2026-10-31',
    steps: [{ seconds: 6 }, { setId: 'kashiwazaki-lv4', seconds: 10 }],
  },
  {
    id: 'yoshida', placeJa: '吉田町', placeEn: 'Yoshida, Shizuoka', date: '2016-09-01',
    steps: [{ seconds: 6 }, { setId: 'yoshida-tsunami-drill', seconds: 10 }],
  },
]

// A hidden tab stops requestAnimationFrame; the first frame back must not skip whole steps.
const MAX_STEP_MS = 100

function levelLabel(alert: Alert): { ja: string; en: string } {
  return alert.level ? { ja: `警戒レベル${alert.level}`, en: `Level ${alert.level}` } : { ja: '', en: '' }
}

function stepLabel(setId: string | undefined): string {
  if (!setId) return '平常時'
  const alert = ALERTS[setId]!
  return alert.level ? `Lv${alert.level} ${alert.issuedAt}` : alert.issuedAt
}

function setSwatch(element: HTMLElement, alert: Alert | undefined): void {
  element.hidden = !alert?.level
  if (alert?.level) element.style.background = rgbCss(CABINET_OFFICE_5[alert.level])
}

export function scenarioOf(setId: string): Scenario | undefined {
  return SCENARIOS.find((scenario) => scenario.steps.some((step) => step.setId === setId))
}

// The corner badge reads what the faces show, so the random set of [E] is named as well as the timeline's.
export function renderNow(root: HTMLElement, setId: string | undefined): void {
  const alert = setId ? ALERTS[setId] : undefined
  const scenario = setId ? scenarioOf(setId) : undefined
  setSwatch(root.querySelector<HTMLElement>('.swatch')!, alert)
  const level = alert ? levelLabel(alert) : undefined
  root.querySelector('.ja .label')!.textContent = alert ? `${level!.ja} ${alert.ja}`.trim() : '平常時'
  root.querySelector('.en')!.textContent = alert ? `${level!.en} ${alert.en}`.trim() : 'Normal'
  root.querySelector('.where')!.textContent = alert && scenario
    ? `${scenario.placeJa} ${scenario.placeEn} · ${scenario.date} ${alert.issuedAt} JST`
    : ''
}

export interface TimelineHandlers {
  onShow: (setId: string | undefined) => void
}

export class Timeline {
  private scenario = SCENARIOS[0]!
  private elapsedMs = 0
  private lastNowMs?: number
  private stepIndex = -1
  private playing = false
  private following = true
  private readonly track: HTMLElement
  private readonly fill: HTMLElement
  private readonly playButton: HTMLButtonElement
  private readonly caption: HTMLElement
  private segments: HTMLButtonElement[] = []

  constructor(root: HTMLElement, private readonly handlers: TimelineHandlers) {
    this.caption = root.querySelector('.caption')!
    this.playButton = root.querySelector<HTMLButtonElement>('.play')!
    this.track = root.querySelector('.track')!
    this.fill = root.querySelector('.fill')!
    const select = root.querySelector<HTMLSelectElement>('select')!
    for (const scenario of SCENARIOS) select.add(new Option(`${scenario.placeJa} ${scenario.date.slice(5).replace('-', '/')}`, scenario.id))
    select.addEventListener('change', () => this.selectScenario(select.value))
    this.playButton.addEventListener('click', () => (this.playing ? this.pause() : this.play()))
    this.buildSegments()
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get firstAlertStep(): number {
    return this.scenario.steps.findIndex((step) => step.setId)
  }

  play(): void {
    this.playing = true
    this.lastNowMs = undefined
    if (!this.following) this.jump(Math.max(0, this.stepIndex))
    this.renderControls()
  }

  pause(): void {
    this.playing = false
    this.renderControls()
  }

  // [E] puts a set on the faces that the timeline did not choose; the timeline lets go until it is played or jumped again.
  release(): void {
    this.pause()
    this.following = false
    this.stepIndex = -1
    this.renderControls()
  }

  jump(index: number): void {
    const steps = this.scenario.steps
    this.elapsedMs = steps.slice(0, index).reduce((sum, step) => sum + step.seconds * 1000, 0)
    this.following = true
    this.enter(index)
  }

  tick(nowMs: number): void {
    if (!this.playing) return
    const dt = this.lastNowMs === undefined ? 0 : Math.min(MAX_STEP_MS, nowMs - this.lastNowMs)
    this.lastNowMs = nowMs
    this.elapsedMs = (this.elapsedMs + dt) % this.totalMs()
    const index = this.indexAt(this.elapsedMs)
    if (index !== this.stepIndex) this.enter(index)
    this.fill.style.width = `${(100 * this.elapsedMs) / this.totalMs()}%`
  }

  private selectScenario(id: string): void {
    this.scenario = SCENARIOS.find((scenario) => scenario.id === id) ?? SCENARIOS[0]!
    this.stepIndex = -1
    this.buildSegments()
    this.jump(0)
  }

  private enter(index: number): void {
    this.stepIndex = index
    this.handlers.onShow(this.scenario.steps[index]!.setId)
    this.renderControls()
  }

  private totalMs(): number {
    return this.scenario.steps.reduce((sum, step) => sum + step.seconds * 1000, 0)
  }

  private indexAt(elapsedMs: number): number {
    let end = 0
    for (const [index, step] of this.scenario.steps.entries()) {
      end += step.seconds * 1000
      if (elapsedMs < end) return index
    }
    return this.scenario.steps.length - 1
  }

  private buildSegments(): void {
    for (const segment of this.segments) segment.remove()
    this.segments = this.scenario.steps.map((step, index) => {
      const button = document.createElement('button')
      button.textContent = stepLabel(step.setId)
      button.style.flexGrow = String(step.seconds)
      if (step.setId && ALERTS[step.setId]?.level) {
        const swatch = document.createElement('i')
        swatch.className = 'swatch'
        setSwatch(swatch, ALERTS[step.setId])
        button.prepend(swatch)
      }
      button.addEventListener('click', () => this.jump(index))
      this.track.insertBefore(button, this.fill)
      return button
    })
    this.renderControls()
  }

  private renderControls(): void {
    this.playButton.textContent = this.playing ? '❚❚' : '▶'
    this.playButton.setAttribute('aria-label', this.playing ? '一時停止 / Pause' : '再生 / Play')
    this.segments.forEach((segment, index) => segment.setAttribute('aria-pressed', String(index === this.stepIndex)))
    if (!this.following) this.fill.style.width = '0%'
    else if (!this.playing) this.fill.style.width = `${(100 * this.elapsedMs) / this.totalMs()}%`
    const setId = this.stepIndex >= 0 ? this.scenario.steps[this.stepIndex]!.setId : undefined
    const alert = setId ? ALERTS[setId] : undefined
    this.caption.textContent = !this.following
      ? `${this.scenario.placeJa} ${this.scenario.placeEn} · ${this.scenario.date}`
      : alert
        ? `${this.scenario.date} ${alert.issuedAt} JST 発表 ${alert.ja} / ${alert.en}`
        : `${this.scenario.placeJa} ${this.scenario.placeEn} · ${this.scenario.date} 平常時 / Normal`
  }
}
