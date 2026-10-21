import { Platform, type TextStyle } from 'react-native';

/**
 * Typography system for Happy Next app
 *
 * Default typography: the platform's own face — SF and PingFang on iOS, Roboto and Noto Sans CJK on
 * Android, the system stack on the web — so CJK text takes the same weights as Latin.
 * Monospace typography: IBM Plex Mono
 * Logo typography: Bricolage Grotesque (specific use only)
 *
 * Usage Examples:
 *
 * <Text style={{ fontSize: 16, ...Typography.default() }}>Regular text</Text>
 * <Text style={{ fontSize: 16, ...Typography.default('italic') }}>Italic text</Text>
 * <Text style={{ fontSize: 16, ...Typography.default('medium') }}>Medium text</Text>
 * <Text style={{ fontSize: 16, ...Typography.default('semiBold') }}>Semi-bold text</Text>
 *
 * <Text style={{ fontSize: 14, ...Typography.mono() }}>Code text</Text>
 * <Text style={{ fontSize: 28, ...Typography.logo() }}>Logo Text</Text>
 */

// The system face. Native leaves the family unset, which is the system's; the web names its stack,
// Latin faces first and CJK ones after.
const SYSTEM_FONT = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
  default: undefined,
});

// Font family constants
export const FontFamilies = {
  // IBM Plex Mono (default monospace)
  mono: {
    regular: 'IBMPlexMono-Regular',
    italic: 'IBMPlexMono-Italic',
    semiBold: 'IBMPlexMono-SemiBold',
  },
  
  // Bricolage Grotesque (logo/special use only)
  logo: {
    bold: 'BricolageGrotesque-Bold',
  },
  
  // Legacy fonts (keep for backward compatibility)
  legacy: {
    spaceMono: 'SpaceMono',
    systemMono: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  }
};

export const getMonoFont = (weight: 'regular' | 'italic' | 'semiBold' = 'regular') => {
  return FontFamilies.mono[weight];
};

export const getLogoFont = () => {
  return FontFamilies.logo.bold;
};

// Font weight mappings for the font families
export const FontWeights = {
  regular: '400',
  medium: '500',
  semiBold: '600', 
  bold: '700',
} as const;

type DefaultWeight = 'regular' | 'italic' | 'medium' | 'semiBold';

// The system face at a weight. Called bare it leaves the weight alone, so a fontWeight beside it in
// the same style still holds; asked for a weight, it sets it.
function systemFont(weight?: DefaultWeight): Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'fontStyle'> {
  switch (weight) {
    case undefined: return { fontFamily: SYSTEM_FONT };
    case 'italic': return { fontFamily: SYSTEM_FONT, fontWeight: FontWeights.regular, fontStyle: 'italic' };
    default: return { fontFamily: SYSTEM_FONT, fontWeight: FontWeights[weight] };
  }
}

// Style utilities for easy inline usage
export const Typography = {
  // Default font styles (the system face)
  default: (weight?: DefaultWeight) => systemFont(weight),
  
  // Monospace font styles (IBM Plex Mono)
  mono: (weight: 'regular' | 'italic' | 'semiBold' = 'regular') => ({
    fontFamily: getMonoFont(weight),
  }),
  
  // Logo font style (Bricolage Grotesque)
  logo: () => ({
    fontFamily: getLogoFont(),
  }),
  
  // Header text style
  header: () => systemFont('semiBold'),
  
  // Body text style
  body: () => systemFont('regular'),
  
  // Legacy font styles (for backward compatibility)
  legacy: {
    spaceMono: () => ({
      fontFamily: FontFamilies.legacy.spaceMono,
    }),
    systemMono: () => ({
      fontFamily: FontFamilies.legacy.systemMono,
    }),
  }
}; 