import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, borderRadius } from '../theme';
import { Badge } from './Badge';
import { formatCurrency, formatDateTime } from '../utils';
import { Transaction } from '../data/dummy';

interface TransactionItemProps {
  transaction: Transaction;
  onPress?: () => void;
}

const typeIconMap: Record<string, { name: keyof typeof Ionicons.glyphMap; bg: string; color: string }> = {
  BBPS: { name: 'receipt-outline', bg: colors.primary[50], color: colors.primary[600] },
  POS: { name: 'card-outline', bg: colors.accent[50], color: colors.accent[600] },
  AEPS: { name: 'finger-print-outline', bg: colors.purple[50], color: colors.purple[600] },
  Payout: { name: 'arrow-up-outline', bg: colors.success[50], color: colors.success[600] },
  Commission: { name: 'gift-outline', bg: '#FEF3C7', color: '#B45309' },
};

const statusVariantMap: Record<string, 'success' | 'warning' | 'error' | 'processing'> = {
  success: 'success',
  pending: 'warning',
  failed: 'error',
  processing: 'processing',
};

export const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onPress,
}) => {
  const typeConfig = typeIconMap[transaction.type] ?? {
    name: 'swap-horizontal-outline' as keyof typeof Ionicons.glyphMap,
    bg: colors.gray[100],
    color: colors.gray[600],
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      style={styles.container}
    >
      <View style={[styles.iconContainer, { backgroundColor: typeConfig.bg }]}>
        <Ionicons name={typeConfig.name} size={20} color={typeConfig.color} />
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={styles.description} numberOfLines={1}>
            {transaction.description}
          </Text>
          <Text style={styles.amount}>
            {formatCurrency(transaction.amount)}
          </Text>
        </View>
        <View style={styles.bottomRow}>
          <Text style={styles.meta}>
            {transaction.type} {'\u00B7'} {formatDateTime(transaction.date)}
          </Text>
          <Badge
            label={transaction.status.charAt(0).toUpperCase() + transaction.status.slice(1)}
            variant={statusVariantMap[transaction.status] ?? 'default'}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
    backgroundColor: colors.white,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  content: {
    flex: 1,
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  description: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  amount: {
    ...typography.bodySemibold,
    color: colors.textPrimary,
  },
  meta: {
    ...typography.small,
    color: colors.textMuted,
  },
});
