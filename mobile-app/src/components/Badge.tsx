import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, borderRadius } from '../theme';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default' | 'processing';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

const variantConfig: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: colors.success[100], text: colors.success[700] },
  warning: { bg: '#FEF3C7', text: '#B45309' },
  error: { bg: '#FEE2E2', text: '#DC2626' },
  info: { bg: colors.primary[100], text: colors.primary[700] },
  processing: { bg: colors.accent[100], text: colors.accent[700] },
  default: { bg: colors.gray[100], text: colors.gray[600] },
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'default',
  size = 'sm',
  style,
}) => {
  const config = variantConfig[variant];

  return (
    <View
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: config.bg },
        style,
      ]}
    >
      <View style={[styles.dot, { backgroundColor: config.text }]} />
      <Text
        style={[
          size === 'sm' ? styles.textSm : styles.textMd,
          { color: config.text },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.full,
    gap: 4,
  },
  sm: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  md: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textSm: {
    ...typography.small,
    fontWeight: '600',
  },
  textMd: {
    ...typography.captionMedium,
  },
});
