import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Input, Button, IconTile, Loading, EmptyState, ErrorState, TpinSheet } from '@/components';
import { fetchPay2NewBillers, fetchPay2NewBill, fetchPay2NewCharges, payPay2NewBill, pay2NewRecharge, Pay2NewBiller } from '@/api/pay2new';
import { AppStackParamList } from '@/navigation/types';
import { ApiError } from '@/lib/api';
import { formatCurrency } from '@/utils/format';

/** Mirrors the web Pay2NewServiceHub — service_id per Pay2New servicesList. */
interface P2NService {
  id: string;
  label: string;
  desc: string;
  serviceId: number;
  mode: 'bill' | 'recharge';
  icon: string;
  color: string;
  category: 'recharge' | 'utility' | 'finance' | 'other';
  numberLabel: string;
  numberPlaceholder: string;
  numberMaxLength?: number;
  digitsOnly?: boolean;
  /** Credit card collects last-4 + registered mobile. */
  needsMobile?: boolean;
}

const SERVICES: P2NService[] = [
  { id: 'mobile-prepaid', label: 'Mobile Prepaid', desc: 'Recharge any prepaid number', serviceId: 1, mode: 'recharge', category: 'recharge', icon: 'phone-portrait', color: '#2563EB', numberLabel: 'Mobile Number', numberPlaceholder: '10-digit mobile', numberMaxLength: 10, digitsOnly: true },
  { id: 'dth', label: 'DTH Recharge', desc: 'Recharge your TV connection', serviceId: 3, mode: 'recharge', category: 'recharge', icon: 'tv', color: '#9333EA', numberLabel: 'Subscriber ID', numberPlaceholder: 'Enter subscriber ID', digitsOnly: true },
  { id: 'fastag', label: 'FASTag', desc: 'Recharge FASTag wallet', serviceId: 9, mode: 'recharge', category: 'recharge', icon: 'car', color: '#0891B2', numberLabel: 'Vehicle Number', numberPlaceholder: 'e.g. MH12AB1234' },
  { id: 'mobile-postpaid', label: 'Mobile Postpaid', desc: 'Pay postpaid mobile bill', serviceId: 2, mode: 'bill', category: 'utility', icon: 'call', color: '#4F46E5', numberLabel: 'Mobile Number', numberPlaceholder: '10-digit mobile', numberMaxLength: 10, digitsOnly: true },
  { id: 'electricity', label: 'Electricity', desc: 'Pay electricity bill', serviceId: 8, mode: 'bill', category: 'utility', icon: 'flash', color: '#EA580C', numberLabel: 'Consumer Number', numberPlaceholder: 'Enter consumer number' },
  { id: 'gas', label: 'Piped Gas', desc: 'Pay piped gas bill', serviceId: 11, mode: 'bill', category: 'utility', icon: 'flame', color: '#DC2626', numberLabel: 'Account Number', numberPlaceholder: 'Enter account number' },
  { id: 'water', label: 'Water', desc: 'Pay water bill', serviceId: 22, mode: 'bill', category: 'utility', icon: 'water', color: '#0891B2', numberLabel: 'Consumer Number', numberPlaceholder: 'Enter consumer number' },
  { id: 'broadband', label: 'Broadband', desc: 'Pay internet / landline bill', serviceId: 15, mode: 'bill', category: 'utility', icon: 'wifi', color: '#2563EB', numberLabel: 'Account / User ID', numberPlaceholder: 'Enter account number' },
  { id: 'lpg', label: 'LPG Cylinder', desc: 'Book LPG / pay bill', serviceId: 10, mode: 'bill', category: 'utility', icon: 'flame-outline', color: '#EA580C', numberLabel: 'Consumer / LPG ID', numberPlaceholder: 'Enter consumer number' },
  { id: 'cable', label: 'Cable TV', desc: 'Pay cable TV bill', serviceId: 4, mode: 'bill', category: 'utility', icon: 'tv-outline', color: '#DB2777', numberLabel: 'Subscriber ID', numberPlaceholder: 'Enter subscriber ID' },
  { id: 'municipal', label: 'Municipal Tax', desc: 'Property / municipal tax', serviceId: 20, mode: 'bill', category: 'utility', icon: 'business', color: '#4F46E5', numberLabel: 'Account / Property ID', numberPlaceholder: 'Enter account number' },
  { id: 'credit-card', label: 'Credit Card', desc: 'Pay any credit card bill', serviceId: 34, mode: 'bill', category: 'finance', icon: 'card', color: '#9333EA', numberLabel: 'Last 4 Digits of Card', numberPlaceholder: 'e.g. 1266', numberMaxLength: 4, digitsOnly: true, needsMobile: true },
  { id: 'insurance', label: 'Insurance', desc: 'Pay insurance premium', serviceId: 14, mode: 'bill', category: 'finance', icon: 'shield-checkmark', color: '#16A34A', numberLabel: 'Policy Number', numberPlaceholder: 'Enter policy number' },
  { id: 'loan', label: 'Loan EMI', desc: 'Repay loan installment', serviceId: 17, mode: 'bill', category: 'finance', icon: 'cash', color: '#059669', numberLabel: 'Loan Account Number', numberPlaceholder: 'Enter loan account' },
  { id: 'education', label: 'Education Fees', desc: 'School / college fees', serviceId: 19, mode: 'bill', category: 'other', icon: 'school', color: '#DB2777', numberLabel: 'Roll / Reference No.', numberPlaceholder: 'Enter reference' },
];

