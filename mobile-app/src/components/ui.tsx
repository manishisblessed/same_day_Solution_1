import React from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput,
  ViewStyle, TextStyle, StyleProp, TextInputProps, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing, typography, shadow } from '@/theme';

// ── Card ──
export const Card: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }> = ({
  children, style, padded = true,
}) => (
  <View style={[styles.card, padded && { padding: spacing.base }, style]}>{children}</View>
);

// ── Button ──
type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success';
export const Button: React.FC<{
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}> = ({ title, onPress, variant = 'primary', loading, disabled, icon, fullWidth, size = 'md', style }) => {
  const isSolid = variant === 'primary' || variant === 'danger' || variant === 'success';
  const grad =
    variant === 'danger' ? colors.gradients.brand
    : variant === 'success' ? colors.gradients.success
    : colors.gradients.primary;
  const height = size === 'lg' ? 54 : 46;
  const inner = (
    <View style={styles.btnRow}>
      {loading ? (
        <ActivityIndicator color={isSolid ? colors.white : colors.primary[600]} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={isSolid ? colors.white : colors.primary[600]}
              style={{ marginRight: 8 }}
            />
          )}
          <Text
            style={[
              typography.bodyMedium,
              { color: isSolid ? colors.white : variant === 'outline' ? colors.primary[600] : colors.textPrimary },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </View>
  );

  const disabledStyle = disabled || loading ? { opacity: 0.55 } : null;

  if (isSolid) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        disabled={disabled || loading}
        style={[fullWidth && { alignSelf: 'stretch' }, disabledStyle, style]}
      >
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.btn, { height }]}>
          {inner}
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.btn,
        { height },
        variant === 'outline' && { borderWidth: 1.5, borderColor: colors.primary[300], backgroundColor: colors.primary[50] },
        variant === 'ghost' && { backgroundColor: colors.gray[100] },
        fullWidth && { alignSelf: 'stretch' },
        disabledStyle,
        style,
      ]}
    >
      {inner}
    </TouchableOpacity>
  );
};

// ── Input ──
export const Input: React.FC<
  {
    label?: string;
    icon?: keyof typeof Ionicons.glyphMap;
    error?: string;
    rightElement?: React.ReactNode;
    containerStyle?: StyleProp<ViewStyle>;
  } & TextInputProps
> = ({ label, icon, error, rightElement, containerStyle, style, ...props }) => (
  <View style={[{ marginBottom: spacing.base }, containerStyle]}>
    {label && <Text style={[typography.captionMedium, { color: colors.textPrimary, marginBottom: 6 }]}>{label}</Text>}
    <View style={[styles.inputWrap, error ? { borderColor: colors.danger[300] } : null]}>
      {icon && <Ionicons name={icon} size={18} color={colors.textMuted} style={{ marginRight: 8 }} />}
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, style as StyleProp<TextStyle>]}
        {...props}
      />
      {rightElement}
    </View>
    {error ? <Text style={[typography.small, { color: colors.danger[500], marginTop: 4 }]}>{error}</Text> : null}
  </View>
);

// ── Badge / Pill ──
export const Badge: React.FC<{ label: string; tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'info' }> = ({
  label, tone = 'neutral',
}) => {
  const map = {
    neutral: [colors.gray[100], colors.gray[600]],
    success: [colors.success[50], colors.success[700]],
    danger: [colors.danger[50], colors.danger[600]],
    warning: [colors.warning[50], colors.warning[600]],
    info: [colors.primary[50], colors.primary[600]],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[typography.small, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
};

export function statusTone(status?: string): 'success' | 'danger' | 'warning' | 'neutral' {
  const s = (status || '').toLowerCase();
  if (['success', 'completed', 'paid', 'settled', 'active', 'valid'].some((k) => s.includes(k))) return 'success';
  if (['fail', 'failed', 'declined', 'error', 'reversed', 'rejected'].some((k) => s.includes(k))) return 'danger';
  if (['pending', 'processing', 'initiated', 'in_progress'].some((k) => s.includes(k))) return 'warning';
  return 'neutral';
}

// ── Section header ──
export const SectionHeader: React.FC<{ title: string; action?: string; onAction?: () => void }> = ({
  title, action, onAction,
}) => (
  <View style={styles.sectionHeader}>
    <Text style={[typography.h3, { color: colors.textPrimary }]}>{title}</Text>
    {action && (
      <TouchableOpacity onPress={onAction}>
        <Text style={[typography.captionMedium, { color: colors.primary[600] }]}>{action}</Text>
      </TouchableOpacity>
    )}
  </View>
);

export const Divider = () => <View style={styles.divider} />;

// ── Icon tile ──
export const IconTile: React.FC<{ icon: keyof typeof Ionicons.glyphMap; color: string; size?: number }> = ({
  icon, color, size = 44,
}) => (
  <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: `${color}1A`, alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name={icon} size={size * 0.5} color={color} />
  </View>
);

export const Pill: React.FC<{ label: string; active?: boolean; onPress?: () => void }> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    style={[styles.pill, active ? { backgroundColor: colors.primary[600] } : { backgroundColor: colors.gray[100] }]}
  >
    <Text style={[typography.captionMedium, { color: active ? colors.white : colors.textSecondary }]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.base },
  btn: { borderRadius: radius.base, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray[50],
    borderRadius: radius.base, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, height: 52,
  },
  input: { flex: 1, ...typography.body, color: colors.textPrimary, height: '100%' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full, alignSelf: 'flex-start' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.md },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.full, marginRight: 8 },
});
