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
import { Badge, Card, FilterBar, Button } from '../components';
import {
  settlements,
  settlementSummary,
  Settlement,
} from '../data/dummy';
import { formatCurrency, formatDate, formatDateTime } from '../utils';

const filterOptions = [
  { id: 'all', label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'processing', label: 'Processing' },
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
];

const statusVariantMap: Record<string, 'success' | 'warning' | 'error' | 'processing' | 'default'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'error',
  processing: 'processing',
};

export const SettlementScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const filteredSettlements = useMemo(() => {
    if (activeFilter === 'all') return settlements;
    return settlements.filter((s) => s.status === activeFilter);
  }, [activeFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1500);
  };

  const renderSummary = () => (
    <View style={styles.summarySection}>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryIconContainer, { backgroundColor: colors.success[50] }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success[600]} />
          </View>
          <Text style={styles.summaryValue}>
            {formatCurrency(settlementSummary.totalSettled)}
          </Text>
          <Text style={styles.summaryLabel}>Total Settled</Text>
        </View>

        <View style={styles.summaryItem}>
          <View style={[styles.summaryIconContainer, { backgroundColor: '#FEF3C7' }]}>
            <Ionicons name="time" size={20} color="#B45309" />
          </View>
          <Text style={styles.summaryValue}>
            {formatCurrency(settlementSummary.pendingAmount)}
          </Text>
          <Text style={styles.summaryLabel}>Pending</Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <View style={[styles.summaryIconContainer, { backgroundColor: colors.primary[50] }]}>
            <Ionicons name="calendar" size={20} color={colors.primary[600]} />
          </View>
          <Text style={styles.summaryValue}>
            {formatCurrency(settlementSummary.thisMonthSettled)}
          </Text>
          <Text style={styles.summaryLabel}>This Month</Text>
        </View>

        <View style={styles.summaryItem}>
          <View style={[styles.summaryIconContainer, { backgroundColor: colors.accent[50] }]}>
            <Ionicons name="receipt" size={20} color={colors.accent[600]} />
          </View>
          <Text style={styles.summaryValue}>
            {formatCurrency(settlementSummary.totalCharges)}
          </Text>
          <Text style={styles.summaryLabel}>Total Charges</Text>
        </View>
      </View>

      <Button
        title="Request New Settlement"
        onPress={() => {}}
        fullWidth
        size="lg"
        icon={<Ionicons name="add-circle-outline" size={20} color={colors.white} />}
        style={styles.requestButton}
      />

      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>Settlement History</Text>
      </View>
    </View>
  );

  const renderSettlementItem = ({ item }: { item: Settlement }) => (
    <TouchableOpacity activeOpacity={0.6} style={styles.settlementItem}>
      <View style={styles.settlementTop}>
        <View style={styles.settlementInfo}>
          <Text style={styles.settlementAmount}>
            {formatCurrency(item.amount)}
          </Text>
          <Badge
            label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            variant={statusVariantMap[item.status] ?? 'default'}
          />
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} />
      </View>

      <View style={styles.settlementDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Bank</Text>
          <Text style={styles.detailValue}>{item.bankName}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Account</Text>
          <Text style={styles.detailValue}>{item.accountNumber}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Net Amount</Text>
          <Text style={[styles.detailValue, { color: colors.success[600] }]}>
            {formatCurrency(item.netAmount)}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Charges</Text>
          <Text style={styles.detailValue}>{formatCurrency(item.charges)}</Text>
        </View>
        {item.utr ? (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>UTR</Text>
            <Text style={[styles.detailValue, { fontFamily: 'monospace' }]}>
              {item.utr}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.settlementFooter}>
        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
        <Text style={styles.settlementDate}>
          {formatDateTime(item.createdAt)}
        </Text>
        {item.completedAt && (
          <>
            <Text style={styles.settlementDate}> {'\u2192'} </Text>
            <Text style={styles.settlementDate}>
              {formatDateTime(item.completedAt)}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <LinearGradient
        colors={[colors.primary[600], colors.primary[700]]}
        style={[styles.header, { paddingTop: insets.top + 12 }]}
      >
        <Text style={styles.headerTitle}>Settlement</Text>
      </LinearGradient>

      <FilterBar
        filters={filterOptions}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />

      <FlatList
        data={filteredSettlements}
        keyExtractor={(item) => item.id}
        renderItem={renderSettlementItem}
        ListHeaderComponent={renderSummary}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[600]}
          />
        }
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
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
  summarySection: {
    padding: 20,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    padding: 14,
    alignItems: 'center',
    ...shadow.sm,
  },
  summaryIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  summaryValue: {
    ...typography.bodySemibold,
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 2,
  },
  summaryLabel: {
    ...typography.small,
    color: colors.textMuted,
  },
  requestButton: {
    marginTop: 10,
  },
  listHeader: {
    marginTop: 24,
    marginBottom: 4,
  },
  sectionTitle: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  listContent: {
    paddingBottom: 20,
  },
  settlementItem: {
    backgroundColor: colors.white,
    marginHorizontal: 20,
    borderRadius: borderRadius.base,
    padding: 16,
    ...shadow.sm,
  },
  itemSeparator: {
    height: 10,
  },
  settlementTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  settlementInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settlementAmount: {
    ...typography.h4,
    color: colors.textPrimary,
  },
  settlementDetails: {
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.md,
    padding: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  detailValue: {
    ...typography.captionMedium,
    color: colors.textPrimary,
  },
  settlementFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 4,
  },
  settlementDate: {
    ...typography.small,
    color: colors.textMuted,
  },
});
