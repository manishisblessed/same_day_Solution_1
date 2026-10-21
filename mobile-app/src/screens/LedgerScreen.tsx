import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';
import { Screen, Card, Loading, EmptyState, ErrorState, TransactionRow, DateRangeFilter, DateRange, ExportReportSheet } from '@/components';
import { fetchLedger } from '@/api/wallet';
import { cleanDescription } from '@/utils/format';
import { exportReport } from '@/utils/exportReport';

const COLS = ['Date', 'Description', 'Type', 'Reference', 'Before Balance', 'Amount', 'After Balance', 'Status'];

const mapRows = (rows: any[]) => rows.map((t) => ({
  Date: t.created_at ? new Date(t.created_at).toLocaleString('en-IN') : '',
  Description: cleanDescription(t.description) || '',
  Type: t.transaction_type || '',
  Reference: t.reference_id || '',
  'Before Balance': t.before_balance ?? '',
  Amount: t.amount,
  'After Balance': t.after_balance ?? '',
  Status: t.status || '',
}));

export const LedgerScreen: React.FC = () => {
  const nav = useNavigation();
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ['ledger', dateRange],
    queryFn: () => fetchLedger({ limit: 200, date_from: dateRange?.from, date_to: dateRange?.to }),
  });
  const rows = q.data?.data ?? [];

  const handleExport = async (exportRange: DateRange | null, format: 'csv' | 'pdf') => {
    setExporting(true);
    try {
      const sameRange =
        exportRange?.from === dateRange?.from && exportRange?.to === dateRange?.to;
      let dataRows = rows;
      if (!sameRange) {
        const res = await fetchLedger({ limit: 500, date_from: exportRange?.from, date_to: exportRange?.to });
        dataRows = res.data ?? [];
      }
      await exportReport({
        title: 'Wallet Ledger',
        filename: `ledger_${Date.now()}`,
        columns: COLS,
        rows: mapRows(dataRows),
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
    <Screen title="Ledger" subtitle="Wallet movement history" onBack={() => nav.goBack()} refreshing={q.isRefetching} onRefresh={q.refetch} right={downloadBtn}>
      <ExportReportSheet
        visible={showExport}
        onClose={() => setShowExport(false)}
        title="Wallet Ledger"
        recordCount={rows.length}
        currentDateRange={dateRange}
        onExport={handleExport}
        loading={exporting}
      />
      <View style={{ marginBottom: spacing.md }}>
        <DateRangeFilter range={dateRange} onChange={setDateRange} />
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <Card><EmptyState title="Empty ledger" message="No entries yet." /></Card>
      ) : (
        <Card>
          {rows.map((t, i) => (
            <View key={t.id || i}>
              <TransactionRow
                title={cleanDescription(t.description) || t.transaction_type || 'Entry'}
                subtitle={t.reference_id}
                amount={t.amount}
                credit={(t.transaction_type || '').toLowerCase().includes('credit')}
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

const styles = StyleSheet.create({ sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' } });
