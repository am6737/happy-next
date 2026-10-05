// Must precede everything that can reach @xterm/headless, which throws while
// its module body runs if the host has no navigator.userAgent (see the module).
import './sources/terminal/xtermPlatformShim';
import './sources/unistyles';
import 'expo-router/entry';
