import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { Screen, Card, Loading, EmptyState, ErrorState, Badge, statusTone, Button } from '@/components';
import { fetchMyMachines } from '@/api/pos';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export const PosMachinesScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const q = useQuery({ queryKey: ['my-machines'], queryFn: () => fetchMyMachines({ limit: 50 }) });
  const machines = q.data?.data ?? [];

  return (
    <Screen title="POS Machines" subtitle="Assigned terminals" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      <Button title="View POS Transactions" variant="outline" icon="swap-horizontal" style={{ marginTop: spacing.sm, marginBottom: spacing.md }} onPress={() => nav.navigate('TransactionsList', { service: 'pos' })} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : machines.length === 0 ? (
        <Card><EmptyState icon="hardware-chip-outline" title="No machines" message="You don't have any POS machines assigned." /></Card>
      ) : (
        machines.map((m, i) => (
          <Card key={m.id || i} style={styles.card}>
            <View style={styles.iconWrap}><Ionicons name="hardware-chip" size={22} color={colors.primary[600]} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{m.device_serial || m.tid || 'POS Terminal'}</Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{m.machine_type || 'POS'}{m.tid ? ` · TID ${m.tid}` : ''}</Text>
            </View>
            {m.status ? <Badge label={m.status} tone={statusTone(m.status)} /> : null}
          </Card>
        ))
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  iconWrap: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
});
