// The GitHub Pages build has no server: /screen reads the JSON that sim/scripts/static-screen.mjs wrote
// under public/static/, one file per query, named by the same key on both sides.
export function staticKey(params: URLSearchParams): string {
  return params.toString().replace(/[^A-Za-z0-9.-]+/g, '_')
}

export function useStaticScreen() {
  const config = useRuntimeConfig()
  // Nuxt parses the env value, so '1' arrives as the number 1.
  const enabled = String(config.public.staticScreen) === '1'
  const url = (kind: 'replay' | 'live-layout', params: URLSearchParams) => `${config.app.baseURL}static/${kind}/${staticKey(params)}.json`
  return { enabled, url }
}
