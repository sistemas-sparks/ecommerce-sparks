// Link exclusivo do pedido (/pedido/[token]). O token vai só para o cliente; o banco guarda o hash
// HMAC-SHA256 com ORDER_TOKEN_PEPPER (secret do Worker). Vazamento do banco não revela os links.

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes aleatórios (256 bits) em base64url: 43 caracteres. */
export function generateOrderToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export const ORDER_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export async function hashOrderToken(token: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
