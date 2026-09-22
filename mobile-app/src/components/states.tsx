import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Button } from './ui';

export const Loading: React.FC<{ label?: string }> = ({ label }) => (
  <View style={styles.center}>
    <ActivityIndicator color={colors.primary[600]} size="large" />
    {label ? <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 12 }]}>{label}</Text> : null}
  </View>
);

export const EmptyState: React.FC<{ icon?: keyof typeof Ionicons.glyphMap; title: string; message?: string }> = ({
  icon = 'file-tray-outline', title, message,
}) => (
  <View style={styles.center}>
    <View style={styles.emptyIcon}>
      <Ionicons name={icon} size={30} color={colors.textMuted} />
    </View>
    <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 4 }]}>{title}</Text>
    {message ? <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32 }]}>{message}</Text> : null}
  </View>
);

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <View style={styles.center}>
    <View style={[styles.emptyIcon, { backgroundColor: colors.danger[50] }]}>
      <Ionicons name="alert-circle-outline" size={30} color={colors.danger[500]} />
    </View>
    <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: 4 }]}>Something went wrong</Text>
    <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32, marginBottom: 16 }]}>
      {message || 'Please try again.'}
    </Text>
    {onRetry ? <Button title="Retry" variant="outline" icon="refresh" onPress={onRetry} /> : null}
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing['3xl'] },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray[100],
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.base,
  },
});
