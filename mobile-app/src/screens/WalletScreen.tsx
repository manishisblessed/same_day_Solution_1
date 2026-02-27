import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, borderRadius, shadow } from '../theme';
import { WalletCard, Badge } from '../components';
import { walletBalance, walletTransactions, WalletTransaction } from '../data/dummy';
import { formatCurrency, formatDateTime } from '../utils';

export const WalletScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const renderWalletHeader = () => (
    <View style={styles.headerSection}>
      <WalletCard
        title="Primary Wallet"
        balance={walletBalance.primary}
        gradientColors={colors.gradients.primary}
        icon="wallet"
        subtitle="Available for all services"
      />

      <View style={styles.walletGap} />

      <WalletCard
        title="AEPS Wallet"
        balance={walletBalance.aeps}
        gradientColors={colors.gradients.purple}
        icon="finger-print"
        subtitle="AEPS transactions only"
      />

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionButton}>
          <View style={[styles.actionIcon, { backgroundColor: colors.success[50] }]}>
            <Ionicons name="add-circle-outline" size={20} color={colors.success[600]} />
          </View>
          <Text style={styles.actionLabel}>Add Money</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <View style={[styles.actionIcon, { backgroundColor: colors.primary[50] }]}>
            <Ionicons name="arrow-up-outline" size={20} color={colors.primary[600]} />
          </View>
          <Text style={styles.actionLabel}>Settlement</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <View style={[styles.actionIcon, { backgroundColor: colors.accent[50] }]}>
            <Ionicons name="time-outline" size={20} color={colors.accent[600]} />
          </View>
          <Text style={styles.actionLabel}>History</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.historyHeader}>
        <Text style={styles.sectionTitle}>Wallet History</Text>
        <TouchableOpacity style={styles.exportButton}>
          <Ionicons name="download-outline" size={16} color={colors.primary[600]} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderWalletItem = ({ item }: { item: WalletTransaction }) => {
    const isCredit = item.type === 'credit';

    return (
      <View style={styles.txnItem}>
        <View
          style={[
            styles.txnIcon,
            {
              backgroundColor: isCredit ? colors.success[50] : '#FEE2E2',
            },
          ]}
        >
          <Ionicons
            name={isCredit ? 'arrow-down' : 'arrow-up'}
            size={18}
            color={isCredit ? colors.success[600] : colors.error}
          />
        </View>

        <View style={styles.txnContent}>
          <Text style={styles.txnDescription} numberOfLines={1}>
            {item.description}
          </Text>
          <Text style={styles.txnMeta}>
            {item.serviceType} {'\u00B7'} {formatDateTime(item.date)}
          </Text>
        </View>

        <View style={styles.txnRight}>
          <Text
            style={[
              styles.txnAmount,
              { color: isCredit ? colors.success[600] : colors.error },
            ]}
          >
            {isCredit ? '+' : '-'}{formatCurrency(item.amount)}
          </Text>
          <Text style={styles.txnBalance}>
            Bal: {formatCurrency(item.balance)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary[600], colors.primary[700]]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <Text style={styles.headerTitle}>Wallet</Text>
      </LinearGradient>

      <FlatList
        data={walletTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderWalletItem}
        ListHeaderComponent={renderWalletHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[600]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.white,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  walletGap: {
    height: 14,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginTop: 20,
    marginBottom: 8,
  },
  actionButton: {
    alignItems: 'center',
    gap: 6,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.sm,
  },
  actionLabel: {
    ...typography.smallMedium,
    color: colors.textSecondary,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary[50],
  },
  exportText: {
    ...typography.smallMedium,
    color: colors.primary[600],
  },
  listContent: {
    paddingBottom: 20,
  },
  txnItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  txnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txnContent: {
    flex: 1,
    gap: 3,
  },
  txnDescription: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    fontSize: 14,
  },
  txnMeta: {
    ...typography.small,
    color: colors.textMuted,
  },
  txnRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  txnAmount: {
    ...typography.bodySemibold,
    fontSize: 14,
  },
  txnBalance: {
    ...typography.small,
    color: colors.textMuted,
  },
});
