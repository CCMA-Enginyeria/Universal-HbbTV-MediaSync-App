/**
 * Pantalla de Ayuda / Centro de Ayuda
 * Compatibilidad de dispositivos y guia de connexio
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MaterialIcons } from '@expo/vector-icons';
import theme from '../theme';
import AppHeader from '../components/AppHeader';

// Brand logos mapping
const BRAND_LOGOS = {
  'Vestel': require('../../assets/brands/vestel.png'),
};

export default function HelpScreen({ navigation }) {
  const { t } = useTranslation();

  const TV_BRANDS = t('help.brands', { returnObjects: true });
  const CHANNELS = t('help.channels', { returnObjects: true });
  const TROUBLESHOOTING_STEPS = t('help.troubleshootingSteps', { returnObjects: true });

  return (
    <SafeAreaView style={styles.container}>
      <AppHeader
              title={t('help.mainTitle')}
              subtitle={t('help.mainSubtitle')}
              showSearching={false}
            />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Televisores compatibles */}
        {/*<View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="tv" size={20} color={theme.colors.onSurface} style={styles.sectionIcon} />
            <Text style={styles.sectionTitle}>{t('help.compatibleTVs')}</Text>
          </View>

          {TV_BRANDS.map((brand, index) => (
            <View
              key={index}
              style={[
                styles.brandCard
              ]}
            >
              <View style={styles.brandIconContainer}>
                {BRAND_LOGOS[brand.name] ? (
                  <Image
                    source={BRAND_LOGOS[brand.name]}
                    style={styles.brandLogo}
                    resizeMode="contain"
                  />
                ) : (
                  <MaterialIcons name={brand.icon} size={18} color={theme.colors.onSurface} />
                )}
              </View>
              <View style={styles.brandInfo}>
                <Text style={styles.brandName}>{brand.name}</Text>
                <Text style={styles.brandDescription}>{brand.description}</Text>
                {brand.compatibility && (
                  <Text style={styles.brandCompatibility}>{brand.compatibility}</Text>
                )}
              </View>
            </View>
          ))}
        </View>*/}

        {/* Canales con servicio */}
        {/*<View style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="satellite" size={20} color={theme.colors.onSurface} style={styles.sectionIcon} />
            <Text style={styles.sectionTitle}>{t('help.channelsTitle')}</Text>
          </View>

          <View style={styles.channelsGrid}>
            {CHANNELS.map((channel, index) => (
              <View key={index} style={styles.channelCard}>
                <View style={styles.channelVisual}>
                  <MaterialIcons name={channel.icon} size={28} color={theme.colors.onSurface} style={styles.channelLogo} />
                  <Text style={styles.channelName}>{channel.name}</Text>
                </View>
                <Text style={styles.channelRegion}>{channel.region}</Text>
                <Text style={styles.channelStatus}>{channel.status}</Text>
              </View>
            ))}
          </View>
        </View>*/}

        {/* Troubleshooting */}
        <View style={styles.troubleshootingCard}>
          <View style={styles.troubleshootingHeader}>
            <MaterialIcons name="help-outline" size={20} color={theme.colors.onSurface} style={styles.troubleshootingIcon} />
            <Text style={styles.troubleshootingTitle}>{t('help.troubleshootingTitle')}</Text>
          </View>

          {TROUBLESHOOTING_STEPS.map((step, index) => (
            <View key={index} style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.md,
    paddingTop: 0,
    paddingBottom: 0,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  sectionIcon: {
    fontSize: 20,
    marginRight: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.typography.headlineSm.fontSize,
    fontWeight: theme.typography.headlineSm.fontWeight,
    color: theme.colors.onSurface,
    fontFamily: theme.typography.headlineSm.fontFamily,
    lineHeight: theme.typography.headlineSm.lineHeight,
  },
  brandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceContainer,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.surfaceContainerHigh,
  },

  brandIconContainer: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },

  brandInfo: {
    flex: 1,
  },
  brandName: {
    fontSize: theme.typography.bodyLg.fontSize,
    fontWeight: '600',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  brandDescription: {
    fontSize: theme.typography.bodyMd.fontSize,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.bodyMd.fontFamily,
    marginTop: 2,
  },

  brandLogo: {
    width: 32,
    height: 32,
  },

  brandCompatibility: {
    fontSize: theme.typography.bodyMd.fontSize - 2,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.bodyMd.fontFamily,
    marginTop: theme.spacing.xs,
    fontStyle: 'italic',
  },

  channelsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  channelCard: {
    width: '47%',
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.surfaceContainerHigh,
    marginBottom: theme.spacing.sm,
  },
  channelVisual: {
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderRadius: theme.radius.md,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  channelLogo: {
    fontSize: 28,
    marginBottom: theme.spacing.xs,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  channelRegion: {
    fontSize: theme.typography.labelCaps.fontSize,
    fontWeight: theme.typography.labelCaps.fontWeight,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.labelCaps.fontFamily,
    letterSpacing: theme.typography.labelCaps.letterSpacing,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
  },
  channelStatus: {
    fontSize: theme.typography.bodyMd.fontSize,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginTop: 2,
  },
  troubleshootingCard: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.surfaceContainerHigh,
    marginTop: theme.spacing.md,
  },
  troubleshootingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  troubleshootingIcon: {
    fontSize: 20,
    marginRight: theme.spacing.sm,
  },
  troubleshootingTitle: {
    fontSize: theme.typography.headlineSm.fontSize,
    fontWeight: theme.typography.headlineSm.fontWeight,
    color: theme.colors.onSurface,
    fontFamily: theme.typography.headlineSm.fontFamily,
    lineHeight: theme.typography.headlineSm.lineHeight,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
    marginTop: 2,
  },
  stepNumberText: {
    color: theme.colors.onPrimary,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  stepText: {
    flex: 1,
    fontSize: theme.typography.bodyLg.fontSize,
    color: theme.colors.onSurfaceVariant,
    fontFamily: theme.typography.bodyLg.fontFamily,
    lineHeight: theme.typography.bodyLg.lineHeight,
  },

});
