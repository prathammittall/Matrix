import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AIStatusCard } from '@/components/ai-status-card';
import { GnssStatusBanner } from '@/components/gnss-status-banner';
import { GoogleMapsLocationSelector } from '@/components/google-maps-location-selector';
import { GuidanceBanner, TripSummaryBar } from '@/components/guidance-banner';
import { MapLegend } from '@/components/map-legend';
import { MatrixMap, type MapMarkerSpec, type MapTrack, type MatrixMapHandle } from '@/components/matrix-map';
import { OutageBanner } from '@/components/outage-banner';
import {
  IconCrosshair,
  IconLayers,
  IconButton,
  Row,
} from '@/components/ui';
import { useEngine } from '@/hooks/use-engine';
import { useRouteGuidance, useSmoothVehicle } from '@/hooks/use-guidance';
import { useSettings } from '@/hooks/use-settings';
import { useVoiceGuidance } from '@/hooks/use-voice-guidance';
import { api } from '@/services/api';
import { splitRoute } from '@/services/guidance';
import { engine } from '@/services/navigation-engine';
import { storage } from '@/services/storage';
import { stopSpeaking } from '@/services/voice';
import { Spacing, useColors } from '@/theme';
import type { ModelInfo, Route } from '@/types';

const MAP_TYPES = ['standard', 'terrain'] as const;
const KEEP_AWAKE_TAG = 'matrix-google-maps';

/**
 * Google Maps styled Main Navigation & Location Selection screen.
 *
 * Provides:
 * - A full-page experience with Google Maps location selection at the top.
 * - Prominent GNSS status on the bottom banner.
 * - Interactive vector map with vehicle puck & real-time polyline.
 * - Turn-by-turn navigation mode with seamless AI Dead Reckoning handover.
 */
