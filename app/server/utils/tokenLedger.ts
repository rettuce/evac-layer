import { join } from 'node:path'
import { type TokenLedger, holdsFacilities, tokenLedgerFrom } from './adminPolicy'

let reportedBroken = false

// Read on every request so that a token revoked with the CLI stops working at once, without a restart.
export async function readTokenLedger(): Promise<TokenLedger> {
  let ledger: TokenLedger
  try {
    ledger = tokenLedgerFrom(await readJsonIfExists<unknown>(join(dataDir(), 'tokens.json')))
  } catch {
    ledger = 'broken'
  }
  if (ledger === 'broken' && !reportedBroken) console.warn('[admin] data/tokens.json cannot be read as a token ledger: facility tokens and loopback access are off until it is fixed')
  reportedBroken = ledger === 'broken'
  return ledger
}

export async function isMultiFacilityServer(): Promise<boolean> {
  return holdsFacilities(await readTokenLedger())
}
