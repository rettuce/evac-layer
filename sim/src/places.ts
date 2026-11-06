import { CABINET_OFFICE_5, rgbCss } from '../../app/layout/palette'
import { ALERTS, addPlaceVariant, scenarioOf } from './timeline'

const BASE_SET = 'yurihonjo-lv4'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface SiteRecord {
  slug: string
  setId: string
  ja: string
  en: string
  direction: string
  directionEn: string
  distanceM: number
  at: [number, number]
  shelter: { name: string; at: [number, number] }
}

interface SitesFile {
  map: { src: string; width: number; height: number; credit: string }
  sites: SiteRecord[]
}

// The place whose screens are on the faces: Lv3 and Lv5 exist only for the station, so they light its pin.
export function placeOf(setId: string | undefined): string | undefined {
  if (!setId || scenarioOf(setId)?.id !== 'yurihonjo') return undefined
  return ALERTS[setId]?.base ? setId : BASE_SET
}

export interface Places {
  show: (setId: string | undefined) => void
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

// sim/public/sites/ is written by sim/scripts/site-alerts.mjs: the map of the four demo sites and where each one sends people.
export async function loadPlaces(root: HTMLElement, onPick: (setId: string) => void): Promise<Places | undefined> {
  const base = `${import.meta.env.BASE_URL}sites/`
  const response = await fetch(`${base}sites.json`)
  if (!response.ok) return undefined
  const { map, sites } = (await response.json()) as SitesFile
  for (const site of sites) {
    if (site.setId === BASE_SET) continue
    addPlaceVariant(site.setId, BASE_SET, site.ja, { name: site.shelter.name, direction: site.direction, directionEn: site.directionEn, distanceM: site.distanceM })
  }

  const frame = root.querySelector<HTMLElement>('.map')!
  const image = frame.querySelector('img')!
  image.src = `${base}${map.src}`
  root.querySelector('.credit')!.textContent = map.credit
  const drawing = svg('svg', { viewBox: `0 0 ${map.width} ${map.height}` })
  frame.querySelector('svg')!.replaceWith(drawing)
  const route = svg('g', {})
  drawing.appendChild(route)

  const buttons = root.querySelector<HTMLElement>('.buttons')!
  const pins = new Map<string, SVGCircleElement>()
  const byButton = new Map<string, HTMLButtonElement>()
  for (const site of sites) {
    const pin = svg('circle', { cx: site.at[0], cy: site.at[1], r: 15, class: 'pin' })
    pin.addEventListener('click', () => onPick(site.setId))
    pin.appendChild(svg('title', {})).textContent = `${site.ja} / ${site.en}`
    drawing.appendChild(pin)
    pins.set(site.setId, pin)
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = site.ja
    button.title = site.en
    button.addEventListener('click', () => onPick(site.setId))
    buttons.appendChild(button)
    byButton.set(site.setId, button)
  }

  const show = (setId: string | undefined) => {
    const chosen = sites.find((site) => site.setId === setId)
    for (const [id, button] of byButton) button.setAttribute('aria-pressed', String(id === chosen?.setId))
    for (const [id, pin] of pins) {
      pin.classList.toggle('chosen', id === chosen?.setId)
      pin.style.fill = id === chosen?.setId ? rgbCss(CABINET_OFFICE_5[4]) : ''
    }
    route.replaceChildren()
    if (!chosen) return
    route.appendChild(svg('line', { x1: chosen.at[0], y1: chosen.at[1], x2: chosen.shelter.at[0], y2: chosen.shelter.at[1], class: 'route' }))
    route.appendChild(svg('rect', { x: chosen.shelter.at[0] - 12, y: chosen.shelter.at[1] - 12, width: 24, height: 24, class: 'shelter' }))
  }
  return { show }
}
