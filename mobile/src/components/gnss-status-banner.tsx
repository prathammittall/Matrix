import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { formatClock, formatDistance, formatSpeed } from '@/services/format';
import type { Units } from '@/services/storage';
import { Radius, Spacing, useColors } from '@/theme';
import type { GnssState, NavigationMode } from '@/types';
import { describeStatus } from './navigation-status';
import {
  Badge,
  IconCrosshair,
  IconNavigate,
  IconSatellite,
  IconWarning,
  Row,
  StatusDot,
  Txt,
} from './ui';

export interface GnssStatusBannerProps {
  mode: NavigationMode;
  gnssState: GnssState;
  gnssReason: string;
  accuracyM?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  outageSeconds?: number | null;
  units: Units;
  isSimulatingOutage?: boolean;
  onToggleSimulateOutage?: () => void;
  hasRoute?: boolean;
  isNavigating?: boolean;
  onStartNavigation?: () => void;
  onStopNavigation?: () => void;
  compact?: boolean;
}

export function GnssStatusBanner({
  mode,
  gnssState,
  gnssReason,
  accuracyM,
  speedMps,
  headingDeg,
  outageSeconds,
  units,
  isSimulatingOutage = false,
  onToggleSimulateOutage,
  hasRoute = false,
  isNavigating = false,
  onStartNavigation,
  onStopNavigation,
  compact = false,
}: GnssStatusBannerProps) {
  const c = useColors();
  const status = describeStatus(mode, gnssState, gnssReason);
  const color = c[status.tone];
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!status.ai && mode !== 'DEAD_RECKONING') {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status.ai, mode, pulse]);

  const isDeadReckoning = mode === 'DEAD_RECKONING';
  const isGnssActive = mode === 'GNSS' || gnssState === 'ACTIVE';

  return (
    <View style={[styles.container, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Top accent line */}
      <Animated.View
        style={[
          styles.accentLine,
          {
            backgroundColor: color,
            opacity: isDeadReckoning
              ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
              : 1,
          },
        ]}
      />

      <View style={styles.body}>
        {/* Main Status Row */}
        <Row justify="space-between" align="center">
          <Row gap={Spacing.sm} align="center" style={{ flex: 1 }}>
            <View style={[styles.iconWrap, { backgroundColor: `${color}18` }]}>
              {isDeadReckoning ? (
                <IconNavigate size={16} tint={color} />
              ) : isGnssActive ? (
                <IconSatellite size={16} tint={color} />
              ) : (
                <IconCrosshair size={16} tint={color} />
              )}
            </View>

            <View style={{ flex: 1 }}>
              <Row gap={6} align="center">
                <StatusDot tone={status.tone} size={8} pulse={isDeadReckoning} />
                <Txt variant="bodyStrong" numberOfLines={1} style={{ color }}>
                  {isDeadReckoning ? 'AI DEAD RECKONING ACTIVE' : status.label}
                </Txt>
              </Row>

              <Txt variant="caption" color="textSecondary" numberOfLines={1}>
                {isDeadReckoning
                  ? 'GNSS lost — AI IMU fused navigation active'
                  : isGnssActive
                    ? accuracyM != null
                      ? `GNSS 3D Fix • Accurate to ±${Math.round(accuracyM * 10) / 10} m`
                      : 'GNSS 3D Fix • Signal healthy'
                    : status.detail}
              </Txt>
            </View>
          </Row>

          {/* Outage clock / active duration */}
          {outageSeconds != null && outageSeconds > 0 ? (
            <View style={[styles.timeBadge, { backgroundColor: `${color}20`, borderColor: `${color}44` }]}>
              <Txt variant="micro" style={{ color }} tabular>
                {formatClock(outageSeconds)}
              </Txt>
            </View>
          ) : null}
        </Row>

        {/* Live Metrics Row (Speed, Heading, Accuracy, Source) */}
        {!compact ? (
          <Row justify="space-between" align="center" style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Txt variant="micro" color="textTertiary">
                SPEED
              </Txt>
              <Txt variant="caption" color="text" tabular>
                {formatSpeed(speedMps ?? null, units)}
              </Txt>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Txt variant="micro" color="textTertiary">
                ACCURACY
              </Txt>
              <Txt variant="caption" color="text" tabular>
                {accuracyM != null ? `±${Math.round(accuracyM)} m` : '—'}
              </Txt>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Txt variant="micro" color="textTertiary">
                HEADING
              </Txt>
              <Txt variant="caption" color="text" tabular>
                {headingDeg != null ? `${Math.round(headingDeg)}°` : '—'}
              </Txt>
            </View>

            <View style={styles.metricDivider} />

            <View style={styles.metricItem}>
              <Txt variant="micro" color="textTertiary">
                SOURCE
              </Txt>
              <Txt
                variant="caption"
                tabular
                style={{ color: isDeadReckoning ? c.ai : c.ok }}>
                {isDeadReckoning ? 'IMU AI' : 'GNSS'}
              </Txt>
            </View>
          </Row>
        ) : null}

        {/* Action Controls Row */}
        <Row gap={Spacing.sm} align="center" style={styles.actionRow}>
          {onToggleSimulateOutage ? (
            <Pressable
              onPress={onToggleSimulateOutage}
              style={({ pressed }) => [
                styles.simulateButton,
                {
                  borderColor: isSimulatingOutage ? c.danger : c.border,
                  backgroundColor: isSimulatingOutage
                    ? `${c.danger}15`
                    : pressed
                      ? c.surfaceRaised
                      : 'transparent',
                },
              ]}>
              <Row gap={4} align="center">
                <IconWarning size={14} tint={isSimulatingOutage ? c.danger : c.textSecondary} />
                <Txt
                  variant="caption"
                  style={{
                    color: isSimulatingOutage ? c.danger : c.textSecondary,
                    fontWeight: isSimulatingOutage ? '700' : '500',
                  }}>
                  {isSimulatingOutage ? 'Restore GNSS' : 'Simulate Outage'}
                </Txt>
              </Row>
            </Pressable>
          ) : null}

          {/* Google Maps Style Start Button */}
          {onStartNavigation || onStopNavigation ? (
            <Pressable
              onPress={isNavigating ? onStopNavigation : onStartNavigation}
              style={({ pressed }) => [
                styles.navButton,
                {
                  backgroundColor: isNavigating ? c.danger : '#1A73E8', // Google Blue
                  opacity: pressed ? 0.9 : 1,
                  flex: 1,
                },
              ]}>
              <Row gap={6} align="center" justify="center">
                <IconNavigate size={18} tint="#FFFFFF" />
                <Txt variant="bodyStrong" style={{ color: '#FFFFFF' }}>
                  {isNavigating
                    ? 'Exit Navigation'
                    : hasRoute
                      ? 'Start'
                      : 'Start Free Navigation'}
                </Txt>
              </Row>
            </Pressable>
          ) : null}
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  accentLine: {
    height: 4,
    width: '100%',
  },
  body: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  metricsRow: {
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  metricItem: {
    alignItems: 'center',
    gap: 2,
  },
  metricDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#333C4B33',
  },
  actionRow: {
    marginTop: 2,
  },
  simulateButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButton: {
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
