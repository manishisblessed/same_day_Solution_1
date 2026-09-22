import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Badge, statusTone } from './ui';
import { formatCurrency, formatDate } from '@/utils/format';

const SERVICE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  bbps: 'receipt', aeps: 'finger-print', pos: 'hardware-chip', payout: 'cash',
  settlement: 'cash', settlement2: 'send', creditcard: 'card', account_verification: 'shield-checkmark',
};

export const TransactionRow: React.FC<{
  title: string;
  subtitle?: string;
  amount?: number;
  status?: string;
  date?: string;
  service?: string;
  credit?: boolean;
  onPress?: () => void;
}> = ({ title, subtitle, amount, status, date, service, credit, onPress }) => (
  <TouchableOpacity activeOpacity={onPress ? 0.6 : 1} onPress={onPress} style={styles.row}>
    <View style={[styles.icon, { backgroundColor: colors.primary[50] }]}>
      <Ionicons name={SERVICE_ICON[(service || '').toLowerCase()] || 'swap-horizontal'} size={18} color={colors.primary[600]} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
      <Text style={[typography.small, { color: colors.textMuted, marginTop: 1 }]} numberOfLines={1}>
        {subtitle ? `${subtitle} · ` : ''}{date ? formatDate(date, 'dd MMM, hh:mm a') : ''}
      </Text>
    </View>
    <View style={{ alignItems: 'flex-end' }}>
      {amount != null && (
        <Text style={[typography.bodyMedium, { color: credit ? colors.success[600] : colors.textPrimary }]}>
          {credit ? '+' : ''}{formatCurrency(amount)}
        </Text>
      )}
      {status ? <View style={{ marginTop: 3 }}><Badge label={status} tone={statusTone(status)} /></View> : null}
    </View>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  icon: { width: 38, height: 38, borderRadius: radius.base, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
});
