import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, IconTile, EmptyState, Card } from '@/components';
import { useServices } from '@/contexts/ServicesContext';
import { ServiceDef } from '@/api/services';
import { routeToService } from './DashboardScreen';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const GROUP_TITLES: Record<ServiceDef['group'], string> = {
  core: 'Core', payments: 'Payments & Bills', banking: 'Banking', reports: 'Reports', account: 'Account',
};

export const ServicesHubScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const { visible, loading, refetch } = useServices();

  const groups = ['banking', 'payments', 'account'] as ServiceDef['group'][];

  return (
    <Screen title="Services" subtitle="Managed by your admin" refreshing={loading} onRefresh={refetch}>
      {visible.length === 0 ? (
        <Card style={{ marginTop: spacing.lg }}>
          <EmptyState
            icon="lock-closed-outline"
            title="No services enabled"
            message="Services are enabled by your admin. Once they turn something on, it appears here instantly."
          />
        </Card>
      ) : (
        groups.map((g) => {
          const items = visible.filter((s) => s.group === g);
          if (items.length === 0) return null;
          return (
            <View key={g} style={{ marginTop: spacing.lg }}>
              <Text style={[typography.overline, { color: colors.textMuted, marginBottom: spacing.sm }]}>{GROUP_TITLES[g]}</Text>
              <View style={styles.grid}>
                {items.map((s) => (
                  <TouchableOpacity key={s.id} style={styles.tile} activeOpacity={0.75} onPress={() => routeToService(nav, s.id)}>
                    <IconTile icon={s.icon as any} color={s.color} size={48} />
                    <Text style={styles.label} numberOfLines={2}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    width: '30.5%', backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing.base, alignItems: 'center', ...shadow.sm,
  },
  label: { ...typography.captionMedium, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center', paddingHorizontal: 4 },
});
