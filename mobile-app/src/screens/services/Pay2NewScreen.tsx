import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Loading, EmptyState, TpinSheet } from '@/components';
import { fetchPay2NewBillers, fetchPay2NewBill, payPay2NewBill, pay2NewRecharge, Pay2NewBiller } from '@/api/pay2new';
import { AppStackParamList } from '@/navigation/types';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

const TITLES = {
  'bbps': { title: 'BBPS-2', subtitle: 'Bill payments' },
  'credit-card': { title: 'Credit Card', subtitle: 'Pay credit card bill' },
  'recharge': { title: 'Recharge', subtitle: 'Mobile / DTH recharge' },
};

export const Pay2NewScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const route = useRoute<RouteProp<AppStackParamList, 'Pay2New'>>();
  const mode = route.params?.mode ?? 'bbps';
  const meta = TITLES[mode];

  const [biller, setBiller] = useState<Pay2NewBiller | null>(null);
  const [number, setNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [billRef, setBillRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;
  const billersQ = useQuery({ queryKey: ['p2n-billers', mode], queryFn: () => fetchPay2NewBillers() });
  const billers = billersQ.data?.billers ?? [];

  const onFetch = async () => {
    if (!biller || !number.trim()) return Alert.alert('Missing', 'Select a biller and enter the number.');
    setBusy(true);
    setBillRef(null);
    try {
      const res = await fetchPay2NewBill({ number: number.trim(), product_code: biller.product_code, customer_number: number.trim(), product_name: biller.product_name });
      setBillRef(res.request_id || res.order_id);
      const fetchedAmt = Number(res?.data?.amount ?? res?.data?.due_amount ?? 0);
      if (fetchedAmt > 0) setAmount(String(fetchedAmt));
    } catch (e) {
      Alert.alert('Fetch failed', e instanceof ApiError ? e.message : 'Could not fetch bill.');
    } finally {
      setBusy(false);
    }
  };

  const doPay = async (tpin: string) => {
    if (!biller) return;
    setSubmitting(true);
    try {
      const res = await payPay2NewBill({
        number: number.trim(),
        amount: amt,
        product_code: biller.product_code,
        bill_fetch_ref: billRef || '',
        customer_number: number.trim(),
        product_name: biller.product_name,
        tpin,
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(res.success ? 'Payment successful' : 'Payment status', `Order: ${res.order_id}\nRef: ${res.operator_reference || '—'}`, [{ text: 'Done', onPress: () => nav.goBack() }]);
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Payment failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const doRecharge = async () => {
    if (!biller || amt < 1 || !number.trim()) return Alert.alert('Missing', 'Fill all fields.');
    setSubmitting(true);
    try {
      const res = await pay2NewRecharge({ number: number.trim(), amount: amt, product_code: biller.product_code });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(res.success ? 'Recharge successful' : 'Recharge status', `Order: ${res.order_id}\nRef: ${res.operator_reference || '—'}`, [{ text: 'Done', onPress: () => nav.goBack() }]);
    } catch (e) {
      Alert.alert('Recharge failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const numberLabel = mode === 'credit-card' ? 'Card Number' : mode === 'recharge' ? 'Mobile / DTH Number' : 'Consumer Number';

  return (
    <Screen title={meta.title} subtitle={meta.subtitle} onBack={() => nav.goBack()}>
      <Text style={styles.label}>Select {mode === 'recharge' ? 'Operator' : 'Biller'}</Text>
      {billersQ.isLoading ? <Loading /> : billers.length === 0 ? (
        <Card><EmptyState title="No billers" message="None available right now." /></Card>
      ) : (
        <Card padded={false} style={{ maxHeight: 220 }}>
          <ScrollView>
            {billers.map((b, i) => (
              <TouchableOpacity key={b.product_code || i} style={[styles.row, biller?.product_code === b.product_code && { backgroundColor: colors.primary[50] }]} onPress={() => setBiller(b)}>
                <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>{b.product_name}</Text>
                {biller?.product_code === b.product_code ? <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} /> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Card>
      )}

      {biller && (
        <Card style={{ marginTop: spacing.md }}>
          <Input label={numberLabel} icon="keypad-outline" value={number} onChangeText={setNumber} keyboardType={mode === 'credit-card' || mode === 'recharge' ? 'number-pad' : 'default'} placeholder={`Enter ${numberLabel.toLowerCase()}`} />
          {mode !== 'recharge' && <Button title="Fetch Bill" variant="outline" icon="search-outline" loading={busy} onPress={onFetch} style={{ marginBottom: spacing.md }} />}
          <Input label="Amount (₹)" icon="cash-outline" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
        </Card>
      )}

      {biller && amt >= 1 && (
        mode === 'recharge' ? (
          <Button title={`Recharge ${formatCurrency(amt)}`} size="lg" fullWidth loading={submitting} style={{ marginTop: spacing.lg }} onPress={doRecharge} />
        ) : (
          <Button title={`Pay ${formatCurrency(amt)}`} size="lg" fullWidth style={{ marginTop: spacing.lg }} onPress={() => setTpinOpen(true)} />
        )
      )}

      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doPay} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  label: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
