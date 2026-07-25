import * as React from 'react';
import { memo } from 'react';
import { AppState, Linking, View, Text, TouchableOpacity } from 'react-native';
import { Camera, type CameraPermissionStatus, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { useLocalSearchParams, router } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useScannerEvents } from '@/hooks/useScannerEvents';
import { t } from '@/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function ScannerScreen() {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const { scanId } = useLocalSearchParams<{ scanId: string }>();
    const device = useCameraDevice('back');
    const { hasPermission, requestPermission } = useCameraPermission();
    const [permissionStatus, setPermissionStatus] = React.useState<CameraPermissionStatus>(() => Camera.getCameraPermissionStatus());
    const emitScan = useScannerEvents((s) => s.emitScan);
    const hasScannedRef = React.useRef(false);

    // Keep the screen in sync when the user changes camera access in Settings.
    React.useEffect(() => {
        if (hasPermission) {
            setPermissionStatus('granted');
        }
    }, [hasPermission]);

    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') {
                setPermissionStatus(Camera.getCameraPermissionStatus());
            }
        });

        return () => subscription.remove();
    }, []);

    const handleRequestPermission = React.useCallback(async () => {
        await requestPermission();
        setPermissionStatus(Camera.getCameraPermissionStatus());
    }, [requestPermission]);

    const handleOpenSettings = React.useCallback(() => {
        void Linking.openSettings();
    }, []);

    const handleCodeScanned = React.useCallback((value: string) => {
        if (value && !hasScannedRef.current && scanId) {
            hasScannedRef.current = true;
            emitScan(value, scanId);
            router.back();
        }
    }, [scanId, emitScan]);

    const codeScanner = useCodeScanner({
        codeTypes: ['qr'],
        onCodeScanned: (codes) => {
            const value = codes[0]?.value;
            if (value) {
                handleCodeScanned(value);
            }
        },
    });

    const handleClose = React.useCallback(() => {
        router.back();
    }, []);

    // Explain why camera access is needed before showing the system prompt.
    if (permissionStatus === 'not-determined') {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.message, { color: theme.colors.text }]}>
                    {t('modals.cameraPermissionsRequiredToScanQr')}
                </Text>
                <TouchableOpacity style={styles.button} onPress={handleRequestPermission}>
                    <Text style={styles.buttonText}>{t('common.continue')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={handleClose}>
                    <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{t('common.cancel')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // Once access has been denied, iOS requires the user to enable it in Settings.
    if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.message, { color: theme.colors.text }]}>
                    {t('modals.cameraPermissionsRequiredToScanQr')}
                </Text>
                {permissionStatus === 'denied' && (
                    <TouchableOpacity style={styles.button} onPress={handleOpenSettings}>
                        <Text style={styles.buttonText}>{t('tabs.settings')}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.secondaryButton} onPress={handleClose}>
                    <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{t('common.cancel')}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // 无摄像头设备
    if (!device) {
        return (
            <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
                <Text style={[styles.message, { color: theme.colors.text }]}>
                    {t('errors.noCameraDevice')}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={true}
                codeScanner={codeScanner}
            />
            {/* 关闭按钮 */}
            <TouchableOpacity
                style={[styles.closeButton, { top: insets.top + 16 }]}
                onPress={handleClose}
            >
                <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
            {/* 扫描框 */}
            <View style={styles.overlay}>
                <View style={styles.scanFrame} />
            </View>
        </View>
    );
}

export default memo(ScannerScreen);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginHorizontal: 32,
        marginTop: 100,
    },
    button: {
        marginTop: 24,
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        alignSelf: 'center',
    },
    buttonText: {
        color: theme.colors.button.primary.tint,
        fontSize: 16,
        fontWeight: '600',
    },
    secondaryButton: {
        marginTop: 12,
        paddingHorizontal: 24,
        paddingVertical: 12,
        alignSelf: 'center',
    },
    secondaryButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    closeButton: {
        position: 'absolute',
        left: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    closeButtonText: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        pointerEvents: 'none',
    },
    scanFrame: {
        width: 250,
        height: 250,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.8)',
        borderRadius: 16,
    },
}));
