import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { SectionHeader, FadeSlideIn, PressableScale } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useServices } from '@/contexts/ServicesContext';
import { fetchWalletBalance } from '@/api/wallet';
import { formatCurrency } from '@/utils/format';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const ROLE_LABELS: Record<string, string> = {
  retailer: 'Retailer',
  partner: 'Partner',
  master_partner: 'Master Partner',
  sub_partner: 'Partner',
};

export const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const { visible } = useServices();
  const [hideBalance, setHideBalance] = useState(false);

  const balanceQ = useQuery({ queryKey: ['wallet', 'primary'], queryFn: () => fetchWalletBalance('primary') });
  const onRefresh = useCallback(() => { balanceQ.refetch(); }, [balanceQ]);

  const quickActions = visible.slice(0, 9);
  const initial = (user?.name || 'U').charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={balanceQ.isFetching} onRefresh={onRefresh} tintColor={colors.white} colors={[colors.primary[600]]} />
        }
      >
        <LinearGradient
          colors={colors.gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1.2, y: 1.1 }}
          style={[styles.hero, { paddingTop: insets.top + 14 }]}
        >
          <View style={[styles.orb, { top: -60, right: -40, width: 190, height: 190 }]} />
          <View style={[styles.orb, { bottom: -30, left: -50, width: 150, height: 150, opacity: 0.6 }]} />
          <View style={[styles.orbAccent, { top: 40, right: 60, width: 70, height: 70 }]} />

          <FadeSlideIn distance={14}>
            <View style={styles.heroTop}>
              <View style={styles.heroUser}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={{ marginLeft: spacing.md, flex: 1 }}>
                  <Text style={styles.hello}>Welcome back</Text>
                  <Text style={styles.name} numberOfLines={1}>{user?.name || 'User'}</Text>
                </View>
              </View>
              <View style={styles.roleChip}>
                <Text style={styles.roleChipText}>{ROLE_LABELS[user?.role || ''] || 'Member'}</Text>
              </View>
            </View>
          </FadeSlideIn>

          <FadeSlideIn delay={100}>
            <View style={styles.balanceCard}>
              <View style={styles.balHead}>
                <Text style={styles.balLabel}>Available Balance</Text>
                <TouchableOpacity onPress={() => setHideBalance((h) => !h)} hitSlop={10}>
                  <Ionicons name={hideBalance ? 'eye-off-outline' : 'eye-outline'} size={18} color="rgba(255,255,255,0.85)" />
                </TouchableOpacity>
              </View>
              <Text style={styles.balValue}>
                {balanceQ.isLoading ? '…' : hideBalance ? '₹ ••••••' : formatCurrency(balanceQ.data?.balance)}
              </Text>
              <View style={styles.balActions}>
                {([
                  ['wallet-outline', 'Wallet', () => nav.navigate('Tabs', { screen: 'Wallet' } as any)],
                  ['book-outline', 'Ledger', () => nav.navigate('Ledger')],
                  ['swap-horizontal', 'History', () => nav.navigate('TransactionsList')],
                ] as const).map(([icon, label, go]) => (
                  <PressableScale key={label} style={styles.balBtn} onPress={go}>
                    <Ionicons name={icon} size={16} color={colors.white} />
                    <Text style={styles.balBtnText}>{label}</Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          </FadeSlideIn>
        </LinearGradient>

        <View style={styles.body}>
          {quickActions.length > 0 && (
            <>
              <FadeSlideIn delay={180}>
                <SectionHeader
                  title="Quick Actions"
                  action={visible.length > 9 ? 'See all' : undefined}
                  onAction={() => nav.navigate('Tabs', { screen: 'Services' } as any)}
                />
              </FadeSlideIn>
              <View style={styles.grid}>
                {quickActions.map((s, i) => (
                  <FadeSlideIn key={s.id} delay={220 + i * 55} style={styles.gridSlot}>
                    <PressableScale style={styles.gridCard} onPress={() => routeToService(nav, s.id)}>
                      <View style={[styles.gridIcon, { backgroundColor: `${s.color}18` }]}>
                        <Ionicons name={s.icon as any} size={26} color={s.color} />
                      </View>
                      <Text style={styles.gridLabel} numberOfLines={2}>{s.label}</Text>
                    </PressableScale>
                  </FadeSlideIn>
                ))}
              </View>
            </>
          )}

          <FadeSlideIn delay={300 + quickActions.length * 55}>
            <PressableScale onPress={() => nav.navigate('Tabs', { screen: 'Services' } as any)}>
              <LinearGradient
                colors={colors.gradients.blue}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.promo}
              >
                <View style={[styles.orb, { top: -30, right: -20, width: 110, height: 110 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.promoTitle}>Explore all services</Text>
                  <Text style={styles.promoSub}>Recharges, bills, banking & more — all in one place.</Text>
                </View>
                <View style={styles.promoArrow}>
                  <Ionicons name="arrow-forward" size={20} color={colors.blue[700]} />
                </View>
              </LinearGradient>
            </PressableScale>
          </FadeSlideIn>
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
  hero: {
    paddingHorizontal: spacing.base, paddingBottom: 64,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden',
  },
  orb: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)' },
  orbAccent: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(251,146,60,0.30)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroUser: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: spacing.md },
  avatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.45)',
  },
  avatarText: { ...typography.h3, color: colors.white },
  hello: { ...typography.caption, color: 'rgba(255,255,255,0.8)' },
  name: { ...typography.h2, color: colors.white },
  roleChip: {
    backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  roleChipText: { ...typography.small, color: colors.white, fontWeight: '700' },
  balanceCard: {
    marginTop: spacing.lg, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.xl,
    padding: spacing.xl, borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  balHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  balLabel: { ...typography.caption, color: 'rgba(255,255,255,0.85)' },
  balValue: { ...typography.display, fontSize: 38, color: colors.white, marginTop: 6 },
  balActions: { flexDirection: 'row', marginTop: spacing.lg, gap: 10 },
  balBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.full, gap: 6,
  },
  balBtnText: { ...typography.captionMedium, color: colors.white },
  body: { paddingHorizontal: spacing.base, marginTop: -36 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  gridSlot: { width: '33.33%', paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  gridCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm, alignItems: 'center', minHeight: 116, ...shadow.sm,
  },
  gridIcon: {
    width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
  },
  gridLabel: {
    ...typography.captionMedium, color: colors.textPrimary, marginTop: spacing.sm,
    textAlign: 'center',
  },

  promo: {
    flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl,
    padding: spacing.xl, marginTop: spacing.md, overflow: 'hidden', ...shadow.base,
  },
  promoTitle: { ...typography.h3, color: colors.white },
  promoSub: { ...typography.caption, color: 'rgba(255,255,255,0.9)', marginTop: 3 },
  promoArrow: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white,
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.md,
  },
});
