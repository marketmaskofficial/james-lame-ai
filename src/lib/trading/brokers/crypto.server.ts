/**
 * Envelope encryption for broker credentials.
 *
 * Broker credentials never leave the server: they are encrypted with AES-GCM
 * using BROKER_CRED_KEY and stored in `broker_connections.credentials_encrypted`,
 * a column the browser has no grant to read. Nothing here is ever logged.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(): Promise<CryptoKey> {
  const raw = process.env["BROKER_CRED_KEY"];
  if (!raw) throw new Error("Broker credential key is not configured on the server.");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export async function encryptJson(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(),
    enc.encode(JSON.stringify(value)),
  );
  return `v1.${b64(iv)}.${b64(ct)}`;
}

export async function decryptJson<T>(blob: string): Promise<T> {
  const [version, iv, ct] = blob.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Stored credentials are unreadable.");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) },
    await key(),
    unb64(ct),
  );
  return JSON.parse(dec.decode(pt)) as T;
}
