import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { spacing } from '@/theme';
import { Screen, Card, StatCard, Loading, EmptyState, ErrorState, TransactionRow } from '@/components';
import { fetchPushPull } from '@/api/wallet';
import { formatCurrency } from '@/utils/format';

export const PushPullScreen: React.FC = () => {
  const nav = useNavigation();
  const q = useQuery({ queryKey: ['push-pull'], queryFn: () => fetchPushPull({ limit: 50 }) });
  const entries = q.data?.entries ?? [];
  const summary = q.data?.summary;

  return (
    <Screen title="Push / Pull" subtitle="Fund transfers from your network" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      {summary && (
        <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
          <StatCard label="Total Push" value={formatCurrency(summary.totalPush, { compact: true })} icon="arrow-down-circle" color="#16A34A" />
          <StatCard label="Total Pull" value={formatCurrency(summary.totalPull, { compact: true })} icon="arrow-up-circle" color="#DC2626" />
        </View>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : entries.length === 0 ? (
        <Card><EmptyState title="No entries" message="Push/pull activity will appear here." /></Card>
      ) : (
        <Card>
          {entries.map((e, i) => (
            <View key={e.id || i}>
              <TransactionRow
                title={`${e.action_type === 'push' ? 'Push' : 'Pull'} · ${e.fund_category || e.wallet_type || ''}`}
                subtitle={e.performed_by || e.reference_id}
                amount={e.amount}
                credit={e.action_type === 'push'}
                date={e.created_at}
              />
              {i < entries.length - 1 ? <View style={styles.sep} /> : null}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({ sep: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E7EB' } });
