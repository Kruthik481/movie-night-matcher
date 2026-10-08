const key = (code: string) => `mnm:session:${code}`;

export function loadSession(code: string): string | null {
  try {
    return localStorage.getItem(key(code));
  } catch {
    return null; // storage blocked (private mode): the visitor joins again
  }
}

export function saveSession(code: string, token: string): void {
  try {
    localStorage.setItem(key(code), token);
  } catch {
    // storage blocked: the session lives only as long as this tab's React state
  }
}

export function clearSession(code: string): void {
  try {
    localStorage.removeItem(key(code));
  } catch {
    // storage blocked: nothing was stored
  }
}