const CATEGORY_LABELS: Record<P2NService['category'], string> = {
  recharge: 'Recharges', utility: 'Utility Bills', finance: 'Finance & Cards', other: 'Other Services',
};

const MODE_META = {
  'bbps': { title: 'BBPS Services', subtitle: 'Recharges, bills & more' },
  'credit-card': { title: 'Credit Card', subtitle: 'Pay any credit card bill' },
  'recharge': { title: 'Recharge', subtitle: 'Mobile / DTH / FASTag' },
};

export const Pay2NewScreen: React.FC = () => {
  const nav = useNavigation();
  const qc = useQueryClient();
  const route = useRoute<RouteProp<AppStackParamList, 'Pay2New'>>();
  const mode = route.params?.mode ?? 'bbps';
  const meta = MODE_META[mode];

  const catalog = useMemo(() => {
    if (mode === 'recharge') return SERVICES.filter((s) => s.category === 'recharge');
    if (mode === 'credit-card') return SERVICES.filter((s) => s.id === 'credit-card');
    return SERVICES;
  }, [mode]);

  const [service, setService] = useState<P2NService | null>(mode === 'credit-card' ? catalog[0] : null);
  const [biller, setBiller] = useState<Pay2NewBiller | null>(null);
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState('');
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [billRef, setBillRef] = useState<string | null>(null);
  const [billInfo, setBillInfo] = useState<{ name?: string; due?: number } | null>(null);
  const [bbpsFallback, setBbpsFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tpinOpen, setTpinOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;
  const isCC = service?.needsMobile === true;

  const billersQ = useQuery({
    queryKey: ['p2n-billers', service?.serviceId],
    queryFn: () => fetchPay2NewBillers(service!.serviceId),
    enabled: !!service,
  });
  const billers = billersQ.data?.billers ?? [];
  const filteredBillers = useMemo(() => {
    if (!search.trim()) return billers;
    const q = search.toLowerCase();
    return billers.filter((b) => (b.product_name || '').toLowerCase().includes(q));
  }, [billers, search]);

  const chargesQ = useQuery({
    queryKey: ['p2n-charges', Math.round(amt)],
    queryFn: () => fetchPay2NewCharges(amt),
    enabled: service?.mode === 'bill' && amt >= 1,
    staleTime: 60_000,
  });

  /** CC sends last-4 as `number` and registered mobile as the identity. */
  const identity = () =>
    isCC
      ? { number: number.trim(), optional1: mobile.trim(), customer_number: mobile.trim() }
      : { number: number.trim(), optional1: '', customer_number: number.trim() };

  const resetToServices = () => {
    setService(mode === 'credit-card' ? catalog[0] : null);
    setBiller(null); setSearch(''); setNumber(''); setMobile('');
    setAmount(''); setBillRef(null); setBillInfo(null); setBbpsFallback(null);
  };

  const onBack = () => {
    if (biller) { setBiller(null); setNumber(''); setMobile(''); setAmount(''); setBillRef(null); setBillInfo(null); setBbpsFallback(null); return; }
    if (service && mode !== 'credit-card') { resetToServices(); return; }
    nav.goBack();
  };

  const validInputs = () => {
    if (!number.trim()) return 'Enter the ' + (service?.numberLabel.toLowerCase() || 'number');
    if (service?.numberMaxLength && number.trim().length !== service.numberMaxLength)
      return `${service.numberLabel} must be exactly ${service.numberMaxLength} digits`;
    if (isCC && mobile.trim().length !== 10) return 'Enter the 10-digit registered mobile number';
    return null;
  };

  const onFetchBill = async () => {
    const err = validInputs();
    if (err) return Alert.alert('Check details', err);
    setBusy(true);
    setBillRef(null); setBillInfo(null); setBbpsFallback(null);
    try {
      const res = await fetchPay2NewBill({
        ...identity(),
        product_code: biller!.product_code,
        product_name: biller!.product_name,
      });
      if (!res.success) throw new Error(res.error || 'Could not fetch bill');
      setBillRef(res.order_id || res.request_id);
      setBbpsFallback(res.fallback === 'bbps' && res.biller_id ? res.biller_id : null);
      const d = res.data || {};
      const due = Number(d.amount ?? d.due_amount ?? d.bill_amount ?? 0);
      setBillInfo({ name: d.customer_name || d.customerName, due: due > 0 ? due : undefined });
      if (due > 0) setAmount(String(due));
    } catch (e: any) {
      Alert.alert('Fetch failed', e instanceof ApiError ? e.message : e?.message || 'Could not fetch bill.');
    } finally {
      setBusy(false);
    }
  };

  const doPay = async (tpin: string) => {
    setSubmitting(true);
    try {
      const res = await payPay2NewBill({
        ...identity(),
        amount: amt,
        product_code: biller!.product_code,
        product_name: biller!.product_name,
        bill_fetch_ref: billRef || '',
        customer_name: billInfo?.name || '',
        tpin,
        ...(bbpsFallback ? { use_bbps: true, biller_id: bbpsFallback } : {}),
      });
      setTpinOpen(false);
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(
        res.success ? 'Payment successful' : 'Payment status',
        `Order: ${res.order_id}\nRef: ${res.operator_reference || '—'}`,
        [{ text: 'Done', onPress: () => nav.goBack() }]
      );
    } catch (e) {
      setTpinOpen(false);
      Alert.alert('Payment failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const doRecharge = async () => {
    const err = validInputs();
    if (err) return Alert.alert('Check details', err);
    if (amt < 1) return Alert.alert('Check details', 'Enter a valid amount.');
    setSubmitting(true);
    try {
      const res = await pay2NewRecharge({ number: number.trim(), amount: amt, product_code: biller!.product_code });
      qc.invalidateQueries({ queryKey: ['wallet'] });
      Alert.alert(
        res.success ? 'Recharge successful' : 'Recharge status',
        `Order: ${res.order_id}\nRef: ${res.operator_reference || '—'}`,
        [{ text: 'Done', onPress: () => nav.goBack() }]
      );
    } catch (e) {
      Alert.alert('Recharge failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const charges = chargesQ.data?.charges;

  // ── Step 1: service grid ──
  if (!service) {
    const cats = Array.from(new Set(catalog.map((s) => s.category)));
    return (
      <Screen title={meta.title} subtitle={meta.subtitle} onBack={() => nav.goBack()}>
        {cats.map((cat) => (
          <View key={cat} style={{ marginTop: spacing.md }}>
            <Text style={styles.groupTitle}>{CATEGORY_LABELS[cat]}</Text>
            <View style={styles.grid}>
              {catalog.filter((s) => s.category === cat).map((s) => (
                <TouchableOpacity key={s.id} style={styles.tile} activeOpacity={0.75} onPress={() => setService(s)}>
                  <IconTile icon={s.icon as any} color={s.color} size={46} />
                  <Text style={styles.tileLabel} numberOfLines={1}>{s.label}</Text>
                  <Text style={styles.tileDesc} numberOfLines={2}>{s.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </Screen>
    );
  }

  // ── Step 2: biller list ──
  if (!biller) {
    return (
      <Screen title={service.label} subtitle={service.desc} onBack={onBack}>
        <Input
          icon="search-outline"
          placeholder={`Search ${service.mode === 'recharge' ? 'operators' : 'billers'}…`}
          value={search}
          onChangeText={setSearch}
          containerStyle={{ marginTop: spacing.sm }}
        />
        {billersQ.isLoading ? (
          <Loading />
        ) : billersQ.isError ? (
          <ErrorState message={(billersQ.error as Error)?.message} onRetry={billersQ.refetch} />
        ) : filteredBillers.length === 0 ? (
          <Card><EmptyState title="Nothing found" message={search ? 'Try a different search.' : 'No options available right now.'} /></Card>
        ) : (
          <Card padded={false}>
            {filteredBillers.map((b, i) => (
              <TouchableOpacity
                key={`${b.product_code}-${i}`}
                style={[styles.row, i < filteredBillers.length - 1 && styles.rowBorder]}
                onPress={() => setBiller(b)}
              >
                <View style={styles.rowDot}><Ionicons name={service.icon as any} size={16} color={service.color} /></View>
                <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]} numberOfLines={2}>{b.product_name}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </Card>
        )}
      </Screen>
    );
  }

  // ── Step 3: details + pay ──
  return (
    <Screen title={service.label} subtitle={biller.product_name} onBack={onBack}>
      <Card style={{ marginTop: spacing.sm }}>
        <View style={styles.selBiller}>
          <IconTile icon={service.icon as any} color={service.color} size={40} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[typography.bodyMedium, { color: colors.textPrimary }]} numberOfLines={2}>{biller.product_name}</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>{service.label}</Text>
          </View>
          <TouchableOpacity onPress={onBack}><Text style={[typography.captionMedium, { color: colors.primary[600] }]}>Change</Text></TouchableOpacity>
        </View>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Input
          label={service.numberLabel}
          icon="keypad-outline"
          value={number}
          onChangeText={(t) => setNumber(service.digitsOnly ? t.replace(/[^\d]/g, '') : t)}
          keyboardType={service.digitsOnly ? 'number-pad' : 'default'}
          maxLength={service.numberMaxLength}
          placeholder={service.numberPlaceholder}
          autoCapitalize="characters"
        />
        {isCC && (
          <Input
            label="Registered Mobile Number"
            icon="call-outline"
            value={mobile}
            onChangeText={(t) => setMobile(t.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            maxLength={10}
            placeholder="10-digit mobile"
          />
        )}

        {service.mode === 'bill' && (
          <Button title="Fetch Bill" variant="outline" icon="search-outline" loading={busy} onPress={onFetchBill} style={{ marginBottom: spacing.md }} />
        )}

        {billInfo && (
          <View style={styles.billBox}>
            {billInfo.name ? <Text style={[typography.captionMedium, { color: colors.textPrimary }]}>{billInfo.name}</Text> : null}
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {billInfo.due ? `Due amount ${formatCurrency(billInfo.due)}` : 'Bill fetched — enter the amount to pay'}
            </Text>
          </View>
        )}

        <Input
          label="Amount (₹)"
          icon="cash-outline"
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />

        {service.mode === 'bill' && amt >= 1 && charges ? (
          <View style={styles.chargeRow}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={[typography.caption, { color: colors.textSecondary, marginLeft: 4 }]}>
              Charge {formatCurrency(charges.total_charge)} · Total {formatCurrency(amt + charges.total_charge)}
            </Text>
          </View>
        ) : null}
      </Card>

      {amt >= 1 && (
        service.mode === 'recharge' ? (
          <Button title={`Recharge ${formatCurrency(amt)}`} size="lg" fullWidth loading={submitting} style={{ marginTop: spacing.lg }} onPress={doRecharge} />
        ) : (
          <Button
            title={`Pay ${formatCurrency(amt)}`}
            size="lg"
            fullWidth
            disabled={!billRef}
            style={{ marginTop: spacing.lg }}
            onPress={() => setTpinOpen(true)}
          />
        )
      )}
      {service.mode === 'bill' && amt >= 1 && !billRef && (
        <Text style={[typography.small, { color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm }]}>
          Fetch the bill first to continue.
        </Text>
      )}

      <TpinSheet visible={tpinOpen} amount={amt} submitting={submitting} onCancel={() => setTpinOpen(false)} onConfirm={doPay} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  groupTitle: { ...typography.overline, color: colors.textMuted, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  tile: {
    width: '30.5%', backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing.base, paddingHorizontal: 6, alignItems: 'center', ...shadow.sm,
  },
  tileLabel: { ...typography.captionMedium, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' },
  tileDesc: { ...typography.small, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.base, paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowDot: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: colors.gray[50],
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  selBiller: { flexDirection: 'row', alignItems: 'center' },
  billBox: { backgroundColor: colors.secondary[50], borderRadius: radius.base, padding: spacing.base, marginBottom: spacing.md },
  chargeRow: { flexDirection: 'row', alignItems: 'center', marginTop: -6, marginBottom: 4 },
});
