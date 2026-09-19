import * as Haptics from 'expo-haptics';

export function hapticsError() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export function hapticsLight() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

/** The heaviest tick, for a change the reader should notice without looking at the screen. */
export function hapticsHeavy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export function hapticsSuccess() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}