import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, ViewStyle } from 'react-native';
import { colors, borderRadius } from '../theme';

interface LoadingPlaceholderProps {
  width?: number | string;
  height?: number;
  borderRadiusSize?: number;
  style?: ViewStyle;
}

export const LoadingPlaceholder: React.FC<LoadingPlaceholderProps> = ({
  width = '100%',
  height = 16,
  borderRadiusSize = borderRadius.sm,
  style,
}) => {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius: borderRadiusSize,
          backgroundColor: colors.gray[200],
          opacity,
        },
        style,
      ]}
    />
  );
};

interface CardPlaceholderProps {
  lines?: number;
}

export const CardPlaceholder: React.FC<CardPlaceholderProps> = ({ lines = 3 }) => {
  return (
    <View style={placeholderStyles.card}>
      <LoadingPlaceholder width="40%" height={14} />
      <View style={placeholderStyles.gap} />
      <LoadingPlaceholder width="70%" height={24} />
      {Array.from({ length: lines }).map((_, i) => (
        <View key={i} style={placeholderStyles.gap}>
          <LoadingPlaceholder width={`${85 - i * 15}%`} height={12} />
        </View>
      ))}
    </View>
  );
};

export const ListPlaceholder: React.FC<{ count?: number }> = ({ count = 5 }) => {
  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={placeholderStyles.listItem}>
          <LoadingPlaceholder
            width={40}
            height={40}
            borderRadiusSize={borderRadius.md}
          />
          <View style={placeholderStyles.listContent}>
            <LoadingPlaceholder width="75%" height={14} />
            <View style={{ height: 6 }} />
            <LoadingPlaceholder width="50%" height={10} />
          </View>
          <LoadingPlaceholder width={60} height={14} />
        </View>
      ))}
    </View>
  );
};

const placeholderStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.base,
    padding: 16,
  },
  gap: {
    marginTop: 10,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  listContent: {
    flex: 1,
  },
});
