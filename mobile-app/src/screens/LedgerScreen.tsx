import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Card, Loading, EmptyState, ErrorState, TransactionRow } from '@/components';
import { fetchLedger } from '@/api/wallet';
import { cleanDescription } from '@/utils/format';

export const LedgerScreen: React.FC = () => {
  const nav = useNavigation();
  const q = useQuery({ queryKey: ['ledger'], queryFn: () => fetchLedger({ limit: 60 }) });
  const rows = q.data?.data ?? [];

  return (
    <Screen title="Ledger" subtitle="Wallet movement history" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
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
