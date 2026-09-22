import { TextStyle } from 'react-native';

export const typography = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 } as TextStyle,
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 } as TextStyle,
  h2: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 } as TextStyle,
  h3: { fontSize: 17, fontWeight: '700' } as TextStyle,
  bodyLg: { fontSize: 16, fontWeight: '500' } as TextStyle,
  body: { fontSize: 14, fontWeight: '400' } as TextStyle,
  bodyMedium: { fontSize: 14, fontWeight: '600' } as TextStyle,
  caption: { fontSize: 12, fontWeight: '400' } as TextStyle,
  captionMedium: { fontSize: 12, fontWeight: '600' } as TextStyle,
  small: { fontSize: 11, fontWeight: '400' } as TextStyle,
  overline: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' } as TextStyle,
};
