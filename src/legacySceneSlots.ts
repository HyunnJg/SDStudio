type SlotInspection =
  | { ok: true; count: number; slots: string[][] }
  | {
      ok: false;
      error: 'PROJECT_INPUT' | 'PROJECT_LEGACY_SCENE' | 'PROJECT_LIMIT';
    };

export default function inspectLegacySlots(value: unknown): SlotInspection {
  if (!Array.isArray(value)) return { ok: false, error: 'PROJECT_INPUT' };
  const slots: string[][] = [];
  let count = 1;
  // eslint-disable-next-line no-restricted-syntax -- Preserve slot order and stop at the first invalid entry.
  for (const slot of value) {
    if (!Array.isArray(slot)) return { ok: false, error: 'PROJECT_INPUT' };
    const enabled: string[] = [];
    // eslint-disable-next-line no-restricted-syntax -- V3 treats an absent enabled flag as active.
    for (const piece of slot) {
      if (
        !piece ||
        typeof piece !== 'object' ||
        Array.isArray(piece) ||
        (piece.enabled !== undefined && typeof piece.enabled !== 'boolean')
      )
        return { ok: false, error: 'PROJECT_INPUT' };
      if (piece.enabled !== false) {
        if (typeof piece.prompt !== 'string' || piece.prompt.length > 65536)
          return { ok: false, error: 'PROJECT_INPUT' };
        enabled.push(piece.prompt);
      }
    }
    if (!enabled.length) return { ok: false, error: 'PROJECT_LEGACY_SCENE' };
    count *= enabled.length;
    if (!Number.isSafeInteger(count))
      return { ok: false, error: 'PROJECT_LIMIT' };
    slots.push(enabled);
  }
  return { ok: true, count, slots };
}
