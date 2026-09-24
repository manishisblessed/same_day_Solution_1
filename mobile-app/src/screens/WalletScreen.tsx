import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Pill, Loading, EmptyState, TransactionRow } from '@/components';
import { fetchWalletBalance, fetchWalletTransactions, WalletType } from '@/api/wallet';
import { formatCurrency, cleanDescription } from '@/utils/format';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const WALLETS: { key: WalletType; label: string; icon: string; grad: readonly [string, string] }[] = [
  { key: 'primary', label: 'Primary', icon: 'wallet', grad: [colors.primary[500], colors.primary[700]] },
  { key: 'aeps', label: 'AEPS', icon: 'finger-print', grad: ['#7C3AED', '#5B21B6'] },
  { key: 'commission', label: 'Commission', icon: 'trending-up', grad: [colors.secondary[400], colors.secondary[600]] },
  { key: 'settlement', label: 'Settlement', icon: 'business', grad: ['#0D9488', '#115E59'] },
];

export const WalletScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const [wallet, setWallet] = useState<WalletType>('primary');

  const balanceQ = useQuery({ queryKey: ['wallet', wallet], queryFn: () => fetchWalletBalance(wallet) });
  const txnQ = useQuery({ queryKey: ['wallet-txns', wallet], queryFn: () => fetchWalletTransactions({ limit: 30 }) });

  const onRefresh = useCallback(() => { balanceQ.refetch(); txnQ.refetch(); }, [balanceQ, txnQ]);
  const txns = txnQ.data?.transactions ?? [];
  const active = WALLETS.find((w) => w.key === wallet)!;

  return (
    <Screen title="Wallet" refreshing={balanceQ.isFetching || txnQ.isFetching} onRefresh={onRefresh}>
      <LinearGradient colors={active.grad} start={{ x: 0, y: 0 }} end={{ x: 1.2, y: 1 }} style={styles.balCard}>
        <View style={styles.balTop}>
          <View style={styles.balIcon}>
            <Ionicons name={active.icon as any} size={20} color={colors.white} />
          </View>
          <Text style={styles.balLabel}>{active.label} Wallet</Text>
        </View>
        <Text style={styles.balValue}>{balanceQ.isLoading ? '…' : formatCurrency(balanceQ.data?.balance)}</Text>
        {balanceQ.data?.warning ? <Text style={styles.warn}>{balanceQ.data.warning}</Text> : null}
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.md }} contentContainerStyle={{ paddingRight: spacing.base }}>
        {WALLETS.map((w) => (
          <Pill key={w.key} label={w.label} active={wallet === w.key} onPress={() => setWallet(w.key)} />
        ))}
      </ScrollView>

      <View style={styles.actionRow}>
        {([
          ['book-outline', 'Ledger', () => nav.navigate('Ledger')],
          ['repeat-outline', 'Push / Pull', () => nav.navigate('PushPull')],
          ['swap-horizontal-outline', 'History', () => nav.navigate('TransactionsList')],
        ] as const).map(([icon, label, go]) => (
          <TouchableOpacity key={label} style={styles.actionBtn} activeOpacity={0.75} onPress={go}>
            <Ionicons name={icon} size={20} color={colors.primary[600]} />
            <Text style={styles.actionText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.md }]}>Recent Transactions</Text>
      <Card>
        {txnQ.isLoading ? (
          <Loading />
        ) : txns.length === 0 ? (
          <EmptyState title="No transactions" message="Wallet movements will appear here." />
        ) : (
          txns.map((t, i) => (
            <View key={t.id || i}>
              <TransactionRow
                title={cleanDescription(t.description) || t.transaction_type || 'Transaction'}
                subtitle={t.reference_id}
                amount={t.amount}
                credit={(t.transaction_type || '').toLowerCase().includes('credit')}
                status={t.status}
                date={t.created_at}
                service={t.service_type}
              />
              {i < txns.length - 1 ? <View style={styles.sep} /> : null}
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  balCard: { borderRadius: radius.xl, padding: spacing.xl, marginTop: spacing.sm, ...shadow.base },
  balTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balIcon: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  balLabel: { ...typography.bodyMedium, color: 'rgba(255,255,255,0.9)' },
  balValue: { ...typography.display, fontSize: 34, color: colors.white, marginTop: spacing.md },
  warn: { ...typography.small, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: spacing.md },
  actionBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.base,
    alignItems: 'center', gap: 6, ...shadow.sm,
  },
  actionText: { ...typography.captionMedium, color: colors.textPrimary },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
