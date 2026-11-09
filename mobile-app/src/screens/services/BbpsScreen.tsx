import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Input, Button, Pill, Loading, EmptyState, TpinSheet, TransactionReceiptModal, ReceiptData } from '@/components';
import { fetchBbpsCategories, fetchBbpsBillers, fetchBill, payBill, BbpsBiller } from '@/api/bbps';
import { ApiError } from '@/lib/api';
import { formatCurrency, toPaise } from '@/utils/format';

/** Format YYYY-MM-DD or ISO string → DD/MM/YYYY */
const formatBillDate = (raw: string) => {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return raw;
  }
};

/** Red highlight if due within 3 days */
const isDueSoon = (raw: string) => {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return false;
    return d.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

export const BbpsScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string>('');
  const [biller, setBiller] = useState<BbpsBiller | null>(null);
  const [consumer, setConsumer] = useState('');
  const [bill, setBill] = useState<{ amount: number; name?: string; reqId?: string; dueDate?: string; billDate?: string } | null>(null);
  const [fetching, setFetching] = useState(false);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

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
      const rawDue = res?.bill?.due_date || res?.data?.billerResponse?.dueDate;
      const rawBill = res?.bill?.bill_date || res?.data?.billerResponse?.billDate;
      setBill({
        amount: isNaN(amt) ? 0 : amt / (amt > 100000 ? 100 : 1),
        name: res?.bill?.customerName || res?.data?.billerResponse?.customerName,
        reqId: res.reqId,
        dueDate: rawDue || undefined,
        billDate: rawBill || undefined,
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
      const ps = (res.payment_status || res.status || '').toLowerCase();
      setReceipt({
        status: ps === 'success' ? 'success' : ps === 'failed' ? 'failed' : 'pending',
        service: 'BBPS Bill Payment',
        subService: biller?.biller_name,
        amount: bill!.amount,
        transactionId: res.transaction_id || res.bbps_transaction_id,
        customerName: bill?.name,
        message: res.error_message || undefined,
        timestamp: new Date().toISOString(),
      });
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
          {categories.map((c, i) => (
            <Pill key={`${c}-${i}`} label={c} active={category === c} onPress={() => { setCategory(c); setBiller(null); setBill(null); }} />
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
            <View style={styles.billCard}>
              {/* Header */}
              <View style={styles.billCardHeader}>
                <View style={styles.billCardIcon}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success[500]} />
                </View>
                <Text style={[typography.captionMedium, { color: colors.success[600] }]}>Bill Fetched</Text>
              </View>

              {/* Customer name */}
              {!!bill.name && (
                <View style={{ marginBottom: spacing.sm }}>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>Customer Name</Text>
                  <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{bill.name}</Text>
                </View>
              )}

              {/* Amount — prominent */}
              <View style={styles.billAmountRow}>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>Due Amount</Text>
                <Text style={[typography.h2, { color: colors.primary[700] }]}>{formatCurrency(bill.amount)}</Text>
              </View>

              {/* Due date & Bill date */}
              {(!!bill.dueDate || !!bill.billDate) && (
                <View style={styles.billDatesRow}>
                  {!!bill.billDate && (
                    <View style={styles.billDateItem}>
                      <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                      <View style={{ marginLeft: 6 }}>
                        <Text style={[typography.small, { color: colors.textSecondary }]}>Bill Date</Text>
                        <Text style={[typography.captionMedium, { color: colors.textPrimary }]}>{formatBillDate(bill.billDate)}</Text>
                      </View>
                    </View>
                  )}
                  {!!bill.dueDate && (
                    <View style={[styles.billDateItem, !!bill.billDate && styles.billDateItemBorder]}>
                      <Ionicons name="alarm-outline" size={14} color={isDueSoon(bill.dueDate) ? colors.danger[500] : colors.textSecondary} />
                      <View style={{ marginLeft: 6 }}>
                        <Text style={[typography.small, { color: colors.textSecondary }]}>Due Date</Text>
                        <Text style={[typography.captionMedium, { color: isDueSoon(bill.dueDate) ? colors.danger[600] : colors.textPrimary }]}>{formatBillDate(bill.dueDate)}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
        </Card>
      )}

      {bill && bill.amount > 0 && (
        <Button title={`Pay ${formatCurrency(bill.amount)}`} size="lg" fullWidth style={{ marginTop: spacing.lg }} onPress={() => setTpinOpen(true)} />
      )}

      <TpinSheet visible={tpinOpen} amount={bill?.amount} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doPay} />
      <TransactionReceiptModal visible={!!receipt} data={receipt} onDone={() => { setReceipt(null); nav.goBack(); }} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  label: { ...typography.captionMedium, color: colors.textPrimary, marginBottom: spacing.sm },
  billerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  billCard: {
    backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.base,
    marginTop: spacing.md, borderWidth: 1, borderColor: colors.success[100],
    ...shadow.sm,
  },
  billCardHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm,
    paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  billCardIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.success[50],
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  billAmountRow: {
    backgroundColor: colors.primary[50], borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
    alignItems: 'center', marginBottom: spacing.sm,
  },
  billDatesRow: { flexDirection: 'row', gap: spacing.sm },
  billDateItem: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  billDateItemBorder: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: spacing.sm },
});
