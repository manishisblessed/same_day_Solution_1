import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';
import { Screen, Card, Input, Button, Pill, Loading, EmptyState, TpinSheet } from '@/components';
import { fetchBbpsCategories, fetchBbpsBillers, fetchBill, payBill, BbpsBiller } from '@/api/bbps';
import { ApiError } from '@/lib/api';
import { formatCurrency, toPaise } from '@/utils/format';

export const BbpsScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('');
  const [biller, setBiller] = useState<BbpsBiller | null>(null);
  const [consumer, setConsumer] = useState('');
  const [bill, setBill] = useState<{ amount: number; name?: string; reqId?: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const catQ = useQuery({ queryKey: ['bbps-cats'], queryFn: fetchBbpsCategories });
  const billerQ = useQuery({ queryKey: ['bbps-billers', category], queryFn: () => fetchBbpsBillers(category), enabled: !!category });

  const categories = catQ.data?.categories ?? [];
  const billers = billerQ.data?.billers ?? [];

  const onFetchBill = async () => {
    if (!biller || !consumer.trim()) return Alert.alert('Missing', 'Select a biller and enter consumer number.');
    setFetching(true);
    setBill(null);
    try {
      const res = await fetchBill({ biller_id: biller.biller_id, consumer_number: consumer.trim() });
      const amt = Number(res?.bill?.amount ?? res?.data?.billerResponse?.amount ?? 0);
      setBill({
        amount: isNaN(amt) ? 0 : amt / (amt > 100000 ? 100 : 1),
        name: res?.bill?.customerName || res?.data?.billerResponse?.customerName,
        reqId: res.reqId,
      });
    } catch (e) {
      Alert.alert('Bill fetch failed', e instanceof ApiError ? e.message : 'Could not fetch bill.');
    } finally {
      setFetching(false);
    }
  };

  const doPay = async (tpin: string) => {
    if (!biller || !bill) return;
    setSubmitting(true);
    try {
      const res = await payBill({
        biller_id: biller.biller_id,
        consumer_number: consumer.trim(),
        amount: toPaise(bill.amount),
        biller_name: biller.biller_name,
        biller_category: category,
        reqId: bill.reqId,
        tpin,
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(res.success ? 'Payment successful' : 'Payment status', `${(res.payment_status || res.status || '').toUpperCase()}\nTxn: ${res.transaction_id || res.bbps_transaction_id || '—'}${res.error_message ? `\n${res.error_message}` : ''}`, [
        { text: 'Done', onPress: () => nav.goBack() },
      ]);
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Payment failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen title="BBPS Bills" subtitle="Bill payments" onBack={() => nav.goBack()}>
      <Text style={styles.label}>Category</Text>
      {catQ.isLoading ? <Loading /> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {categories.map((c) => (
            <Pill key={c.name} label={c.name} active={category === c.name} onPress={() => { setCategory(c.name); setBiller(null); setBill(null); }} />
          ))}
        </ScrollView>
      )}

      {!!category && (
        <>
          <Text style={styles.label}>Biller</Text>
          {billerQ.isLoading ? <Loading /> : billers.length === 0 ? (
            <Card><EmptyState title="No billers" message="Try another category." /></Card>
          ) : (
            <Card padded={false} style={{ maxHeight: 240 }}>
              <ScrollView>
                {billers.map((b, i) => (
                  <TouchableOpacity key={b.biller_id || i} style={[styles.billerRow, biller?.biller_id === b.biller_id && { backgroundColor: colors.primary[50] }]} onPress={() => { setBiller(b); setBill(null); }}>
                    <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]} numberOfLines={1}>{b.biller_name}</Text>
                    {biller?.biller_id === b.biller_id ? <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} /> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Card>
          )}
        </>
      )}

      {biller && (
        <Card style={{ marginTop: spacing.md }}>
          <Input label="Consumer Number" icon="person-outline" value={consumer} onChangeText={(t) => { setConsumer(t); setBill(null); }} placeholder="Enter consumer / account number" />
          <Button title="Fetch Bill" variant="outline" icon="search-outline" loading={fetching} onPress={onFetchBill} />
          {bill && (
            <View style={styles.billBox}>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>{bill.name || 'Bill amount'}</Text>
              <Text style={[typography.h1, { color: colors.textPrimary }]}>{formatCurrency(bill.amount)}</Text>
            </View>
          )}
        </Card>
      )}

      {bill && bill.amount > 0 && (
        <Button title={`Pay ${formatCurrency(bill.amount)}`} size="lg" fullWidth style={{ marginTop: spacing.lg }} onPress={() => setTpinOpen(true)} />
      )}

      <TpinSheet visible={tpinOpen} amount={bill?.amount} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doPay} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  label: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  billerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  billBox: { marginTop: spacing.md, backgroundColor: colors.primary[50], borderRadius: radius.base, padding: spacing.base, alignItems: 'center' },
});
