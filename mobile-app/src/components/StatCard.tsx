import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, typography, borderRadius, shadow } from '../theme';

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: { value: string; positive: boolean };
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  icon,
  iconBg,
  trend,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
          {icon}
        </View>
        {trend && (
          <View
            style={[
              styles.trendBadge,
              {
                backgroundColor: trend.positive
                  ? colors.success[50]
                  : '#FEE2E2',
              },
            ]}
          >
            <Text
              style={[
                styles.trendText,
                {
                  color: trend.positive
                    ? colors.success[600]
                    : colors.error,
                },
              ]}
            >
              {trend.positive ? '+' : ''}{trend.value}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    padding: 14,
    ...shadow.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  trendText: {
    ...typography.small,
    fontWeight: '600',
  },
  value: {
    ...typography.h3,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  title: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
