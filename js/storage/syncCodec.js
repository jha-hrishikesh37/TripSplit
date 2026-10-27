import { CONFIG } from '../config.js';

export function generateId(prefix = 'id') {
  const rand = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

// Unicode-safe Base64 encoding/decoding for compact WhatsApp sync strings
export function encodePayloadToBase64(obj) {
  const jsonStr = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(jsonStr);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return CONFIG.SYNC_PREFIX + btoa(binary);
}

export function decodePayloadFromBase64(rawInput) {
  let cleaned = rawInput.trim();
  // Extract code if user pasted a full URL containing #sync=... or ?sync=...
  const syncParamMatch = cleaned.match(/[?#&]sync=([A-Za-z0-9+/=_:%-]+)/);
  if (syncParamMatch) {
    cleaned = decodeURIComponent(syncParamMatch[1]);
  }
  if (cleaned.startsWith(CONFIG.SYNC_PREFIX)) {
    cleaned = cleaned.slice(CONFIG.SYNC_PREFIX.length);
  }
  // Also support raw JSON if someone pasted JSON content directly
  if (cleaned.startsWith('{')) {
    return JSON.parse(cleaned);
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr);
}

// Export a single trip into a compact sync payload (includes soft-deleted tombstones)
export function exportTripPayload(trip) {
  return {
    type: 'TRIPSPLIT_SYNC_V1',
    exportedAt: Date.now(),
    trip: JSON.parse(JSON.stringify(trip))
  };
}
