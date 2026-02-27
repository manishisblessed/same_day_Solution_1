import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GradientCard } from './GradientCard';
import { colors, typography } from '../theme';
import { formatCurrency } from '../utils';

interface WalletCardProps {
  title: string;
  balance: number;
  gradientColors: string[];
  icon: keyof typeof Ionicons.glyphMap;
  subtitle?: string;
}

export const WalletCard: React.FC<WalletCardProps> = ({
  title,
  balance,
  gradientColors,
  icon,
  subtitle,
}) => {
  return (
    <GradientCard colors={gradientColors} padding={24}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name={icon} size={22} color="rgba(255,255,255,0.9)" />
        </View>
        <Ionicons name="ellipsis-horizontal" size={20} color="rgba(255,255,255,0.6)" />
      </View>

      <Text style={styles.label}>{title}</Text>
      <Text style={styles.balance}>{formatCurrency(balance)}</Text>

      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <View style={styles.decorCircle1} />
      <View style={styles.decorCircle2} />
    </GradientCard>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.captionMedium,
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  balance: {
    ...typography.largeValue,
    color: colors.white,
  },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 8,
  },
  decorCircle1: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.08)',
    top: -30,
    right: -20,
  },
  decorCircle2: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.06)',
    bottom: -20,
    right: 40,
  },
});
