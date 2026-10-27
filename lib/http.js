export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export async function sha16(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// salted so the stored value can't be turned back into an address
export const ipHash = (request, env) =>
  sha16((env.IP_SALT || 'drift-sea') + '|' + (request.headers.get('cf-connecting-ip') || 'local'));

export const ID_RE = /^[a-z0-9]{6,24}$/;
export const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;
