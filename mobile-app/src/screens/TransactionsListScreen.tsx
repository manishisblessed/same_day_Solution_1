import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Pill, Loading, EmptyState, ErrorState, TransactionRow, DateRangeFilter, DateRange, ExportReportSheet } from '@/components';
import { fetchServiceTransactions, ServiceFilter } from '@/api/transactions';
import { cleanDescription } from '@/utils/format';
import { exportReport } from '@/utils/exportReport';
import { AppStackParamList } from '@/navigation/types';

const STATUS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'success', label: 'Success' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
];

const COLS = ['Date', 'Description', 'Service', 'Transaction ID', 'Amount', 'Status'];

const mapTxnRows = (rows: any[]) => rows.map((t) => ({
  Date: t.created_at ? new Date(t.created_at).toLocaleString('en-IN') : '',
  Description: cleanDescription(t.description) || '',
  Service: t.service_type || '',
  'Transaction ID': t.transaction_id || t.tid || '',
  Amount: t.amount,
  Status: t.status || '',
}));

export const TransactionsListScreen: React.FC = () => {
  const nav = useNavigation();
  const route = useRoute<RouteProp<AppStackParamList, 'TransactionsList'>>();
  const service = (route.params?.service as ServiceFilter) || 'all';
  const [status, setStatus] = useState('');
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [search, setSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ['txn-list', service, status, dateRange, search],
    queryFn: () => fetchServiceTransactions({
      service,
      status: status || undefined,
      date_from: dateRange?.from,
      date_to: dateRange?.to,
      search: search.trim() || undefined,
      limit: 200,
    }),
  });
  const rows = q.data?.data ?? [];

  const subtitle = service !== 'all' ? service.toUpperCase() : 'All Services';

  const handleExport = async (exportRange: DateRange | null, format: 'csv' | 'pdf') => {
    setExporting(true);
    try {
      const sameRange =
        exportRange?.from === dateRange?.from && exportRange?.to === dateRange?.to;
      let dataRows = rows;
      if (!sameRange) {
        const res = await fetchServiceTransactions({
          service,
          status: status || undefined,
          date_from: exportRange?.from,
          date_to: exportRange?.to,
          search: search.trim() || undefined,
          limit: 500,
        });
        dataRows = res.data ?? [];
      }
      const titleStr = `Transactions — ${subtitle}${status ? ` (${status})` : ''}${exportRange ? ` ${exportRange.from} to ${exportRange.to}` : ''}`;
      await exportReport({
        title: titleStr,
        filename: `txn_${service}_${Date.now()}`,
        columns: COLS,
        rows: mapTxnRows(dataRows),
        format,
      });
    } finally {
      setExporting(false);
      setShowExport(false);
    }
  };

  const downloadBtn = rows.length > 0 ? (
    <TouchableOpacity onPress={() => setShowExport(true)} hitSlop={8} style={{ padding: 4 }}>
      <Ionicons name="download-outline" size={22} color={colors.primary[600]} />
    </TouchableOpacity>
  ) : null;

  return (
    <Screen
      title="Transactions"
      subtitle={service !== 'all' ? service.toUpperCase() : 'All services'}
      onBack={() => nav.goBack()}
      refreshing={q.isRefetching}
      onRefresh={q.refetch}
      right={downloadBtn}
    >
      <ExportReportSheet
        visible={showExport}
        onClose={() => setShowExport(false)}
        title={`Transactions — ${subtitle}`}
        recordCount={rows.length}
        currentDateRange={dateRange}
        onExport={handleExport}
        loading={exporting}
      />
      {/* Status filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
        {STATUS.map((s) => <Pill key={s.key} label={s.label} active={status === s.key} onPress={() => setStatus(s.key)} />)}
      </ScrollView>

      {/* Date range + search */}
      <View style={styles.filterRow}>
        <DateRangeFilter range={dateRange} onChange={setDateRange} />
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={14} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search…"
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <Card><EmptyState title="No transactions" message="Nothing matches this filter." /></Card>
      ) : (
        <Card>
          {rows.map((t, i) => (
            <View key={t.id || i}>
              <TransactionRow
                title={cleanDescription(t.description) || t.service_type?.toUpperCase() || 'Transaction'}
                subtitle={t.transaction_id || t.tid}
                amount={t.amount}
                status={t.status}
                date={t.created_at}
                service={t.service_type}
              />
              {i < rows.length - 1 ? <View style={styles.sep} /> : null}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.full,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, ...typography.caption, color: colors.textPrimary, padding: 0 },
});
