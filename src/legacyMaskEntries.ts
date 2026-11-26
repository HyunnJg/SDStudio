export default function legacyMaskEntries(
  inpaints: Record<string, unknown>,
  version: unknown,
) {
  return Object.entries(inpaints).flatMap(([key, value], index) => {
    const row =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    if (
      row &&
      row.workflowType !== 'SDInpaint' &&
      (version || row.workflowType !== undefined)
    )
      return [];
    const name = typeof row?.name === 'string' ? row.name : key;
    const label =
      name &&
      name.length <= 120 &&
      !/[\\/:]/.test(name) &&
      Array.from(name).every((c) => c.charCodeAt(0) >= 32)
        ? name
        : `씬 ${index + 1}`;
    return [{ key, label, value }];
  });
}
