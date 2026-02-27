import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { borderRadius, shadow } from '../theme';

interface GradientCardProps {
  children: React.ReactNode;
  colors: string[];
  style?: ViewStyle;
  padding?: number;
}

export const GradientCard: React.FC<GradientCardProps> = ({
  children,
  colors: gradientColors,
  style,
  padding = 20,
}) => {
  return (
    <LinearGradient
      colors={gradientColors as [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.base, { padding }, style]}
    >
      {children}
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: borderRadius.lg,
    ...shadow.lg,
  },
});
