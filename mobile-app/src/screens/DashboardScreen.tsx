import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, borderRadius, shadow } from '../theme';
import {
  StatCard,
  QuickActionButton,
  TransactionItem,
  WalletCard,
} from '../components';
import {
  walletBalance,
  todaySummary,
  recentTransactions,
  retailerProfile,
} from '../data/dummy';
import { formatCurrency, getGreeting } from '../utils';
import { useNavigation } from '@react-navigation/native';

export const DashboardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const quickActions = [
    {
      label: 'BBPS',
      icon: 'receipt-outline' as const,
      color: colors.primary[600],
      bgColor: colors.primary[50],
      onPress: () => {},
    },
    {
      label: 'Transactions',
      icon: 'swap-horizontal-outline' as const,
      color: colors.accent[600],
      bgColor: colors.accent[50],
      onPress: () => navigation.navigate('Transactions'),
    },
    {
      label: 'Wallet',
      icon: 'wallet-outline' as const,
      color: colors.success[600],
      bgColor: colors.success[50],
      onPress: () => navigation.navigate('Wallet'),
    },
    {
      label: 'Settlement',
      icon: 'arrow-up-circle-outline' as const,
      color: colors.purple[600],
      bgColor: colors.purple[50],
      onPress: () => navigation.navigate('Settlement'),
    },
  ];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary[600], colors.primary[700]]}
        style={[styles.headerGradient, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {retailerProfile.name.split(' ').map(n => n[0]).join('')}
              </Text>
            </View>
            <View>
              <Text style={styles.greeting}>{getGreeting()}</Text>
              <Text style={styles.userName}>{retailerProfile.name}</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIconButton}>
              <Ionicons name="search-outline" size={22} color={colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIconButton}>
              <Ionicons name="notifications-outline" size={22} color={colors.white} />
              <View style={styles.notifBadge} />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[600]}
          />
        }
      >
        <View style={styles.walletSection}>
          <WalletCard
            title="Primary Wallet"
            balance={walletBalance.primary}
            gradientColors={colors.gradients.primary}
            icon="wallet"
            subtitle={`Partner ID: ${retailerProfile.partnerId}`}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Summary</Text>
          <View style={styles.statsRow}>
            <StatCard
              title="Transactions"
              value={todaySummary.totalTransactions.toString()}
              icon={<Ionicons name="swap-horizontal" size={18} color={colors.primary[600]} />}
              iconBg={colors.primary[50]}
              trend={{ value: '12%', positive: true }}
            />
            <StatCard
              title="Revenue"
              value={formatCurrency(todaySummary.totalRevenue)}
              icon={<Ionicons name="trending-up" size={18} color={colors.success[600]} />}
              iconBg={colors.success[50]}
              trend={{ value: '8%', positive: true }}
            />
          </View>
          <View style={[styles.statsRow, { marginTop: 10 }]}>
            <StatCard
              title="Commission"
              value={formatCurrency(todaySummary.commissionEarned)}
              icon={<Ionicons name="gift" size={18} color={colors.purple[600]} />}
              iconBg={colors.purple[50]}
            />
            <StatCard
              title="Success Rate"
              value={`${todaySummary.successRate}%`}
              icon={<Ionicons name="checkmark-circle" size={18} color={colors.accent[600]} />}
              iconBg={colors.accent[50]}
              trend={{ value: '2%', positive: true }}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActionsRow}>
            {quickActions.map((action) => (
              <QuickActionButton key={action.label} {...action} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.transactionsList}>
            {recentTransactions.slice(0, 5).map((txn) => (
              <TransactionItem key={txn.id} transaction={txn} />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.distributorCard}>
            <View style={styles.distributorIcon}>
              <Ionicons name="business-outline" size={20} color={colors.primary[600]} />
            </View>
            <View style={styles.distributorInfo}>
              <Text style={styles.distributorLabel}>Connected Distributor</Text>
              <Text style={styles.distributorName}>
                {retailerProfile.distributorName}
              </Text>
            </View>
            <View style={styles.connectedBadge}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>Active</Text>
            </View>
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerGradient: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  avatarText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontSize: 16,
  },
  greeting: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.8)',
  },
  userName: {
    ...typography.h4,
    color: colors.white,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: colors.primary[600],
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  walletSection: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.textPrimary,
    marginBottom: 14,
  },
  viewAllText: {
    ...typography.captionMedium,
    color: colors.primary[600],
    marginBottom: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    paddingVertical: 20,
    ...shadow.sm,
  },
  transactionsList: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    overflow: 'hidden',
    ...shadow.sm,
  },
  distributorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    padding: 16,
    gap: 12,
    ...shadow.sm,
  },
  distributorIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  distributorInfo: {
    flex: 1,
  },
  distributorLabel: {
    ...typography.small,
    color: colors.textMuted,
  },
  distributorName: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    marginTop: 2,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success[50],
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    gap: 4,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success[500],
  },
  connectedText: {
    ...typography.smallMedium,
    color: colors.success[700],
  },
});
