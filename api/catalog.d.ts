interface CatalogRequest { method?: string; url?: string; headers?: { authorization?: string } }
interface CatalogResponse {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}
export function catalogHandler(req: CatalogRequest, res: CatalogResponse, config: {
  token?: string; supabaseUrl?: string; supabaseKey?: string
}): Promise<void>
