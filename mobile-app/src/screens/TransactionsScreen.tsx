import React, { useState, useMemo } from 'react';
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
import { TransactionItem, FilterBar, EmptyState } from '../components';
import { recentTransactions, Transaction } from '../data/dummy';
import { formatCurrency } from '../utils';

const statusFilters = [
  { id: 'all', label: 'All' },
  { id: 'success', label: 'Success' },
  { id: 'pending', label: 'Pending' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
];

export const TransactionsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const filteredTransactions = useMemo(() => {
    if (activeFilter === 'all') return recentTransactions;
    return recentTransactions.filter((t) => t.status === activeFilter);
  }, [activeFilter]);

  const summaryData = useMemo(() => {
    const successCount = recentTransactions.filter(t => t.status === 'success').length;
    const totalAmount = recentTransactions.reduce((sum, t) => sum + t.amount, 0);
    return { total: recentTransactions.length, successCount, totalAmount };
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const renderHeader = () => (
    <View style={styles.summaryRow}>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryValue}>{summaryData.total}</Text>
        <Text style={styles.summaryLabel}>Total</Text>
      </View>
      <View style={[styles.summaryCard, { backgroundColor: colors.success[50] }]}>
        <Text style={[styles.summaryValue, { color: colors.success[700] }]}>
          {summaryData.successCount}
        </Text>
        <Text style={styles.summaryLabel}>Successful</Text>
      </View>
      <View style={[styles.summaryCard, { backgroundColor: colors.primary[50] }]}>
        <Text style={[styles.summaryValue, { color: colors.primary[700] }]}>
          {formatCurrency(summaryData.totalAmount)}
        </Text>
        <Text style={styles.summaryLabel}>Volume</Text>
      </View>
    </View>
  );

  const renderTransaction = ({ item }: { item: Transaction }) => (
    <TransactionItem transaction={item} />
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary[600], colors.primary[700]]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Transactions</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.headerBtn}>
              <Ionicons name="search-outline" size={20} color={colors.white} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn}>
              <Ionicons name="download-outline" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <FilterBar
        filters={statusFilters}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        showDateFilter
      />

      <FlatList
        data={filteredTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="No transactions found"
            message="No transactions match the selected filter."
          />
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[600]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.white,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: 12,
    alignItems: 'center',
    ...shadow.sm,
  },
  summaryValue: {
    ...typography.bodySemibold,
    color: colors.textPrimary,
    fontSize: 14,
  },
  summaryLabel: {
    ...typography.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  separator: {
    height: 0,
  },
});
