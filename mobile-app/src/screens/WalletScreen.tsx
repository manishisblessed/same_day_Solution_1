import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Pill, Loading, EmptyState, TransactionRow, Button } from '@/components';
import { fetchWalletBalance, fetchWalletTransactions, WalletType } from '@/api/wallet';
import { formatCurrency } from '@/utils/format';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const WALLETS: { key: WalletType; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'aeps', label: 'AEPS' },
  { key: 'commission', label: 'Commission' },
  { key: 'settlement', label: 'Settlement' },
];

export const WalletScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const [wallet, setWallet] = useState<WalletType>('primary');

  const balanceQ = useQuery({ queryKey: ['wallet', wallet], queryFn: () => fetchWalletBalance(wallet) });
  const txnQ = useQuery({ queryKey: ['wallet-txns', wallet], queryFn: () => fetchWalletTransactions({ limit: 30 }) });

  const onRefresh = useCallback(() => { balanceQ.refetch(); txnQ.refetch(); }, [balanceQ, txnQ]);
  const txns = txnQ.data?.transactions ?? [];

  return (
    <Screen title="Wallet" refreshing={balanceQ.isFetching || txnQ.isFetching} onRefresh={onRefresh}>
      <LinearGradient colors={colors.gradients.primary} style={styles.balCard}>
        <Text style={styles.balLabel}>{WALLETS.find((w) => w.key === wallet)?.label} Wallet</Text>
        <Text style={styles.balValue}>{balanceQ.isLoading ? '…' : formatCurrency(balanceQ.data?.balance)}</Text>
        {balanceQ.data?.warning ? <Text style={styles.warn}>{balanceQ.data.warning}</Text> : null}
      </LinearGradient>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing.md }}>
        {WALLETS.map((w) => (
          <Pill key={w.key} label={w.label} active={wallet === w.key} onPress={() => setWallet(w.key)} />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: spacing.md }}>
        <Button title="Ledger" variant="outline" icon="book-outline" style={{ flex: 1 }} onPress={() => nav.navigate('Ledger')} />
        <Button title="Push / Pull" variant="outline" icon="repeat" style={{ flex: 1 }} onPress={() => nav.navigate('PushPull')} />
      </View>

      <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Recent Transactions</Text>
      <Card>
        {txnQ.isLoading ? (
          <Loading />
        ) : txns.length === 0 ? (
          <EmptyState title="No transactions" message="Wallet movements will appear here." />
        ) : (
          txns.map((t, i) => (
            <View key={t.id || i}>
              <TransactionRow
                title={t.description || t.transaction_type || 'Transaction'}
                subtitle={t.reference_id}
                amount={t.amount}
                credit={(t.transaction_type || '').toLowerCase().includes('credit') || (t.amount ?? 0) > 0 && (t.transaction_type || '').toLowerCase().includes('push')}
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
  balLabel: { ...typography.caption, color: 'rgba(255,255,255,0.85)' },
  balValue: { ...typography.display, color: colors.white, marginTop: 4 },
  warn: { ...typography.small, color: 'rgba(255,255,255,0.9)', marginTop: 6 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
