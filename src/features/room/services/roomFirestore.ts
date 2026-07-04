import { doc } from 'firebase/firestore';
import { db } from '../../../services/firebase/firebaseDb';

export const ROOM_SUBCOLLECTIONS = ['actions', 'boardItems', 'players', 'seats', 'state', 'sequences', 'processedActions'] as const;
export const DELETE_BATCH_SIZE = 450;
const SEQUENCE_ID_PAD_LENGTH = 12;

export const makeSequenceDocId = (sequence: number) => String(sequence).padStart(SEQUENCE_ID_PAD_LENGTH, '0');

const hashFirestoreId = (value: string) => {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
};

export const makeFirestoreSafeId = (value: string) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return `action_${Date.now()}`;
  const readablePrefix = trimmedValue.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return `${readablePrefix || 'action'}_${hashFirestoreId(trimmedValue)}`;
};

export const getClientMutationDocRef = (roomId: string, clientMutationId: string) => doc(db!, 'rooms', roomId, 'processedActions', makeFirestoreSafeId(clientMutationId));

export const sanitizeForFirestore = (value: unknown): unknown => {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeForFirestore(entry));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, sanitizeForFirestore(entry)]));
};
