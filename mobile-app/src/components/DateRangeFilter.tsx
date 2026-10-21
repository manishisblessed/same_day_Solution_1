/**
 * DateRangeFilter — compact filter bar with quick presets + custom date inputs.
 * Pure JS, no native date-picker library needed.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography, shadow } from '@/theme';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

interface Preset { label: string; range: () => DateRange }

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function today(): Date { return new Date(); }
function daysAgo(n: number): Date {
  const d = new Date(); d.setDate(d.getDate() - n); return d;
}
function startOfMonth(offset = 0): Date {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return d;
}
function endOfMonth(offset = 0): Date {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset + 1); d.setDate(0); return d;
}

const PRESETS: Preset[] = [
  { label: 'Today',      range: () => ({ from: fmt(today()), to: fmt(today()) }) },
  { label: 'Yesterday',  range: () => ({ from: fmt(daysAgo(1)), to: fmt(daysAgo(1)) }) },
  { label: 'Last 7 days',range: () => ({ from: fmt(daysAgo(6)), to: fmt(today()) }) },
  { label: 'Last 30 days',range:() => ({ from: fmt(daysAgo(29)), to: fmt(today()) }) },
  { label: 'This month', range: () => ({ from: fmt(startOfMonth()), to: fmt(today()) }) },
  { label: 'Last month', range: () => ({ from: fmt(startOfMonth(1)), to: fmt(endOfMonth(1)) }) },
];

// Convert display "DD/MM/YYYY" ↔ storage "YYYY-MM-DD"
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

// ── Chip ──────────────────────────────────────────────────────────────────────
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[st.chip, active && st.chipActive]}>
      <Text style={[st.chipText, active && st.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Filter Modal ──────────────────────────────────────────────────────────────
interface FilterModalProps {
  visible: boolean;
  range: DateRange | null;
  onApply: (range: DateRange | null) => void;
  onClose: () => void;
}

function FilterModal({ visible, range, onApply, onClose }: FilterModalProps) {
  const insets = useSafeAreaInsets();
  const [fromStr, setFromStr] = useState(toDisplay(range?.from ?? ''));
  const [toStr, setToStr]   = useState(toDisplay(range?.to ?? ''));
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const applyPreset = (p: Preset) => {
    const r = p.range();
    setFromStr(toDisplay(r.from));
    setToStr(toDisplay(r.to));
    setActivePreset(p.label);
  };

  const apply = () => {
    if (!fromStr && !toStr) { onApply(null); onClose(); return; }
    if (!isValidDisplay(fromStr)) return;
    if (!isValidDisplay(toStr)) return;
    onApply({ from: toISO(fromStr), to: toISO(toStr) });
    onClose();
  };

  const clear = () => {
    setFromStr(''); setToStr(''); setActivePreset(null);
    onApply(null); onClose();
  };

  const formatInput = (text: string, prev: string): string => {
    // Auto-insert slashes: DD/MM/YYYY
    const digits = text.replace(/\D/g, '').slice(0, 8);
    let out = '';
    for (let i = 0; i < digits.length; i++) {
      if (i === 2 || i === 4) out += '/';
      out += digits[i];
    }
    return out;
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={[st.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Handle */}
          <View style={st.handle} />
          <Text style={[typography.h3, { color: colors.textPrimary, marginBottom: spacing.md }]}>Filter by Date</Text>

          {/* Presets */}
          <View style={st.presetRow}>
            {PRESETS.map((p) => (
              <Chip key={p.label} label={p.label} active={activePreset === p.label} onPress={() => applyPreset(p)} />
            ))}
          </View>

          {/* Custom inputs */}
          <Text style={[typography.captionMedium, { color: colors.textSecondary, marginTop: spacing.md, marginBottom: 6 }]}>
            Custom range (DD/MM/YYYY)
          </Text>
          <View style={st.inputRow}>
            <View style={st.inputWrap}>
              <Text style={st.inputLabel}>From</Text>
              <TextInput
                style={st.dateInput}
                value={fromStr}
                onChangeText={(t) => { setFromStr(formatInput(t, fromStr)); setActivePreset(null); }}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.textSecondary} style={{ marginTop: 18 }} />
            <View style={st.inputWrap}>
              <Text style={st.inputLabel}>To</Text>
              <TextInput
                style={st.dateInput}
                value={toStr}
                onChangeText={(t) => { setToStr(formatInput(t, toStr)); setActivePreset(null); }}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
          </View>

          {/* Buttons */}
          <View style={st.btnRow}>
            <TouchableOpacity style={st.clearBtn} onPress={clear}>
              <Text style={[typography.bodyMedium, { color: colors.textSecondary }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.applyBtn} onPress={apply}>
              <Text style={[typography.bodyMedium, { color: colors.white }]}>Apply Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
interface Props {
  range: DateRange | null;
  onChange: (range: DateRange | null) => void;
}

export function DateRangeFilter({ range, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = !!range;

  const label = active
    ? `${toDisplay(range!.from)} – ${toDisplay(range!.to)}`
    : 'All dates';

  return (
    <>
      <TouchableOpacity
        style={[st.trigger, active && st.triggerActive]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
      >
        <Ionicons
          name="calendar-outline"
          size={14}
          color={active ? colors.primary[600] : colors.textSecondary}
        />
        <Text style={[st.triggerText, active && st.triggerTextActive]}>{label}</Text>
        {active && (
          <TouchableOpacity hitSlop={8} onPress={() => onChange(null)}>
            <Ionicons name="close-circle" size={16} color={colors.primary[500]} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <FilterModal
        visible={open}
        range={range}
        onApply={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const st = StyleSheet.create({
  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
  },
  triggerActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[300] },
  triggerText: { ...typography.caption, color: colors.textSecondary },
  triggerTextActive: { color: colors.primary[700] },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: spacing.base, paddingTop: 10,
  },
  handle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[400] },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.primary[700], fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  inputWrap: { flex: 1 },
  inputLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: 4 },
  dateInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    ...typography.body, color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: spacing.lg },
  clearBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  applyBtn: {
    flex: 2, alignItems: 'center', paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: colors.primary[600],
  },
});
