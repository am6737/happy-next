// Fix React Native 0.81.4 DevTools initialization order issue
// Prevents "property is not writable" error when Fusebox DevTools dispatcher is set
if (__DEV__ && typeof global !== 'undefined') {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(global, '__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__');
    if (!descriptor?.writable) {
      Object.defineProperty(global, '__FUSEBOX_REACT_DEVTOOLS_DISPATCHER__', {
        value: undefined,
        configurable: true,
        writable: true,
        enumerable: false,
      });
    }
  } catch {
    // Silently ignore if property is already defined and non-configurable
  }
}

import './sources/unistyles';
import 'expo-router/entry';