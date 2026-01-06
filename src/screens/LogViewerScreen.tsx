import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { Logger } from '../services/Logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const LogViewerScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<any[]>([]);

  const loadLogs = () => {
    const activeLogs = Logger.getLogs(500); // Get last 500 logs
    setLogs(activeLogs);
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleShare = async () => {
    await Logger.exportLogs();
  };

  const handleClear = () => {
    Alert.alert(
        'Clear Logs',
        'Are you sure you want to delete all logs?',
        [
            { text: 'Cancel', style: 'cancel' },
            { 
                text: 'Clear', 
                style: 'destructive',
                onPress: () => {
                    Logger.clearLogs();
                    loadLogs();
                }
            }
        ]
    );
  };

  const getLevelColor = (level: string) => {
    switch (level) {
        case 'ERROR': return theme.colors.error;
        case 'WARN': return theme.colors.warning;
        case 'INFO': return theme.colors.success; // or blue
        default: return theme.colors.text.secondary.light;
    }
  };

  const renderItem = ({ item }: any) => (
    <View style={styles.logItem}>
        <View style={styles.logHeader}>
            <Text style={[styles.logLevel, { color: getLevelColor(item.level) }]}>{item.level}</Text>
            <Text style={styles.logTime}>{item.timestamp.toLocaleTimeString()}</Text>
        </View>
        <Text style={styles.logMessage}>{item.message}</Text>
        {item.details && (
            <Text style={styles.logDetails} numberOfLines={2}>{item.details}</Text>
        )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
           <MaterialIcon name="arrow-back-ios" size={20} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>System Logs</Text>
        <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleClear} style={styles.actionBtn}>
                <MaterialIcon name="delete-sweep" size={24} color={theme.colors.error} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={styles.actionBtn}>
                <MaterialIcon name="share" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={logs}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        ListEmptyComponent={
            <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No logs found</Text>
            </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.surface.light,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  headerTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 16,
  },
  iconBtn: {
    padding: 8,
  },
  actionBtn: {
    padding: 4,
  },
  listContent: {
    padding: theme.spacing.md,
  },
  logItem: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
    paddingBottom: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  logLevel: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  logTime: {
    fontSize: 10,
    color: theme.colors.text.secondary.light,
  },
  logMessage: {
    fontSize: 12,
    color: theme.colors.text.primary.light,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logDetails: {
    fontSize: 10,
    color: theme.colors.text.secondary.light,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: theme.colors.text.secondary.light,
  }
});

import { Platform } from 'react-native';
