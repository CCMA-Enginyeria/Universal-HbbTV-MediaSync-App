/**
 * Header compartit de l'aplicació.
 * Es fa servir a les pantalles que volen l'encapçalament amb marca i opcionalment títol/subtítol.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import theme from '../theme';
import brand from '../brand/brand.config';

export default function AppHeader({
  headerTitle = brand.appName,
  title,
  subtitle,
  rightIcon = 'signal-cellular-alt',
  showSearching = false,
  searchingText,
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.headerTitleRow}>
          <MaterialIcons name="settings-input-antenna" size={20} color={theme.colors.primary} />
          <Text style={styles.headerTitleText}>{headerTitle}</Text>
        </View>
        <MaterialIcons name={rightIcon} size={18} color={theme.colors.onSurfaceVariant} />
      </View>

      {(title || subtitle || showSearching) && (
        <>
          <View style={styles.titleRow}>
            {title && <Text style={styles.title}>{title}</Text>}
            {showSearching && (
              <View style={styles.searchingBadge}>
                <MaterialIcons name="autorenew" size={12} color={theme.colors.primary} />
                <Text style={styles.searchingText}>{searchingText}</Text>
              </View>
            )}
          </View>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleText: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.primary,
    fontFamily: theme.typography.headlineSm.fontFamily,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.sm,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.displayLg.fontFamily,
  },
  searchingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  searchingText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.bodyMd.fontFamily,
    lineHeight: 20,
  },
});
