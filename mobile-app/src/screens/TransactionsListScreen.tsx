import React, { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { spacing } from '@/theme';
import { Screen, Card, Pill, Loading, EmptyState, ErrorState, TransactionRow } from '@/components';
import { fetchServiceTransactions, ServiceFilter } from '@/api/transactions';
import { cleanDescription } from '@/utils/format';
import { AppStackParamList } from '@/navigation/types';

const STATUS: { key: string; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'success', label: 'Success' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
];

export const TransactionsListScreen: React.FC = () => {
  const nav = useNavigation();
  const route = useRoute<RouteProp<AppStackParamList, 'TransactionsList'>>();
  const service = (route.params?.service as ServiceFilter) || 'all';
  const [status, setStatus] = useState('');

  const q = useQuery({
    queryKey: ['txn-list', service, status],
    queryFn: () => fetchServiceTransactions({ service, status: status || undefined, limit: 50 }),
  });
  const rows = q.data?.data ?? [];

  return (
    <Screen title="Transactions" subtitle={service !== 'all' ? service.toUpperCase() : 'All services'} onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {STATUS.map((s) => <Pill key={s.key} label={s.label} active={status === s.key} onPress={() => setStatus(s.key)} />)}
      </ScrollView>

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

const styles = StyleSheet.create({ sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' } });
