import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';
import { CustomButton } from './CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';
import { RESULTS } from 'react-native-permissions';

const { height } = Dimensions.get('window');

export const PermissionsGate: React.FC = () => {
    const { 
        locationStatus, 
        backgroundLocationStatus, 
        notificationStatus, 
        dndStatus,
        requestLocationFlow,
        requestNotificationFlow,
        requestDndFlow
    } = usePermissions();

    const isLocationGranted = locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED;
    const isBackgroundGranted = backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED;
    const isNotificationGranted = notificationStatus === RESULTS.GRANTED;
    const isDndGranted = dndStatus === RESULTS.GRANTED;

    const allGranted = isLocationGranted && isBackgroundGranted && isNotificationGranted && isDndGranted;

    if (allGranted) return null;

    const PERMISSION_ITEMS = [
        {
            id: 'location',
            title: 'Location Access',
            subtitle: 'Needed to detect silent zones near you.',
            icon: 'location-on',
            status: isLocationGranted,
            onPress: requestLocationFlow,
        },
        {
            id: 'background',
            title: 'Background Tracking',
            subtitle: 'Required for automatic silencing while phone is in pocket.',
            icon: 'near-me',
            status: isBackgroundGranted,
            onPress: requestLocationFlow, // Usually triggers Always from InUse
        },
        {
            id: 'dnd',
            title: 'Do Not Disturb',
            subtitle: 'Necessary to change ringer mode automatically.',
            icon: 'notifications-paused',
            status: isDndGranted,
            onPress: requestDndFlow,
        },
        {
            id: 'notifications',
            title: 'Notifications',
            subtitle: 'Sends alerts when your phone is silenced or restored.',
            icon: 'notifications-active',
            status: isNotificationGranted,
            onPress: requestNotificationFlow,
        }
    ];

    return (
        <View style={styles.overlay}>
            <View style={styles.container}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.header}>
                        <View style={styles.iconCircle}>
                            <MaterialIcon name="security" size={40} color={theme.colors.primary} />
                        </View>
                        <Text style={styles.title}>Permissions Required</Text>
                        <Text style={styles.subtitle}>
                            Silent Zone needs these permissions to monitor your locations reliably in the background.
                        </Text>
                    </View>

                    <View style={styles.list}>
                        {PERMISSION_ITEMS.map((item) => (
                            <TouchableOpacity 
                                key={item.id} 
                                style={[styles.item, item.status && styles.itemDisabled]}
                                onPress={item.onPress}
                                disabled={item.status}
                            >
                                <View style={[styles.iconBox, item.status ? styles.iconBoxSuccess : styles.iconBoxPending]}>
                                    <MaterialIcon 
                                        name={item.status ? 'check-circle' : item.icon} 
                                        size={24} 
                                        color={item.status ? theme.colors.success : theme.colors.primary} 
                                    />
                                </View>
                                <View style={styles.itemText}>
                                    <Text style={[styles.itemTitle, item.status && styles.textMuted]}>{item.title}</Text>
                                    <Text style={[styles.itemSubtitle, item.status && styles.textMuted]} numberOfLines={2}>
                                        {item.status ? 'Permission granted successfully' : item.subtitle}
                                    </Text>
                                </View>
                                {!item.status && (
                                    <MaterialIcon name="chevron-right" size={24} color={theme.colors.border.dark} />
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>

                <View style={styles.footer}>
                    <CustomButton
                        title="Complete Setup"
                        onPress={async () => {
                            if (!isLocationGranted) await requestLocationFlow();
                            else if (!isBackgroundGranted) await requestLocationFlow();
                            else if (!isDndGranted) await requestDndFlow();
                            else if (!isNotificationGranted) await requestNotificationFlow();
                        }}
                        fullWidth
                        style={styles.button}
                        disabled={allGranted}
                    />
                    <Text style={[styles.footerText, { color: theme.colors.text.secondary.light }]}>
                        Tap on any item to grant specific permission
                    </Text>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        zIndex: 1000,
        justifyContent: 'flex-end',
    },
    container: {
        height: height * 0.85,
        backgroundColor: theme.colors.background.light,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingTop: theme.spacing.xl,
        ...theme.layout.shadows.large,
    },
    scrollContent: {
        paddingHorizontal: theme.spacing.xl,
        paddingBottom: 40,
    },
    header: {
        alignItems: 'center',
        marginBottom: theme.spacing.xxl,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: theme.colors.primary + '1A',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: theme.spacing.lg,
    },
    title: {
        fontFamily: theme.typography.primary,
        fontSize: theme.typography.sizes.xxl,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary.light,
        marginBottom: theme.spacing.sm,
    },
    subtitle: {
        fontFamily: theme.typography.primary,
        fontSize: theme.typography.sizes.md,
        color: theme.colors.text.secondary.light,
        textAlign: 'center',
        lineHeight: 22,
        paddingHorizontal: 20,
    },
    list: {
        gap: theme.spacing.md,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface.light,
        padding: theme.spacing.md,
        borderRadius: theme.layout.borderRadius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border.light,
        gap: theme.spacing.md,
    },
    itemDisabled: {
        borderColor: 'transparent',
        backgroundColor: theme.colors.background.light,
    },
    iconBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconBoxPending: {
        backgroundColor: theme.colors.primary + '10',
    },
    iconBoxSuccess: {
        backgroundColor: theme.colors.success + '10',
    },
    itemText: {
        flex: 1,
    },
    itemTitle: {
        fontSize: theme.typography.sizes.md,
        fontWeight: theme.typography.weights.bold,
        color: theme.colors.text.primary.light,
        marginBottom: 2,
    },
    itemSubtitle: {
        fontSize: theme.typography.sizes.xs,
        color: theme.colors.text.secondary.light,
        lineHeight: 16,
    },
    textMuted: {
        opacity: 0.5,
    },
    footer: {
        padding: theme.spacing.xl,
        paddingBottom: 48,
        backgroundColor: theme.colors.background.light,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border.light,
    },
    button: {
        height: 56,
        borderRadius: 16,
        marginBottom: theme.spacing.sm,
    },
    footerText: {
        textAlign: 'center',
        fontSize: 12,
        fontWeight: '500',
    }
});