export default function GoogleMapsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { settings, update } = useSettings();
  const state = useEngine();
  const mapRef = useRef<MatrixMapHandle>(null);

  const [starting, setStarting] = useState(false);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [following, setFollowing] = useState(settings.followVehicle);
  const lastMode = useRef(state.mode);

  const trip = useRouteGuidance(state);
  const { route, guidance } = trip;
  const announced = useRef<number | null>(null);

  // Smooth vehicle movement
  const vehicle = useSmoothVehicle(state.position, state.headingDeg, state.mode !== 'IDLE');

  // Turn-by-turn voice guidance
  useVoiceGuidance(route, guidance, state.mode, settings.units, settings.voiceGuidance);

  // Keep screen awake while driving
  useEffect(() => {
    const navigating = state.mode !== 'IDLE';
    if (!settings.keepAwake || !navigating) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [settings.keepAwake, state.mode]);

  useEffect(() => {
    api
      .modelInfo()
      .then(setModel)
      .catch(() => setModel(null));
  }, []);

  // Haptic feedback on mode changes (GNSS -> Dead Reckoning)
  useEffect(() => {
    if (state.mode === lastMode.current) return;
    const was = lastMode.current;
    lastMode.current = state.mode;
    if (settings.hapticsOnModeChange) {
      if (state.mode === 'DEAD_RECKONING') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else if (state.mode === 'GNSS' && was === 'DEAD_RECKONING') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (state.mode === 'DEGRADED') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [state.mode, settings.hapticsOnModeChange]);

  const onStart = useCallback(async () => {
    setStarting(true);
    engine.setInferenceMode(settings.inferenceMode);
    const res = await engine.start();
    setStarting(false);
    if (res.error) Alert.alert('Navigation started with limits', res.error);
  }, [settings.inferenceMode]);

  const onStop = useCallback(async () => {
    stopSpeaking();
    const session = await engine.stop();
    if (session && (session.gnssPath.length > 1 || session.outages.length)) {
      await storage.saveSession(session);
      Alert.alert('Session saved', 'The drive is now saved in History.', [
        { text: 'OK', style: 'cancel' },
        {
          text: 'View Session',
          onPress: () => router.push({ pathname: '/session/[id]', params: { id: session.id } }),
        },
      ]);
    }
  }, []);

  const onRoutePlanned = useCallback(
    (planned: Route) => {
      trip.setRoute(planned);
      setFollowing(true);
      mapRef.current?.fitTo(planned.geometry);
      if (state.mode === 'IDLE') {
        void onStart();
      }
    },
    [trip, state.mode, onStart],
  );

  const onClearRoute = useCallback(() => {
    trip.clearRoute();
  }, [trip]);

  const onEndTrip = useCallback(() => {
    Alert.alert('Exit guidance?', 'The route will be cleared. Navigation tracking continues.', [
      { text: 'Keep Navigating', style: 'cancel' },
      { text: 'Exit Route', style: 'destructive', onPress: () => trip.clearRoute() },
    ]);
  }, [trip]);

  const navigating = state.mode !== 'IDLE';
  const outageSeconds = state.activeOutage ? state.activeOutage.durationS : null;

  // Map tracks: Planned route, GNSS line, Dead Reckoning line
  const tracks = useMemo<MapTrack[]>(() => {
    const out: MapTrack[] = [];
    if (route) {
      const { travelled, remaining } = splitRoute(route, guidance?.distanceAlongM ?? 0);
      if (travelled.length > 1) {
        out.push({ id: 'route-done', points: travelled, color: c.textTertiary, width: 7, opacity: 0.5 });
      }
      if (remaining.length > 1) {
        out.push({ id: 'route', points: remaining, color: '#1A73E8', width: 8, opacity: 0.9 });
      }
    }
    if (settings.showGnssTrack && state.gnssPath.length > 1) {
      out.push({ id: 'gnss', points: state.gnssPath, color: c.trackGnss, width: 5 });
    }
    if (settings.showDrTrack && state.drPath.length > 1) {
      out.push({ id: 'dr', points: state.drPath, color: c.trackDr, width: 5, dashed: true });
    }
    return out;
  }, [
    route,
    guidance?.distanceAlongM,
    settings.showGnssTrack,
    settings.showDrTrack,
    state.gnssPath,
    state.drPath,
    c,
  ]);

  const markers = useMemo<MapMarkerSpec[]>(() => {
    const out: MapMarkerSpec[] = [];
    if (route) {
      out.push({
        id: 'destination',
        coordinate: { latitude: route.destination.latitude, longitude: route.destination.longitude },
        title: route.destination.name,
        description: 'Destination',
        color: '#EA4335', // Google Red
      });
    }
    if (state.activeOutage) {
      out.push({
        id: 'anchor',
        coordinate: {
          latitude: state.activeOutage.anchor.latitude,
          longitude: state.activeOutage.anchor.longitude,
        },
        title: 'Last GNSS fix',
        description: 'Anchor for AI dead-reckoning estimate',
        color: c.trackGnss,
        hollow: true,
      });
    }
    return out;
  }, [route, state.activeOutage, c]);

  const legend = useMemo(() => {
    const l = [];
    if (route) l.push({ label: 'Route', color: '#1A73E8' });
    if (settings.showGnssTrack && state.gnssPath.length > 1)
      l.push({ label: 'GNSS track', color: c.trackGnss });
    if (settings.showDrTrack && state.drPath.length > 1)
      l.push({ label: 'AI Dead Reckoning', color: c.trackDr, dashed: true });
    return l;
  }, [route, settings.showGnssTrack, settings.showDrTrack, state.gnssPath.length, state.drPath.length, c]);

  const vehicleTone =
    state.mode === 'DEAD_RECKONING' ? c.ai : state.mode === 'DEGRADED' ? c.danger : '#1A73E8';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Full Screen Vector Map */}
      <MatrixMap
        ref={mapRef}
        tracks={tracks}
        markers={markers}
        mapType={settings.mapStyle}
        followVehicle={following}
        onPanDrag={() => setFollowing(false)}
        accuracyM={state.mode === 'GNSS' ? (state.gnss.fix?.accuracy ?? null) : null}
        vehicle={
          vehicle && state.mode !== 'DEGRADED'
            ? { coordinate: vehicle.coordinate, headingDeg: vehicle.headingDeg, tone: vehicleTone }
            : null
        }
      />

      {/* Floating Top Section: Google Maps Location Selection or Turn-by-Turn Guidance */}
      <View
        style={[styles.topOverlay, { paddingTop: insets.top + Spacing.sm }]}
        pointerEvents="box-none">
        {guidance && navigating ? (
          <View style={styles.guidanceWrap}>
            <GuidanceBanner
              guidance={guidance}
              mode={state.mode}
              offRoute={trip.offRoute}
              rerouting={trip.rerouting}
              units={settings.units}
              stale={state.mode === 'DEGRADED'}
              outageSeconds={outageSeconds ?? 0}
            />
          </View>
        ) : (
          <View style={styles.locationSelectorWrap}>
            <GoogleMapsLocationSelector
              here={state.position}
              units={settings.units}
              onRoutePlanned={onRoutePlanned}
              onClearRoute={onClearRoute}
              activeRoute={route}
              onStartNavigation={navigating ? undefined : onStart}
            />
          </View>
        )}

        {/* Floating Map Controls on Right side */}
        <View style={styles.floatingControls} pointerEvents="box-none">
          {legend.length > 0 ? <MapLegend entries={legend} /> : <View />}

          <Row gap={Spacing.sm}>
            {/* Map Style Toggle */}
            <IconButton
              label="Toggle Map Style"
              active={settings.mapStyle !== 'standard'}
              icon={<IconLayers size={20} color={settings.mapStyle !== 'standard' ? 'accent' : 'text'} />}
              onPress={() => {
                const i = MAP_TYPES.indexOf(settings.mapStyle);
                update('mapStyle', MAP_TYPES[(i + 1) % MAP_TYPES.length]);
              }}
            />

            {/* Recenter / Follow GPS Button */}
            <IconButton
              label={following ? 'Vehicle centered' : 'Center on vehicle'}
              active={following}
              icon={<IconCrosshair size={20} color={following ? 'accent' : 'text'} />}
              onPress={() => {
                setFollowing((v) => !v);
                if (state.position) mapRef.current?.center(state.position);
              }}
            />
          </Row>
        </View>

        {/* Outage notification alert if AI Dead Reckoning engaged without active route */}
        {!guidance && (state.mode === 'DEAD_RECKONING' || state.mode === 'DEGRADED') ? (
          <OutageBanner
            visible
            mode={state.mode}
            seconds={state.activeOutage?.durationS ?? 0}
            distanceM={state.activeOutage?.drDistanceM ?? 0}
            units={settings.units}
          />
        ) : null}
      </View>

      {/* Floating Bottom Section: GNSS Status Banner and Trip Summary */}
      <View
        style={[styles.bottomOverlay, { paddingBottom: insets.bottom + Spacing.sm }]}
        pointerEvents="box-none">
        {/* Trip summary strip during navigation */}
        {guidance && navigating ? (
          <View style={styles.tripSummaryWrap}>
            <TripSummaryBar
              guidance={guidance}
              units={settings.units}
              onEnd={onEndTrip}
              onOverview={() => {
                setFollowing(false);
                if (route) mapRef.current?.fitTo(route.geometry);
              }}
            />
          </View>
        ) : null}

        {/* Dedicated Bottom Banner: Status of GNSS */}
        <GnssStatusBanner
          mode={state.mode}
          gnssState={state.gnss.state}
          gnssReason={state.gnss.reason}
          accuracyM={state.gnss.fix?.accuracy ?? null}
          speedMps={state.speedMps}
          headingDeg={state.headingDeg}
          outageSeconds={outageSeconds}
          units={settings.units}
          isSimulatingOutage={engine.gnss.isSimulatingOutage}
          onToggleSimulateOutage={() => engine.simulateOutage(!engine.gnss.isSimulatingOutage)}
          hasRoute={!!route}
          isNavigating={navigating}
          onStartNavigation={onStart}
          onStopNavigation={onStop}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topOverlay: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    top: 0,
    gap: Spacing.xs,
  },
  guidanceWrap: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  locationSelectorWrap: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  floatingControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  bottomOverlay: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: 0,
    gap: Spacing.sm,
  },
  tripSummaryWrap: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
  },
});
