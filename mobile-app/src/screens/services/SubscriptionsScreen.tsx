import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography } from '@/theme';
import { Screen, Card, Loading, EmptyState, ErrorState, Badge, statusTone } from '@/components';
import { fetchSubscriptions } from '@/api/subscriptions';
import { formatCurrency, formatDate } from '@/utils/format';

export const SubscriptionsScreen: React.FC = () => {
  const nav = useNavigation();
  const q = useQuery({ queryKey: ['subscriptions'], queryFn: fetchSubscriptions });
  const items = q.data?.items ?? [];
  const debits = q.data?.debits ?? [];
  const sub = q.data?.subscription;

  return (
    <Screen title="Subscriptions" subtitle="POS rental & plans" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : !sub && items.length === 0 ? (
        <Card><EmptyState icon="repeat-outline" title="No subscriptions" message="You have no active subscriptions." /></Card>
      ) : (
        <>
          {sub && (
            <Card style={{ marginTop: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[typography.h3, { color: colors.textPrimary }]}>Current Plan</Text>
                {sub.status ? <Badge label={sub.status} tone={statusTone(sub.status)} /> : null}
              </View>
              {sub.next_billing_date ? <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>Next billing: {formatDate(sub.next_billing_date, 'dd MMM yyyy')}</Text> : null}
            </Card>
          )}

          {items.length > 0 && (
            <>
              <Text style={styles.section}>Items</Text>
              <Card padded={false}>
                {items.map((it: any, i: number) => (
                  <View key={it.id || i} style={[styles.row, i < items.length - 1 && styles.border]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.body, { color: colors.textPrimary }]}>{it.subscription_products?.name || it.product_name || 'Item'}</Text>
                      {it.device_serial ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{it.device_serial}</Text> : null}
                    </View>
                    <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{formatCurrency(it.amount)}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          {debits.length > 0 && (
            <>
              <Text style={styles.section}>Recent Debits</Text>
              <Card padded={false}>
                {debits.slice(0, 10).map((d: any, i: number) => (
                  <View key={d.id || i} style={[styles.row, i < Math.min(debits.length, 10) - 1 && styles.border]}>
                    <Text style={[typography.caption, { color: colors.textSecondary, flex: 1 }]}>{formatDate(d.created_at, 'dd MMM yyyy')}</Text>
                    <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginRight: 8 }]}>{formatCurrency(d.amount)}</Text>
                    {d.status ? <Badge label={d.status} tone={statusTone(d.status)} /> : null}
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  section: { ...typography.overline, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14 },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
