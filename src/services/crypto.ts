/**
 * Criptografia de credenciais usando Web Crypto API (AES-GCM + PBKDF2)
 * A chave é derivada do VITE_APP_SECRET — baked no build, nunca exposto no localStorage.
 */

const SALT = "jira-tracker-salt-v1";

async function getKey(): Promise<CryptoKey> {
  const secret =
    (import.meta.env.VITE_APP_SECRET as string | undefined) ??
    "default-dev-secret-replace-me";

  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(SALT),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Criptografa um texto e retorna base64(iv + ciphertext) */
export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return "";

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );

  // Junta IV (12 bytes) + ciphertext em um único Uint8Array
  const combined = new Uint8Array(12 + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), 12);

  // Converte para base64 de forma segura (evita spread de arrays grandes)
  let binary = "";
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

/** Descriptografa base64(iv + ciphertext) e retorna o texto original */
export async function decrypt(ciphertext: string): Promise<string> {
  if (!ciphertext) return "";

  try {
    const key = await getKey();
    const binary = atob(ciphertext);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    return new TextDecoder().decode(plainBuffer);
  } catch {
    // Se falhar (ex: token antigo não criptografado), retorna vazio
    return "";
  }
}
