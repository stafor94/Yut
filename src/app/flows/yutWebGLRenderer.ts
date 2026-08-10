export function initializeYutWebGLRenderer<T>(createRenderer: () => T) {
  try {
    return { status: 'three' as const, renderer: createRenderer(), error: null };
  } catch (error) {
    return { status: 'fallback' as const, renderer: null, error };
  }
}
