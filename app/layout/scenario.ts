export const SWITCH_BLACK_MS = 300
export const CLEAR_CROSSFADE_MS = 1000
export const DEFAULT_SWITCH_AT_MS = 12000

export type ScenarioName = 'switch' | 'ambient'

export interface ScenarioFrame {
  ambientVisible: boolean
  black: boolean
  alertVisible: boolean
  alertOpacity: number
  alertElapsedMs: number
}

const AMBIENT_ONLY: ScenarioFrame = {
  ambientVisible: true,
  black: false,
  alertVisible: false,
  alertOpacity: 0,
  alertElapsedMs: 0,
}

export function scenarioFrame(
  scenario: ScenarioName,
  t: number,
  switchAtMs: number,
  clearAtMs?: number,
): ScenarioFrame {
  if (scenario === 'ambient' || t < switchAtMs) return AMBIENT_ONLY
  const sinceSwitch = t - switchAtMs
  if (sinceSwitch < SWITCH_BLACK_MS) return { ...AMBIENT_ONLY, ambientVisible: false, black: true }
  const alertElapsedMs = sinceSwitch - SWITCH_BLACK_MS
  if (clearAtMs === undefined || t < clearAtMs) {
    return { ambientVisible: false, black: false, alertVisible: true, alertOpacity: 1, alertElapsedMs }
  }
  const fade = Math.min(1, (t - clearAtMs) / CLEAR_CROSSFADE_MS)
  if (fade >= 1) return AMBIENT_ONLY
  return { ambientVisible: true, black: false, alertVisible: true, alertOpacity: 1 - fade, alertElapsedMs }
}
