/**
 * Film Locker's palette, light and dark.
 *
 * The light values are not a redesign: every one of them is a hex literal
 * lifted verbatim from the screens, so converting a screen to tokens cannot
 * change how it looks today. That is deliberate and worth keeping — it means
 * a mistake in this file can only ever show up in dark mode, never in the
 * theme everybody is already using.
 *
 * The names are semantic rather than descriptive for the same reason tokens
 * exist at all: `textFaint` survives the move from grey-400 to grey-500 in
 * dark mode, where `gray400` would become a lie. The greys come from
 * Tailwind's ramp, which is where the originals came from, and dark mode
 * mostly walks them the other way — the 900 that was text becomes the
 * background and the 100 that was a surface becomes text.
 *
 * Two values do not simply invert. The brand blue is lifted on dark
 * (#0066FF is legible against near-black but sits heavily on it), and the
 * indigo avatar pair needs its own dark values, since swapping a pale
 * background for a saturated foreground produces an unreadable chip.
 *
 * The keys above the divider in each block are the original scaffold's and
 * are used by the sheets and error screens already; everything below was
 * added for the conversion.
 */

const light = {
  // ── original scaffold tokens ────────────────────────────────────────────
  text: '#111827',
  tint: '#0066FF',
  background: '#FFFFFF',
  foreground: '#111827',
  card: '#F8F9FA',
  cardForeground: '#111827',
  primary: '#0066FF',
  primaryForeground: '#FFFFFF',
  secondary: '#FF8C00',
  secondaryForeground: '#FFFFFF',
  muted: '#F3F4F6',
  mutedForeground: '#6B7280',
  accent: '#0066FF',
  accentForeground: '#FFFFFF',
  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',
  border: '#E5E7EB',
  input: '#F9FAFB',
  surface: '#FFFFFF',

  // ── text, darkest to faintest ───────────────────────────────────────────
  textStrong: '#374151',
  textBody: '#4B5563',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',

  // ── surfaces and lines ──────────────────────────────────────────────────
  /** Cards and inset panels. */
  surfaceSubtle: '#F9FAFB',
  /** Image placeholders, pressed states, the tier below a card. */
  surfaceAlt: '#F3F4F6',
  /** Chevrons, disabled glyphs, empty-state icons. */
  iconFaint: '#D1D5DB',
  /** A line lighter than `border`, for separators inside a list. */
  borderSubtle: '#F3F4F6',
  /** Hairlines over artwork, where a solid colour would band. */
  overlayLine: 'rgba(0,0,0,0.07)',

  // ── accents ─────────────────────────────────────────────────────────────
  /** Stars and ratings. */
  star: '#FF8C00',
  /** Tinted chips and selected rows. */
  primarySoft: '#EFF6FF',
  primarySofter: '#DBEAFE',
  primaryBorder: '#BFDBFE',
  primaryMid: '#93C5FD',
  /** Avatar fallbacks — a pair, not two independent colours. */
  avatarBg: '#E0E7FF',
  avatarFg: '#4F46E5',
  /** Success and danger, in two weights each. */
  success: '#16A34A',
  successStrong: '#059669',
  destructiveStrong: '#DC2626',
};

const dark: typeof light = {
  // ── original scaffold tokens ────────────────────────────────────────────
  text: '#F3F4F6',
  tint: '#3D8BFF',
  background: '#0F1115',
  foreground: '#F3F4F6',
  card: '#15181E',
  cardForeground: '#F3F4F6',
  primary: '#3D8BFF',
  primaryForeground: '#FFFFFF',
  secondary: '#FFA93D',
  secondaryForeground: '#1A1205',
  muted: '#1C2027',
  mutedForeground: '#9CA3AF',
  accent: '#3D8BFF',
  accentForeground: '#FFFFFF',
  destructive: '#F87171',
  destructiveForeground: '#1A0707',
  border: '#262B33',
  input: '#15181E',
  surface: '#0F1115',

  // ── text, darkest to faintest (walked the other way) ───────────────────
  textStrong: '#E5E7EB',
  textBody: '#D1D5DB',
  textMuted: '#9CA3AF',
  textFaint: '#6B7280',

  // ── surfaces and lines ──────────────────────────────────────────────────
  surfaceSubtle: '#15181E',
  surfaceAlt: '#1C2027',
  iconFaint: '#4B5563',
  borderSubtle: '#1C2027',
  overlayLine: 'rgba(255,255,255,0.08)',

  // ── accents ─────────────────────────────────────────────────────────────
  star: '#FFA93D',
  primarySoft: '#152336',
  primarySofter: '#1B2E4A',
  primaryBorder: '#2B4A72',
  primaryMid: '#5B8FD6',
  avatarBg: '#312E81',
  avatarFg: '#C7D2FE',
  success: '#4ADE80',
  successStrong: '#34D399',
  destructiveStrong: '#F87171',
};

export type Palette = typeof light & { radius: number };

const colors = { light, dark, radius: 10 };

export default colors;
