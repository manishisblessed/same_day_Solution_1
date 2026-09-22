import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, IconTile } from '@/components';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const REPORTS: { label: string; desc: string; icon: string; color: string; service?: string }[] = [
  { label: 'All Transactions', desc: 'Every service in one place', icon: 'albums', color: '#2563EB', service: 'all' },
  { label: 'AEPS Report', desc: 'Cash withdrawals & balance', icon: 'finger-print', color: '#9333EA', service: 'aeps' },
  { label: 'BBPS / Bills', desc: 'Bill payments history', icon: 'receipt', color: '#0891B2', service: 'bbps' },
  { label: 'Settlement / Payout', desc: 'Bank transfers', icon: 'cash', color: '#059669', service: 'payout' },
  { label: 'POS Transactions', desc: 'Card & QR sales', icon: 'hardware-chip', color: '#4F46E5', service: 'pos' },
  { label: 'Credit Card', desc: 'CC bill payments', icon: 'card', color: '#EA580C', service: 'creditcard' },
];

export const ReportsScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  return (
    <Screen title="Reports">
      <View style={{ marginTop: spacing.sm }}>
        {REPORTS.map((r) => (
          <TouchableOpacity
            key={r.label}
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => nav.navigate('TransactionsList', { service: r.service })}
          >
            <IconTile icon={r.icon as any} color={r.color} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{r.label}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{r.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.base, marginBottom: spacing.md, ...shadow.sm,
  },
});
