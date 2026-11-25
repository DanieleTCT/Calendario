interface GoogleCalendarRequest extends AsyncIterable<Uint8Array | string> {
  method?: string
  url?: string
  headers?: { authorization?: string }
  body?: unknown
}

interface GoogleCalendarResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

interface GoogleCalendarConfig {
  supabaseUrl?: string
  supabaseKey?: string
  serviceRoleKey?: string
  googleClientId?: string
  googleClientSecret?: string
  googleRedirectUri?: string
  oauthStateSecret?: string
  tokenEncryptionKey?: string
  appUrl?: string
}

export function googleCalendarHandler(
  req: GoogleCalendarRequest,
  res: GoogleCalendarResponse,
  config: GoogleCalendarConfig,
  fetcher?: typeof fetch,
): Promise<void>
