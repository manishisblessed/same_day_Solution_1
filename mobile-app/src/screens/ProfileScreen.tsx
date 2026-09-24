import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Badge } from '@/components';
import { useAuth } from '@/contexts/AuthContext';
import { useServices } from '@/contexts/ServicesContext';
import { useAppLock } from '@/contexts/AppLockContext';
import { fetchTpinStatus } from '@/api/auth';
import { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const Row: React.FC<{ icon: string; label: string; value?: string; onPress?: () => void; danger?: boolean; right?: React.ReactNode }> = ({
  icon, label, value, onPress, danger, right,
}) => (
  <TouchableOpacity style={styles.row} activeOpacity={onPress ? 0.6 : 1} onPress={onPress} disabled={!onPress}>
    <Ionicons name={icon as any} size={20} color={danger ? colors.danger[500] : colors.textSecondary} />
    <Text style={[typography.body, { color: danger ? colors.danger[500] : colors.textPrimary, flex: 1, marginLeft: spacing.md }]}>{label}</Text>
    {value ? <Text style={[typography.caption, { color: colors.textMuted, marginRight: 6 }]}>{value}</Text> : null}
    {right}
    {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
  </TouchableOpacity>
);

export const ProfileScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const { user, signOut } = useAuth();
  const { visible } = useServices();
  const { enabled: lockEnabled, supported: lockSupported, enrolled, toggle: toggleLock } = useAppLock();
  const tpinQ = useQuery({ queryKey: ['tpin-status'], queryFn: fetchTpinStatus });

  const onToggleLock = async (next: boolean) => {
    if (next && (!lockSupported || !enrolled)) {
      Alert.alert('Not available', 'Set up fingerprint or face unlock in your device settings first.');
      return;
    }
    const ok = await toggleLock(next);
    if (!ok) Alert.alert('Failed', 'Authentication was not completed.');
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const roleLabel =
    user?.role === 'master_partner' ? 'Master Partner'
    : user?.role === 'partner' || user?.role === 'sub_partner' ? 'Partner'
    : 'Retailer';

  return (
    <Screen title="Profile">
      <Card style={{ marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.xl }}>
        <View style={styles.avatarRing}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
        </View>
        <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.md }]}>{user?.name || 'User'}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>{user?.email}</Text>
        <View style={{ marginTop: 10 }}><Badge label={`${roleLabel} · ${user?.partner_id || ''}`} tone="info" /></View>
      </Card>

      <Text style={styles.section}>Security</Text>
      <Card padded={false}>
        <Row
          icon="shield-checkmark-outline"
          label={tpinQ.data?.has_tpin ? 'Change TPIN' : 'Set TPIN'}
          value={tpinQ.data ? (tpinQ.data.is_locked ? 'Locked' : tpinQ.data.has_tpin ? 'Set' : 'Not set') : undefined}
          onPress={() => nav.navigate('Tpin')}
        />
        <View style={styles.sep} />
        <Row
          icon="finger-print-outline"
          label="App Lock (biometric)"
          right={
            <Switch
              value={lockEnabled}
              onValueChange={onToggleLock}
              trackColor={{ true: colors.primary[500] }}
              thumbColor={colors.white}
            />
          }
        />
      </Card>

      <Text style={styles.section}>Account</Text>
      <Card padded={false}>
        <Row icon="grid-outline" label="Enabled services" value={String(visible.length)} onPress={() => nav.navigate('Tabs', { screen: 'Services' } as any)} />
        <View style={styles.sep} />
        <Row icon="document-text-outline" label="Ledger" onPress={() => nav.navigate('Ledger')} />
        <View style={styles.sep} />
        <Row icon="swap-horizontal-outline" label="Transaction history" onPress={() => nav.navigate('TransactionsList')} />
      </Card>

      <Text style={styles.section}>About</Text>
      <Card padded={false}>
        <Row icon="information-circle-outline" label="App version" value={Constants.expoConfig?.version || '1.0.0'} />
        <View style={styles.sep} />
        <Row icon="log-out-outline" label="Sign out" danger onPress={confirmSignOut} />
      </Card>
      <View style={{ height: spacing['2xl'] }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  avatarRing: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 2.5, borderColor: colors.secondary[500],
    alignItems: 'center', justifyContent: 'center',
  },
  avatar: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...typography.h1, color: colors.white },
  section: { ...typography.overline, color: colors.textMuted, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.base },
});
