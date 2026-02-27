import { TextStyle, Platform } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const typography = {
  h1: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.5,
  } as TextStyle,

  h2: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    letterSpacing: -0.3,
  } as TextStyle,

  h3: {
    fontFamily,
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 26,
  } as TextStyle,

  h4: {
    fontFamily,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  } as TextStyle,

  body: {
    fontFamily,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
  } as TextStyle,

  bodyMedium: {
    fontFamily,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  } as TextStyle,

  bodySemibold: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  } as TextStyle,

  caption: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
  } as TextStyle,

  captionMedium: {
    fontFamily,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  } as TextStyle,

  small: {
    fontFamily,
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 16,
  } as TextStyle,

  smallMedium: {
    fontFamily,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  } as TextStyle,

  button: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: 0.3,
  } as TextStyle,

  largeValue: {
    fontFamily,
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.5,
  } as TextStyle,
} as const;
