import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView,
  TouchableOpacity, ActivityIndicator, Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';
import { Screen, Card, Loading, EmptyState, ErrorState, Badge } from '@/components';
import { fetchSchemeMappings, fetchSchemeById } from '@/api/schemes';

// ── Config section renderers ─────────────────────────────────────────────────

function RateRow({ label, value }: { label: string; value: any }) {
  if (value == null || value === '') return null;
  return (
    <View style={st.rateRow}>
      <Text style={st.rateLabel}>{label}</Text>
      <Text style={st.rateValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={st.sectionHeader}>
      <Ionicons name={icon as any} size={15} color={colors.primary[600]} />
      <Text style={st.sectionTitle}>{title}</Text>
    </View>
  );
}

function MdrRates({ rates }: { rates: any[] }) {
  if (!rates?.length) return null;
  return (
    <View style={st.section}>
      <SectionHeader title="MDR Rates (POS / Card)" icon="card-outline" />
      {rates.map((r: any, i: number) => (
        <View key={i} style={st.configCard}>
          <RateRow label="Card Type" value={r.card_type} />
          <RateRow label="Mode" value={r.payment_mode} />
          <RateRow label="Min Amount" value={r.min_amount != null ? `₹${r.min_amount}` : null} />
          <RateRow label="Max Amount" value={r.max_amount != null ? `₹${r.max_amount}` : null} />
          <RateRow label="Retailer Rate" value={r.retailer_charge != null ? `${r.retailer_charge}%` : null} />
          <RateRow label="MDR Rate" value={r.mdr_rate != null ? `${r.mdr_rate}%` : null} />
        </View>
      ))}
    </View>
  );
}

function PayoutCharges({ charges }: { charges: any[] }) {
  if (!charges?.length) return null;
  return (
    <View style={st.section}>
      <SectionHeader title="Payout / Settlement Charges" icon="cash-outline" />
      {charges.map((c: any, i: number) => (
        <View key={i} style={st.configCard}>
          <RateRow label="Transfer Mode" value={c.transfer_mode} />
          <RateRow label="Min Amount" value={c.min_amount != null ? `₹${c.min_amount}` : null} />
          <RateRow label="Max Amount" value={c.max_amount != null ? `₹${c.max_amount}` : null} />
          <RateRow label="Retailer Charge" value={c.retailer_charge != null ? `${c.retailer_charge}%` : null} />
          <RateRow label="Base Charge" value={c.base_charge != null ? `₹${c.base_charge}` : null} />
        </View>
      ))}
    </View>
  );
}

function BbpsCommissions({ commissions }: { commissions: any[] }) {
  if (!commissions?.length) return null;
  return (
    <View style={st.section}>
      <SectionHeader title="BBPS / Bill Payment Commission" icon="receipt-outline" />
      {commissions.map((c: any, i: number) => (
        <View key={i} style={st.configCard}>
          <RateRow label="Category" value={c.category || 'All'} />
          <RateRow label="Retailer Commission" value={c.retailer_commission != null ? `${c.retailer_commission}%` : null} />
          <RateRow label="Flat Commission" value={c.flat_commission != null ? `₹${c.flat_commission}` : null} />
        </View>
      ))}
    </View>
  );
}

function AepsCommissions({ commissions }: { commissions: any[] }) {
  if (!commissions?.length) return null;
  return (
    <View style={st.section}>
      <SectionHeader title="AEPS Commission" icon="finger-print-outline" />
      {commissions.map((c: any, i: number) => (
        <View key={i} style={st.configCard}>
          <RateRow label="Transaction Type" value={c.transaction_type} />
          <RateRow label="Retailer Commission" value={c.retailer_commission != null ? `${c.retailer_commission}%` : null} />
          <RateRow label="Flat Commission" value={c.flat_commission != null ? `₹${c.flat_commission}` : null} />
        </View>
      ))}
    </View>
  );
}

function SettlementCharges({ charges, title, icon }: { charges: any[]; title: string; icon: string }) {
  if (!charges?.length) return null;
  return (
    <View style={st.section}>
      <SectionHeader title={title} icon={icon as any} />
      {charges.map((c: any, i: number) => (
        <View key={i} style={st.configCard}>
          <RateRow label="Mode" value={c.mode} />
          <RateRow label="Min Amount" value={c.min_amount != null ? `₹${c.min_amount}` : null} />
          <RateRow label="Max Amount" value={c.max_amount != null ? `₹${c.max_amount}` : null} />
          <RateRow label="Retailer Charge" value={c.retailer_charge != null ? `${c.retailer_charge}%` : null} />
          <RateRow label="Base Charge" value={c.base_charge != null ? `₹${c.base_charge}` : null} />
        </View>
      ))}
    </View>
  );
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

function SchemeDetailModal({
  schemeId,
  schemeName,
  visible,
  onClose,
}: {
  schemeId: string;
  schemeName: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const q = useQuery({
    queryKey: ['scheme-detail', schemeId],
    queryFn: () => fetchSchemeById(schemeId),
    enabled: visible && !!schemeId,
    staleTime: 60_000,
  });
  const d = q.data?.data;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.modalWrap, { paddingTop: insets.top || 16 }]}>
        {/* Header */}
        <View style={st.modalHeader}>
          <TouchableOpacity onPress={onClose} style={st.closeBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[typography.h3, { color: colors.textPrimary }]} numberOfLines={1}>{schemeName}</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>Rate Plan Details</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.base, paddingBottom: insets.bottom + spacing.xl }}>
          {q.isLoading ? (
            <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 40 }} />
          ) : q.isError ? (
            <Text style={[typography.body, { color: colors.danger[600], textAlign: 'center', marginTop: 40 }]}>
              Could not load scheme details.
            </Text>
          ) : d ? (
            <>
              {/* Summary */}
              <Card style={{ marginBottom: spacing.base }}>
                <RateRow label="Scheme Name" value={d.name} />
                <RateRow label="Type" value={d.scheme_type} />
                <RateRow label="Scope" value={d.service_scope} />
                <RateRow label="Status" value={d.status} />
                {d.effective_from && <RateRow label="Effective From" value={new Date(d.effective_from).toLocaleDateString('en-IN')} />}
                {d.effective_to && <RateRow label="Effective To" value={new Date(d.effective_to).toLocaleDateString('en-IN')} />}
              </Card>

              <MdrRates rates={d.mdr_rates ?? []} />
              <PayoutCharges charges={d.payout_charges ?? []} />
              <BbpsCommissions commissions={d.bbps_commissions ?? []} />
              <AepsCommissions commissions={d.aeps_commissions ?? []} />
              <SettlementCharges
                charges={d.aeps_settlement_charges ?? []}
                title="AEPS Settlement Charges"
                icon="arrow-down-circle-outline"
              />
              <SettlementCharges
                charges={d.shadval_settlement_charges ?? []}
                title="Settlement-2 Charges"
                icon="send-outline"
              />

              {!d.mdr_rates?.length && !d.payout_charges?.length &&
               !d.bbps_commissions?.length && !d.aeps_commissions?.length &&
               !d.aeps_settlement_charges?.length && !d.shadval_settlement_charges?.length && (
                <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: 24 }]}>
                  No rate configurations found for this scheme.
                </Text>
              )}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export const MdrSchemesScreen: React.FC = () => {
  const nav = useNavigation();
  const q = useQuery({ queryKey: ['scheme-mappings'], queryFn: () => fetchSchemeMappings() });
  const rows = q.data?.data ?? [];
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  return (
    <Screen title="MDR Schemes" subtitle="Your assigned rate plans" onBack={() => nav.goBack()} refreshing={q.isFetching} onRefresh={q.refetch}>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error)?.message} onRetry={q.refetch} />
      ) : rows.length === 0 ? (
        <Card><EmptyState icon="pricetags-outline" title="No schemes" message="No MDR schemes assigned yet." /></Card>
      ) : (
        rows.map((s: any, i: number) => {
          const name = s.scheme_name || s.schemes?.name || s.scheme_id || 'Scheme';
          return (
            <Pressable
              key={s.id || i}
              onPress={() => setSelected({ id: s.scheme_id, name })}
              style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, marginBottom: spacing.sm }]}
            >
              <Card style={st.schemeCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyMedium, { color: colors.textPrimary }]}>{name}</Text>
                    {s.service_type ? (
                      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 3 }]}>{s.service_type}</Text>
                    ) : null}
                    {(s.mdr_rate != null || s.rate != null) ? (
                      <Text style={[typography.caption, { color: colors.primary[600], marginTop: 2 }]}>Rate: {s.mdr_rate ?? s.rate}%</Text>
                    ) : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {s.status ? <Badge label={s.status} tone={s.status === 'active' ? 'success' : 'neutral'} /> : null}
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })
      )}

      {selected && (
        <SchemeDetailModal
          schemeId={selected.id}
          schemeName={selected.name}
          visible={!!selected}
          onClose={() => setSelected(null)}
        />
      )}
    </Screen>
  );
};

const st = StyleSheet.create({
  schemeCard: { flexDirection: 'row', alignItems: 'center' },
  modalWrap: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.white,
    ...shadow.sm,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  section: { marginBottom: spacing.base },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: spacing.xs,
    paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sectionTitle: { ...typography.bodyMedium, color: colors.textPrimary },
  configCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rateRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rateLabel: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  rateValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '600', textAlign: 'right' },
});
