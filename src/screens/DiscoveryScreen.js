/**
 * Pantalla principal: Descobriment i llista de terminals HbbTV
 * UI renovada: llista de TVs amb MediaSync inline i navegacio per tabs
 * Dispositius sense MediaSync agrupats en seccio colapsada.
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import theme from '../theme';
import { getDIALDiscoveryService } from '../services/DIALDiscoveryService';
import TerminalItem from '../components/TerminalItem';
import AppHeader from '../components/AppHeader';

export default function DiscoveryScreen({ navigation }) {
  const { t } = useTranslation();
  const [terminals, setTerminals] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [expandedUrl, setExpandedUrl] = useState(null);
  const [othersExpanded, setOthersExpanded] = useState(false);
  const dialService = getDIALDiscoveryService();

  useEffect(() => {
    const onReady = () => {
      setIsSearching(true);
      setSearchResult(null);
    };

    const onFound = (terminal) => {
      setTerminals((prev) => {
        const exists = prev.find(
          (tm) => tm.deviceDescriptionUrl === terminal.deviceDescriptionUrl
        );
        if (exists) return prev;
        return [...prev, terminal];
      });
    };

    const onError = (error) => {
      Alert.alert('Error', error.message);
      setIsSearching(false);
    };

    const onStop = () => {
      setIsSearching(false);
    };

    const onSearchComplete = (result) => {
      setSearchResult(result);
      setIsSearching(false);
    };

    dialService.on('ready', onReady);
    dialService.on('found', onFound);
    dialService.on('error', onError);
    dialService.on('stop', onStop);
    dialService.on('searchComplete', onSearchComplete);

    startDiscovery();

    return () => {
      dialService.removeListener('ready', onReady);
      dialService.removeListener('found', onFound);
      dialService.removeListener('error', onError);
      dialService.removeListener('stop', onStop);
      dialService.removeListener('searchComplete', onSearchComplete);
    };
  }, []);

  const startDiscovery = () => {
    dialService.stop();
    setTerminals([]);
    setSearchResult(null);
    setExpandedUrl(null);
    setOthersExpanded(false);
    dialService.start();
  };

  const handleToggleExpand = (url) => {
    setExpandedUrl((prev) => (prev === url ? null : url));
  };

  const toggleOthers = () => {
    setOthersExpanded((prev) => !prev);
  };

  const { withMediaSync, withoutMediaSync, listData } = useMemo(() => {
    const withSync = [];
    const withoutSync = [];

    for (const tm of terminals) {
      const hasMedia = tm.hasMediaSyncCapability && tm.hasMediaSyncCapability();
      if (hasMedia) {
        withSync.push(tm);
      } else {
        withoutSync.push(tm);
      }
    }

    const data = [];
    withSync.forEach((tm) =>
      data.push({ type: 'terminal', key: tm.deviceDescriptionUrl, terminal: tm })
    );

    if (withoutSync.length > 0) {
      data.push({
        type: 'header',
        key: 'others-header',
        count: withoutSync.length,
      });
      if (othersExpanded) {
        withoutSync.forEach((tm) =>
          data.push({
            type: 'terminal',
            key: tm.deviceDescriptionUrl,
            terminal: tm,
          })
        );
      }
    }

    return { withMediaSync: withSync, withoutMediaSync: withoutSync, listData: data };
  }, [terminals, othersExpanded]);

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <TouchableOpacity
          onPress={toggleOthers}
          activeOpacity={0.7}
          style={styles.sectionHeader}
        >
          <View style={styles.sectionHeaderLine} />
          <View style={styles.sectionHeaderContent}>
            <Text style={styles.sectionHeaderText}>
              {t('discovery.otherDevices', { count: item.count })}
            </Text>
            <MaterialIcons
              name={othersExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
              size={12}
              color={theme.colors.onSurfaceVariant}
            />
          </View>
          <View style={styles.sectionHeaderLine} />
        </TouchableOpacity>
      );
    }

    return (
      <TerminalItem
        terminal={item.terminal}
        expanded={expandedUrl === item.terminal.deviceDescriptionUrl}
        onToggleExpand={() => handleToggleExpand(item.terminal.deviceDescriptionUrl)}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <AppHeader
        title={t('discovery.title')}
        subtitle={t('discovery.subtitle')}
      />

      {/* Lista de terminales */}
      <FlatList
        data={listData}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        contentContainerStyle={[
          styles.listContainer,
          terminals.length === 0 && styles.listContainerEmpty,
        ]}
        ListHeaderComponent={
          <>
            {isSearching && (
              <View style={styles.searchingBar}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
                <Text style={styles.searchingText}>{t('discovery.searching')}</Text>
              </View>
            )}
            {!isSearching && withMediaSync.length === 0 && terminals.length > 0 ? (
              <View style={styles.noMediaSyncContainer}>
                <MaterialIcons name="info-outline" size={32} color={theme.colors.onSurfaceVariant} />
                <Text style={styles.noMediaSyncText}>{t('discovery.noMediaSyncDevices')}</Text>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            {isSearching ? (
              <>
                <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginBottom: theme.spacing.md }} />
                <Text style={styles.emptyText}>{t('discovery.searching')}</Text>
              </>
            ) : searchResult && !searchResult.success ? (
              <>
                <MaterialIcons name="warning" size={48} color={theme.colors.onSurfaceVariant} style={styles.emptyIcon} />
                <Text style={styles.emptyText}>{searchResult.message}</Text>
                <Text style={styles.emptyHint}>
                  {t('discovery.errorHint')}
                </Text>
              </>
            ) : (
              <Text style={styles.emptyText}>
                {t('discovery.noDevices')}
              </Text>
            )}
          </View>
        }
      />

      {/* Boton flotante de refresh */}
      <TouchableOpacity
        style={styles.fab}
        onPress={startDiscovery}
        disabled={isSearching}
        activeOpacity={0.8}
      >
        <MaterialIcons name="refresh" size={24} color={theme.colors.onPrimaryContainer} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  searchingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  searchingText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  listContainer: {
    padding: theme.spacing.md,
    paddingTop: 0,
    paddingBottom: 100,
  },
  listContainerEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.onSurfaceVariant,
    textAlign: 'center',
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  emptyHint: {
    fontSize: 14,
    color: theme.colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  noMediaSyncContainer: {
    paddingVertical: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noMediaSyncText: {
    marginTop: theme.spacing.md,
    fontSize: 15,
    color: theme.colors.onSurfaceVariant,
    textAlign: 'center',
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    gap: 12,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.outlineVariant,
  },
  sectionHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },
  sectionHeaderChevron: {
    fontSize: 12,
    color: theme.colors.onSurfaceVariant,
  },
  fab: {
    position: 'absolute',
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  fabText: {
    fontSize: 24,
    color: theme.colors.onPrimaryContainer,
  },
});
