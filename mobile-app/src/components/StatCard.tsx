import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';

export const StatCard: React.FC<{
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  sub?: string;
}> = ({ label, value, icon, color = colors.primary[600], sub }) => (
  <View style={styles.card}>
    <View style={[styles.icon, { backgroundColor: `${color}1A` }]}>
      <Ionicons name={icon} size={18} color={color} />
    </View>
    <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>{label}</Text>
    <Text style={[typography.h3, { color: colors.textPrimary, marginTop: 2 }]} numberOfLines={1}>{value}</Text>
    {sub ? <Text style={[typography.small, { color: colors.textMuted, marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.base, ...shadow.sm },
  icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
});
