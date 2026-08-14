import { Platform, Linking } from 'react-native';
import { Modal } from '@/modal';
import { AudioModule } from 'expo-audio';
import { isTauriDesktop } from '@/utils/tauri';

export interface MicrophonePermissionResult {
  granted: boolean;
  canAskAgain?: boolean;
}

/**
 * CRITICAL: Request microphone permissions BEFORE starting any audio session
 * Without this, first voice session WILL fail on iOS/Android
 *
 * Uses expo-audio (SDK 52+) - expo-av is deprecated
 */
export async function requestMicrophonePermission(): Promise<MicrophonePermissionResult> {
  try {
    if (Platform.OS === 'web') {
      // Web: Use navigator.mediaDevices API
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Important: Stop the stream immediately after getting permission
        stream.getTracks().forEach(track => track.stop());
        return { granted: true };
      } catch (error: any) {
        // User denied permission or browser doesn't support getUserMedia
        console.error('Web microphone permission denied:', error);
        return { granted: false, canAskAgain: error.name !== 'NotAllowedError' };
      }
    } else {
      // iOS and Android: Use expo-audio (SDK 52+)
      const result = await AudioModule.requestRecordingPermissionsAsync();

      if (result.granted) {
        // Configure audio mode for recording
        await AudioModule.setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });

        return { granted: true, canAskAgain: result.canAskAgain };
      }

      return { granted: false, canAskAgain: result.canAskAgain };
    }
  } catch (error) {
    console.error('Error requesting microphone permission:', error);
    return { granted: false };
  }
}

/**
 * Put the iOS audio session into playback mode so audio routes to the
 * loudspeaker (not the quiet earpiece).
 *
 * iOS routes playback to the earpiece by default / whenever the session is left
 * in `playAndRecord` (which the voice flow's `allowsRecording: true` sets). Both
 * TTS playback (before any call) and the end of a voice call need to assert this
 * playback category to get loudspeaker output. Native-only; a no-op on web.
 */
export async function setPlaybackAudioMode(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await AudioModule.setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
  } catch (error) {
    console.error('Error setting playback audio mode:', error);
  }
}

/**
 * Check current microphone permission status without prompting
 */
export async function checkMicrophonePermission(): Promise<MicrophonePermissionResult> {
  try {
    if (Platform.OS === 'web') {
      // Web: Check permission status if available
      if ('permissions' in navigator && 'query' in navigator.permissions) {
        try {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          return { granted: result.state === 'granted' };
        } catch {
          // Permission API not supported or microphone permission not queryable
          // We'll have to request to know
          return { granted: false, canAskAgain: true };
        }
      }
      return { granted: false, canAskAgain: true };
    } else {
      // iOS and Android: Use expo-audio (SDK 52+)
      const result = await AudioModule.getRecordingPermissionsAsync();
      return { granted: result.granted, canAskAgain: result.canAskAgain };
    }
  } catch (error) {
    console.error('Error checking microphone permission:', error);
    return { granted: false };
  }
}

/**
 * Show appropriate error message when permission is denied
 */
export function showMicrophonePermissionDeniedAlert(canAskAgain: boolean = false) {
  const title = 'Microphone Access Required';
  const message = canAskAgain
    ? 'Happy needs access to your microphone for voice chat. Please grant permission when prompted.'
    : 'Happy needs access to your microphone for voice chat. Please enable microphone access in your device settings.';

  if (Platform.OS === 'web') {
    if (isTauriDesktop()) {
      const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);
      Modal.alert(
        title,
        isMac
          ? 'Open System Settings → Privacy & Security → Microphone, enable Happy Next, then restart the app.'
          : 'Open Windows Settings → Privacy & security → Microphone, allow desktop apps to use the microphone, then restart Happy Next.',
        [{ text: 'OK' }]
      );
      return;
    }
    // Web: Show browser-specific instructions
    Modal.alert(
      title,
      'Please allow microphone access in your browser settings. You may need to click the lock icon in the address bar and enable microphone permission for this site.',
      [{ text: 'OK' }]
    );
  } else {
    Modal.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Open Settings',
        onPress: () => {
          // Opens app settings on iOS/Android
          Linking.openSettings();
        }
      }
    ]);
  }
}
