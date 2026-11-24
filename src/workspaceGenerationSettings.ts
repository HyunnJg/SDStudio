// Settings and literal tag lists observed in the public NovelAI client/docs on 2026-11-24.
// No client implementation or assets are included. Server acceptance remains a separate check.
export const V5_QUALITY_TAGS = Object.freeze({
  none: '',
  light: 'very aesthetic, amazing quality, no text',
  standard: 'very aesthetic, masterpiece, no text',
});
const heavy =
  'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
export const V5_UC_PRESETS = Object.freeze({
  none: '',
  light:
    'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
  heavy,
  human: `${heavy}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
  furry:
    '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
});
export const V5_SIZES = Object.freeze({
  portrait: { width: 832, height: 1216 },
  landscape: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
});

// Official V5 multi-character limit; storage may preserve additional disabled entries.
export const V5_CHARACTER_LIMIT = 22;
