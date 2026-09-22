import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Pill, Loading, EmptyState, TpinSheet, Badge } from '@/components';
import { fetchSettlement2Accounts, fetchSettlement2Charges, settlement2Transfer, Settlement2Account } from '@/api/settlement2';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

export const Settlement2Screen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Settlement2Account | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'IMPS' | 'RTGS'>('IMPS');
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;
  const accountsQ = useQuery({ queryKey: ['s2-accounts'], queryFn: fetchSettlement2Accounts });
  const chargesQ = useQuery({
    queryKey: ['s2-charges', amt, mode],
    queryFn: () => fetchSettlement2Charges(amt, mode),
    enabled: amt >= 1,
  });

  const accounts = accountsQ.data?.accounts ?? [];

  const doTransfer = async (tpin: string) => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await settlement2Transfer({ account_id: selected.id, amount: amt, mode, tpin });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      const t = res.transaction;
      Alert.alert('Settlement submitted', `${t.status?.toUpperCase()} · ${formatCurrency(t.amount)}\nUTR: ${t.utr || '—'}\nRef: ${t.reference_id}`, [
        { text: 'Done', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title="Settlement-2" subtitle="Transfer to your bank" onBack={() => nav.goBack()} refreshing={accountsQ.isFetching} onRefresh={accountsQ.refetch}>
      <Text style={[typography.h3, { color: colors.textPrimary, marginTop: spacing.sm, marginBottom: spacing.sm }]}>Select Account</Text>
      {accountsQ.isLoading ? (
        <Loading />
      ) : accounts.length === 0 ? (
        <Card><EmptyState icon="business-outline" title="No settlement accounts" message="Add a settlement account on the web portal to continue." /></Card>
      ) : (
        accounts.map((a) => (
          <TouchableOpacity key={a.id} activeOpacity={0.7} onPress={() => setSelected(a)}>
            <Card style={[styles.acc, selected?.id === a.id && styles.accActive]}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{a.account_holder_name}</Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>{a.account_number} · {a.ifsc_code}</Text>
              </View>
              {a.verification_status ? <Badge label={a.verification_status} tone={a.verification_status.includes('verif') ? 'success' : 'warning'} /> : null}
              {selected?.id === a.id ? <Ionicons name="checkmark-circle" size={22} color={colors.primary[600]} style={{ marginLeft: 8 }} /> : null}
            </Card>
          </TouchableOpacity>
        ))
      )}

      <Card style={{ marginTop: spacing.md }}>
        <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
        <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
          <Pill label="IMPS" active={mode === 'IMPS'} onPress={() => setMode('IMPS')} />
          <Pill label="RTGS" active={mode === 'RTGS'} onPress={() => setMode('RTGS')} />
        </View>
        {chargesQ.data && (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Charges: {formatCurrency(chargesQ.data.charges?.retailer_charge)} · You transfer {formatCurrency(amt)}
          </Text>
        )}
      </Card>

      <Button title="Continue" size="lg" fullWidth style={{ marginTop: spacing.lg }} disabled={!selected || amt < 1} onPress={() => setTpinOpen(true)} />
      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doTransfer} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  acc: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  accActive: { borderWidth: 1.5, borderColor: colors.primary[400] },
});
