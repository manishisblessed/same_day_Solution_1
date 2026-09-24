export const palette = {
  // Finance-first: primary = green (trust/money), with blue in gradients.
  primary: {
    50: '#F0FDF4', 100: '#DCFCE7', 200: '#BBF7D0', 300: '#86EFAC', 400: '#4ADE80',
    500: '#22C55E', 600: '#16A34A', 700: '#15803D', 800: '#166534', 900: '#14532D',
  },
  // Orange from the SD logo — used as a light accent, not the dominant color.
  secondary: {
    50: '#FFF7ED', 100: '#FFEDD5', 200: '#FED7AA', 300: '#FDBA74', 400: '#FB923C',
    500: '#F97316', 600: '#EA580C', 700: '#C2410C', 800: '#9A3412', 900: '#7C2D12',
  },
  brand: {
    50: '#FFF7ED', 100: '#FFEDD5', 200: '#FED7AA', 300: '#FDBA74', 400: '#FB923C',
    500: '#F97316', 600: '#EA580C', 700: '#C2410C', 800: '#9A3412', 900: '#7C2D12',
  },
  blue: {
    50: '#EFF6FF', 100: '#DBEAFE', 200: '#BFDBFE', 300: '#93C5FD', 400: '#60A5FA',
    500: '#3B82F6', 600: '#2563EB', 700: '#1D4ED8', 800: '#1E40AF', 900: '#1E3A8A',
  },
  teal: {
    500: '#14B8A6', 600: '#0D9488', 700: '#0F766E', 800: '#115E59',
  },
  success: {
    50: '#F0FDF4', 100: '#DCFCE7', 300: '#86EFAC', 500: '#22C55E', 600: '#16A34A', 700: '#15803D',
  },
  danger: {
    50: '#FEF2F2', 100: '#FEE2E2', 300: '#FCA5A5', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C',
  },
  warning: { 50: '#FFFBEB', 100: '#FEF3C7', 500: '#F59E0B', 600: '#D97706' },
  purple: { 50: '#FAF5FF', 100: '#F3E8FF', 500: '#A855F7', 600: '#9333EA' },
  gray: {
    50: '#F9FAFB', 100: '#F3F4F6', 200: '#E5E7EB', 300: '#D1D5DB', 400: '#9CA3AF',
    500: '#6B7280', 600: '#4B5563', 700: '#374151', 800: '#1F2937', 900: '#111827',
  },
  white: '#FFFFFF',
  black: '#000000',
};

export const colors = {
  ...palette,
  background: '#F4F6FB',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  error: palette.danger[500],
  warningColor: palette.warning[500],
  info: palette.blue[500],
  gradients: {
    primary: [palette.primary[500], palette.primary[700]] as const,
    primaryDeep: [palette.primary[600], palette.primary[800]] as const,
    // Signature finance blend: green → teal → deep blue.
    hero: [palette.primary[600], palette.teal[700], palette.blue[800]] as const,
    heroSoft: [palette.primary[500], palette.teal[600], palette.blue[700]] as const,
    blue: [palette.blue[500], palette.blue[700]] as const,
    brand: [palette.brand[400], palette.brand[600]] as const,
    secondary: [palette.secondary[400], palette.secondary[600]] as const,
    // Orange → green, mirroring the SD logo (S orange, D green).
    logo: [palette.secondary[500], palette.primary[600]] as const,
    success: [palette.success[500], palette.success[700]] as const,
    purple: [palette.purple[500], palette.purple[600]] as const,
    dark: [palette.gray[800], palette.gray[900]] as const,
  },
};

export type Colors = typeof colors;
