export interface StorageTextReader {
  getItem(key: string): string | null;
}

export function readStorageText(
  getStorage: () => StorageTextReader | null | undefined,
  key: string,
  fallback = '',
) {
  try {
    return getStorage()?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
