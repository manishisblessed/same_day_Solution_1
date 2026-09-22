import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing, typography } from '@/theme';
import { Screen, Card, Loading, EmptyState, ErrorState, Badge } from '@/components';
import { fetchSchemeMappings } from '@/api/schemes';

export const MdrSchemesScreen: React.FC = () => {
  const nav = useNavigation();
  const q = useQuery({ queryKey: ['scheme-mappings'], queryFn: () => fetchSchemeMappings() });
  const rows = q.data?.data ?? [];

  return (
    <Screen title="MDR Schemes" subtitle="Your assigned rate plans" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon="pricetags-outline" title="No schemes" message="No MDR schemes assigned yet." /></Card>
      ) : (
        rows.map((s: any, i: number) => (
          <Card key={s.id || i} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary, flex: 1 }]}>{s.scheme_name || s.schemes?.name || s.scheme_id || 'Scheme'}</Text>
              {s.status ? <Badge label={s.status} tone={s.status === 'active' ? 'success' : 'neutral'} /> : null}
            </View>
            {s.service_type ? <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 4 }]}>{s.service_type}</Text> : null}
            {(s.mdr_rate != null || s.rate != null) ? <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>Rate: {s.mdr_rate ?? s.rate}%</Text> : null}
          </Card>
        ))
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({});
