import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { RefreshControl } from 'react-native';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Card, SectionHeader, IconTile, Loading, EmptyState, TransactionRow } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useServices } from '@/contexts/ServicesContext';
import { fetchWalletBalance } from '@/api/wallet';
import { fetchServiceTransactions } from '@/api/transactions';
import { formatCurrency } from '@/utils/format';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const { visible } = useServices();

  const balanceQ = useQuery({ queryKey: ['wallet', 'primary'], queryFn: () => fetchWalletBalance('primary') });
  const txnsQ = useQuery({ queryKey: ['dashboard-txns'], queryFn: () => fetchServiceTransactions({ limit: 6 }) });

  const onRefresh = useCallback(() => {
    balanceQ.refetch();
    txnsQ.refetch();
  }, [balanceQ, txnsQ]);

  const quickActions = visible.slice(0, 8);
  const recent = txnsQ.data?.data ?? [];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={balanceQ.isFetching || txnsQ.isFetching} onRefresh={onRefresh} tintColor={colors.white} />
        }
      >
        <LinearGradient colors={colors.gradients.primaryDeep} style={[styles.hero, { paddingTop: insets.top + 16 }]}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.hello}>Hello,</Text>
              <Text style={styles.name}>{user?.name || 'Retailer'}</Text>
            </View>
            <TouchableOpacity style={styles.bell} onPress={() => nav.navigate('Tabs', { screen: 'Profile' } as any)}>
              <Ionicons name="person-circle-outline" size={30} color={colors.white} />
            </TouchableOpacity>
          </View>

          <View style={styles.balanceCard}>
            <Text style={styles.balLabel}>Wallet Balance</Text>
            {balanceQ.isLoading ? (
              <Text style={styles.balValue}>…</Text>
            ) : (
              <Text style={styles.balValue}>{formatCurrency(balanceQ.data?.balance)}</Text>
            )}
            <View style={styles.balActions}>
              <TouchableOpacity style={styles.balBtn} onPress={() => nav.navigate('Tabs', { screen: 'Wallet' } as any)}>
                <Ionicons name="wallet-outline" size={16} color={colors.white} />
                <Text style={styles.balBtnText}>Wallet</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.balBtn} onPress={() => nav.navigate('Ledger')}>
                <Ionicons name="book-outline" size={16} color={colors.white} />
                <Text style={styles.balBtnText}>Ledger</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.balBtn} onPress={() => nav.navigate('TransactionsList')}>
                <Ionicons name="swap-horizontal" size={16} color={colors.white} />
                <Text style={styles.balBtnText}>History</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.body}>
          <SectionHeader title="Quick Actions" action={visible.length > 8 ? 'See all' : undefined} onAction={() => nav.navigate('Tabs', { screen: 'Services' } as any)} />
          {quickActions.length === 0 ? (
            <Card>
              <EmptyState icon="lock-closed-outline" title="No services enabled" message="Your services are managed by admin. Once enabled, they'll appear here." />
            </Card>
          ) : (
            <View style={styles.grid}>
              {quickActions.map((s) => (
                <TouchableOpacity key={s.id} style={styles.gridItem} activeOpacity={0.7} onPress={() => routeToService(nav, s.id)}>
                  <IconTile icon={s.icon as any} color={s.color} />
                  <Text style={styles.gridLabel} numberOfLines={1}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ height: spacing.lg }} />
          <SectionHeader title="Recent Activity" action="View all" onAction={() => nav.navigate('TransactionsList')} />
          <Card>
            {txnsQ.isLoading ? (
              <Loading />
            ) : recent.length === 0 ? (
              <EmptyState title="No transactions yet" message="Your recent transactions will show up here." />
            ) : (
              recent.map((t, i) => (
                <View key={t.id || i}>
                  <TransactionRow
                    title={t.description || t.service_type?.toUpperCase() || 'Transaction'}
                    subtitle={t.transaction_id || t.tid}
                    amount={t.amount}
                    status={t.status}
                    date={t.created_at}
                    service={t.service_type}
                  />
                  {i < recent.length - 1 ? <View style={styles.sep} /> : null}
                </View>
              ))
            )}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
};

export function routeToService(nav: Nav, id: string) {
  const map: Record<string, keyof AppStackParamList> = {
    aeps: 'Aeps', 'aadhaar-pay': 'Aeps', bbps: 'Bbps', 'bbps-2': 'Pay2New',
    'credit-card': 'Pay2New', 'credit-card-2': 'CreditCard2', 'api-payment': 'ApiPayment',
    payout: 'Payout', 'settlement-2': 'Settlement2', 'pos-machines': 'PosMachines',
    subscriptions: 'Subscriptions', 'mdr-schemes': 'MdrSchemes', recharge: 'Pay2New',
  };
  const route = map[id];
  if (!route) return;
  if (route === 'Pay2New') {
    const mode = id === 'credit-card' ? 'credit-card' : id === 'recharge' ? 'recharge' : 'bbps';
    nav.navigate('Pay2New', { mode });
  } else {
    nav.navigate(route as any);
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hero: { paddingHorizontal: spacing.base, paddingBottom: 60, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { ...typography.body, color: 'rgba(255,255,255,0.8)' },
  name: { ...typography.h1, color: colors.white },
  bell: { padding: 2 },
  balanceCard: {
    marginTop: spacing.lg, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.xl,
    padding: spacing.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  balLabel: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  balValue: { ...typography.display, color: colors.white, marginTop: 2 },
  balActions: { flexDirection: 'row', marginTop: spacing.base, gap: 10 },
  balBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.base, gap: 5 },
  balBtnText: { ...typography.captionMedium, color: colors.white },
  body: { paddingHorizontal: spacing.base, marginTop: -32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridItem: { width: '25%', alignItems: 'center', marginBottom: spacing.base },
  gridLabel: { ...typography.small, color: colors.textSecondary, marginTop: 6, textAlign: 'center' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
