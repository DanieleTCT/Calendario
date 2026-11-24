type LocalUser = { id: string; email?: string | null }

export async function handleLocalDatabaseRequest(_request: Request, _user: LocalUser | null) {
  return new Response(JSON.stringify({
    code: 'LOCAL_DATABASE_DISABLED',
    message: 'Il database locale è disponibile solo durante npm run dev.',
  }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export async function mirrorRemoteResponse(_tableName: string, _method: string, _data: unknown) {}

export async function synchronizeLocalDatabase(
  _url: string,
  _apiKey: string,
  _accessToken: string,
  _user: LocalUser,
  _onProgress?: (message: string) => void,
): Promise<{ discardedLockedChanges: number }> {
  throw new Error('Il database locale è disponibile solo durante npm run dev.')
}
