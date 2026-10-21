/**
 * ExportReportSheet — bottom-sheet modal with date filters + format picker for report downloads.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { colors, radius, spacing, typography } from '@/theme';
import { DateRange } from './DateRangeFilter';

// PDF requires native modules (expo-print + expo-sharing) compiled into the app.
// Dev clients and Expo Go do NOT have these — only production / standalone builds do.
const PDF_AVAILABLE = Constants.executionEnvironment === 'storeClient' ||
  Constants.executionEnvironment === 'standalone';

// ── Date helpers ──────────────────────────────────────────────────────────────
function fmt(d: Date): string { return d.toISOString().slice(0, 10); }
function today(): Date { return new Date(); }
function daysAgo(n: number): Date { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function startOfMonth(offset = 0): Date { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return d; }
function endOfMonth(offset = 0): Date { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset + 1); d.setDate(0); return d; }

function toISO(display: string): string {
  const [d, m, y] = display.split('/');
  if (y?.length === 4 && m?.length === 2 && d?.length === 2) return `${y}-${m}-${d}`;
  return '';
}
function toDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function isValidDisplay(s: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s) && !!toISO(s);
}
function formatInput(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i === 2 || i === 4) out += '/';
    out += digits[i];
  }
  return out;
}

interface Preset { label: string; range: () => DateRange }
const PRESETS: Preset[] = [
  { label: 'Today',       range: () => ({ from: fmt(today()), to: fmt(today()) }) },
  { label: 'Yesterday',   range: () => ({ from: fmt(daysAgo(1)), to: fmt(daysAgo(1)) }) },
  { label: 'Last 7 days', range: () => ({ from: fmt(daysAgo(6)), to: fmt(today()) }) },
  { label: 'Last 30 days',range: () => ({ from: fmt(daysAgo(29)), to: fmt(today()) }) },
  { label: 'This month',  range: () => ({ from: fmt(startOfMonth()), to: fmt(today()) }) },
  { label: 'Last month',  range: () => ({ from: fmt(startOfMonth(1)), to: fmt(endOfMonth(1)) }) },
];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ExportReportSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Current record count (for the currently loaded data) */
  recordCount: number;
  /** Pre-filled date range (from screen filter) */
  currentDateRange: DateRange | null;
  /** Called when user taps Export. Parent handles fetching + exporting. */
  onExport: (dateRange: DateRange | null, format: 'csv' | 'pdf') => void;
  /** If true, show a loading spinner (parent is fetching/exporting) */
  loading?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ExportReportSheet({
  visible, onClose, title, recordCount, currentDateRange, onExport, loading,
}: ExportReportSheetProps) {
  const insets = useSafeAreaInsets();
  const [fromStr, setFromStr] = useState('');
  const [toStr, setToStr]     = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const pdfAvailable = PDF_AVAILABLE;

  // Sync when modal opens
  useEffect(() => {
    if (visible) {
      setFromStr(toDisplay(currentDateRange?.from ?? ''));
      setToStr(toDisplay(currentDateRange?.to ?? ''));
      setActivePreset(null);
      setFormat('csv');
    }
  }, [visible]);

  const applyPreset = (p: Preset) => {
    const r = p.range();
    setFromStr(toDisplay(r.from));
    setToStr(toDisplay(r.to));
    setActivePreset(p.label);
  };

  const clearDates = () => {
    setFromStr(''); setToStr(''); setActivePreset(null);
  };

  const getDateRange = (): DateRange | null => {
    if (!fromStr && !toStr) return null;
    if (!isValidDisplay(fromStr) || !isValidDisplay(toStr)) return null;
    return { from: toISO(fromStr), to: toISO(toStr) };
  };

  const datesValid = (!fromStr && !toStr) || (isValidDisplay(fromStr) && isValidDisplay(toStr));

  const handleExport = () => {
    if (!datesValid || loading) return;
    onExport(getDateRange(), format);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Handle */}
          <View style={st.handle} />

          {/* Header */}
          <View style={st.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.h3, { color: colors.textPrimary }]}>Download Report</Text>
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                {title} · {recordCount} record{recordCount !== 1 ? 's' : ''} loaded
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Date Range Section ── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Ionicons name="calendar-outline" size={16} color={colors.primary[600]} />
              <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: 6 }]}>
                Date Range
              </Text>
              {(fromStr || toStr) ? (
                <TouchableOpacity onPress={clearDates} style={{ marginLeft: 'auto' }}>
                  <Text style={[typography.caption, { color: colors.primary[600] }]}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Presets */}
            <View style={st.presetRow}>
              {PRESETS.map((p) => (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => applyPreset(p)}
                  style={[st.chip, activePreset === p.label && st.chipActive]}
                >
                  <Text style={[st.chipText, activePreset === p.label && st.chipTextActive]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom inputs */}
            <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 }]}>
              Or enter custom range
            </Text>
            <View style={st.inputRow}>
              <View style={st.inputWrap}>
                <Text style={st.inputLabel}>From</Text>
                <TextInput
                  style={[st.dateInput, fromStr && !isValidDisplay(fromStr) && st.dateInputError]}
                  value={fromStr}
                  onChangeText={(t) => { setFromStr(formatInput(t)); setActivePreset(null); }}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
              <Ionicons name="arrow-forward" size={14} color={colors.textSecondary} style={{ marginTop: 20 }} />
              <View style={st.inputWrap}>
                <Text style={st.inputLabel}>To</Text>
                <TextInput
                  style={[st.dateInput, toStr && !isValidDisplay(toStr) && st.dateInputError]}
                  value={toStr}
                  onChangeText={(t) => { setToStr(formatInput(t)); setActivePreset(null); }}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
            {!datesValid && (
              <Text style={st.errorHint}>Enter both dates in DD/MM/YYYY format</Text>
            )}
          </View>

          {/* ── Format Section ── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Ionicons name="document-outline" size={16} color={colors.primary[600]} />
              <Text style={[typography.bodyMedium, { color: colors.textPrimary, marginLeft: 6 }]}>
                Export Format
              </Text>
            </View>
            <View style={st.formatRow}>
              <TouchableOpacity
                style={[st.formatBtn, format === 'csv' && st.formatBtnActive]}
                onPress={() => setFormat('csv')}
              >
                <Ionicons
                  name="document-text-outline"
                  size={20}
                  color={format === 'csv' ? colors.primary[600] : colors.textSecondary}
                />
                <Text style={[st.formatLabel, format === 'csv' && st.formatLabelActive]}>CSV</Text>
                <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                  Spreadsheet
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.formatBtn, format === 'pdf' && st.formatBtnActive, !pdfAvailable && st.formatBtnDisabledOpt]}
                onPress={() => pdfAvailable ? setFormat('pdf') : undefined}
                activeOpacity={pdfAvailable ? 0.7 : 1}
              >
                <Ionicons
                  name="reader-outline"
                  size={20}
                  color={!pdfAvailable ? colors.textMuted : format === 'pdf' ? colors.primary[600] : colors.textSecondary}
                />
                <Text style={[st.formatLabel, format === 'pdf' && st.formatLabelActive, !pdfAvailable && { color: colors.textMuted }]}>PDF</Text>
                <Text style={[typography.caption, { color: !pdfAvailable ? colors.textMuted : colors.textSecondary, textAlign: 'center' }]}>
                  {pdfAvailable ? 'Printable' : 'Native build only'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Export Button ── */}
          <TouchableOpacity
            style={[st.exportBtn, (!datesValid || loading) && st.exportBtnDisabled]}
            onPress={handleExport}
            disabled={!datesValid || loading}
            activeOpacity={0.7}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color={colors.white} style={{ marginRight: 8 }} />
                <Text style={[typography.bodyMedium, { color: colors.white }]}>
                  Export as {format.toUpperCase()}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: spacing.base, paddingTop: 10,
  },
  handle: {
    width: 40, height: 4, backgroundColor: colors.border,
    borderRadius: 2, alignSelf: 'center', marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: spacing.md,
  },

  section: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.base, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.white,
  },
  chipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[400] },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.primary[700], fontWeight: '600' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputWrap: { flex: 1 },
  inputLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  dateInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 9,
    ...typography.body, color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  dateInputError: { borderColor: '#EF4444' },
  errorHint: { ...typography.caption, color: '#EF4444', marginTop: 4 },

  formatRow: { flexDirection: 'row', gap: 12 },
  formatBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.white,
  },
  formatBtnActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  formatBtnDisabledOpt: { opacity: 0.45, backgroundColor: colors.surface },
  formatLabel: {
    ...typography.bodyMedium, color: colors.textSecondary,
    marginTop: 4, marginBottom: 2,
  },
  formatLabelActive: { color: colors.primary[700] },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary[600], borderRadius: radius.md,
    paddingVertical: 14, marginTop: 4,
  },
  exportBtnDisabled: { opacity: 0.5 },
});
