interface ScheduleRequest extends AsyncIterable<Uint8Array | string> {
  method?: string
  headers?: { authorization?: string }
  body?: unknown
}

interface ScheduleResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export function scheduleHandler(
  req: ScheduleRequest,
  res: ScheduleResponse,
  config: { supabaseUrl?: string; supabaseKey?: string; now?: string | Date },
  fetcher?: typeof fetch,
): Promise<void>
