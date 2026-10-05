export function withAuthorStorageError<T>(operation: () => T, failure: (missing: boolean) => Error): T {
  try {
    return operation()
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string' || !/^E[A-Z0-9]+$/.test(error.code)) throw error
    throw failure(error.code === 'ENOENT')
  }
}

export function parseAuthorJson(text: string, failure: () => Error): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw failure()
  }
}

export function parseAuthorUrl(text: string, failure: () => Error): URL {
  try {
    return new URL(text)
  } catch (error) {
    if (!(error instanceof TypeError) || !('code' in error) || error.code !== 'ERR_INVALID_URL') throw error
    throw failure()
  }
}
