import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { formatDistance, formatDuration } from '@/services/format';
import {
  planRoute,
  reverseGeocode,
  RoutingError,
  searchPlaces,
} from '@/services/routing';
import type { Units } from '@/services/storage';
import { Radius, Spacing, useColors } from '@/theme';
import type { GeoPlace, LatLng, Route } from '@/types';
import {
  IconCar,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCrosshair,
  IconDirections,
  IconMapPin,
  IconNavigate,
  IconSearch,
  IconSwap,
  IconWalk,
} from './ui/icons';
import { Row, Txt } from './ui/primitives';

const SEARCH_DEBOUNCE_MS = 350;

export interface GoogleMapsLocationSelectorProps {
  here: LatLng | null;
  units: Units;
  onRoutePlanned: (route: Route) => void;
  onClearRoute?: () => void;
  activeRoute?: Route | null;
  onStartNavigation?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function GoogleMapsLocationSelector({
  here,
  units,
  onRoutePlanned,
  onClearRoute,
  activeRoute = null,
  onStartNavigation,
  collapsed = false,
  onToggleCollapse,
}: GoogleMapsLocationSelectorProps) {
  const c = useColors();

  const [origin, setOrigin] = useState<GeoPlace | null>(null);
  const [destination, setDestination] = useState<GeoPlace | null>(null);
  const [focusedField, setFocusedField] = useState<'origin' | 'destination'>('destination');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'drive' | 'walk'>('drive');
  const [isMinimized, setIsMinimized] = useState(collapsed || Boolean(activeRoute));

  const hereRef = useRef(here);
  hereRef.current = here;
  const inputRef = useRef<TextInput>(null);

  // Sync collapsed prop if passed from parent
  useEffect(() => {
    if (collapsed) {
      setIsMinimized(true);
    }
  }, [collapsed]);

  // Reverse geocode current position for the origin field
  useEffect(() => {
    if (!here || origin) return;
    let alive = true;
    void reverseGeocode(here).then((p) => {
      if (alive) setOrigin(p);
    });
    return () => {
      alive = false;
    };
  }, [here, origin]);

  // Debounced search when typing (search results only - no recents)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      void searchPlaces(q, hereRef.current)
        .then((found) => {
          if (!alive) return;
          setResults(found);
          setError(found.length ? null : `No places found for "${q}"`);
        })
        .catch((err: unknown) => {
          if (!alive) return;
          setResults([]);
          setError(err instanceof RoutingError ? err.message : 'Search failed');
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  // Calculate route when origin & destination are selected
  const plan = useCallback(
    async (start: GeoPlace, end: GeoPlace) => {
      setPlanning(true);
      setError(null);
      try {
        const route = await planRoute(start, end);
        onRoutePlanned(route);
        // Automatically minimize once location is entered and route is planned
        setIsMinimized(true);
      } catch (err) {
        setError(err instanceof RoutingError ? err.message : 'Could not find a route');
      } finally {
        setPlanning(false);
      }
    },
    [onRoutePlanned],
  );

  const selectPlace = useCallback(
    (place: GeoPlace) => {
      if (focusedField === 'origin') {
        setOrigin(place);
        setQuery('');
        setResults([]);
        if (destination) {
          void plan(place, destination);
        } else {
          setFocusedField('destination');
          inputRef.current?.focus();
        }
      } else {
        setDestination(place);
        setQuery('');
        setResults([]);
        if (origin) {
          void plan(origin, place);
        } else if (hereRef.current) {
          // If no origin yet, use current location
          void reverseGeocode(hereRef.current).then((orig) => {
            setOrigin(orig);
            void plan(orig, place);
          });
        }
      }
    },
    [focusedField, origin, destination, plan],
  );

  const useCurrentLocation = useCallback(() => {
    const p = hereRef.current;
    if (!p) {
      setError('Acquiring location... Please wait for GNSS signal.');
      return;
    }
    setError(null);
    void reverseGeocode(p).then((cur) => {
      setOrigin(cur);
      if (destination) {
        void plan(cur, destination);
      }
    });
  }, [destination, plan]);

  const swap = useCallback(() => {
    const prevOrigin = origin;
    const prevDest = destination;
    setOrigin(prevDest);
    setDestination(prevOrigin);
    if (prevDest && prevOrigin) {
      void plan(prevDest, prevOrigin);
    }
  }, [origin, destination, plan]);

  const clearAll = useCallback(() => {
    setDestination(null);
    setQuery('');
    setResults([]);
    setError(null);
    setIsMinimized(false);
    onClearRoute?.();
  }, [onClearRoute]);

  const hasEnteredLocation = Boolean(destination || (origin && origin.name !== 'Your location') || activeRoute);
  const suggestions = query.trim().length >= 2 ? results : [];

  // =========================================================================
  // MINIMIZED VIEW: Compact Google Maps style floating pill
  // =========================================================================
  if (isMinimized && hasEnteredLocation) {
    const title = destination?.name ?? activeRoute?.destination.name ?? origin?.name ?? 'Selected Location';
    return (
      <Pressable
        onPress={() => setIsMinimized(false)}
        style={[styles.minimizedCard, { backgroundColor: c.surface, borderColor: c.border }]}
        accessibilityLabel="Expand location selection"
        accessibilityRole="button">
        <Row justify="space-between" align="center" style={styles.minimizedContent}>
          {/* Left: Red Location Pin + Titles */}
          <Row gap={Spacing.sm} align="center" style={{ flex: 1, marginRight: Spacing.sm }}>
            <View style={[styles.minimizedPinWrap, { backgroundColor: '#EA433518' }]}>
              <IconMapPin size={18} tint="#EA4335" />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong" numberOfLines={1}>
                {title}
              </Txt>
              {activeRoute ? (
                <Row gap={6} align="center">
                  <Txt variant="caption" style={{ color: '#0F9D58', fontWeight: '700' }}>
                    {formatDuration(activeRoute.durationS)}
                  </Txt>
                  <Txt variant="caption" color="textSecondary">
                    • {formatDistance(activeRoute.distanceM, units)}
                  </Txt>
                </Row>
              ) : (
                <Txt variant="micro" color="textTertiary">
                  Tap to expand options
                </Txt>
              )}
            </View>
          </Row>

          {/* Right: Quick Start + Expand Chevron */}
          <Row gap={Spacing.xs} align="center">
            {activeRoute && onStartNavigation ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  onStartNavigation();
                }}
                style={styles.minimizedStartBtn}
                accessibilityLabel="Start navigation">
                <Row gap={4} align="center">
                  <IconNavigate size={14} tint="#FFFFFF" />
                  <Txt variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    Start
                  </Txt>
                </Row>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => setIsMinimized(false)}
              style={styles.expandIconBtn}
              accessibilityLabel="Expand route details">
              <Row gap={2} align="center">
                <Txt variant="micro" style={{ color: '#1A73E8', fontWeight: '600' }}>
                  Expand
                </Txt>
                <IconChevronDown size={18} tint="#1A73E8" />
              </Row>
            </Pressable>
          </Row>
        </Row>
      </Pressable>
    );
  }

  // =========================================================================
  // EXPANDED VIEW: Full Google Maps Location Selector with Minimize Option
  // =========================================================================
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {/* Top Header Bar with Minimize Option when location is entered */}
      {hasEnteredLocation ? (
        <Row justify="space-between" align="center" style={[styles.topBar, { borderBottomColor: c.border }]}>
          <Row gap={6} align="center">
            <IconDirections size={16} tint="#1A73E8" />
            <Txt variant="micro" style={{ color: c.textSecondary, fontWeight: '700', letterSpacing: 0.5 }}>
              LOCATION SELECTED
            </Txt>
          </Row>

          <Pressable
            onPress={() => setIsMinimized(true)}
            style={({ pressed }) => [
              styles.minimizeBtn,
              { backgroundColor: pressed ? c.surfaceRaised : '#1A73E815' },
            ]}
            accessibilityLabel="Minimise location selector"
            accessibilityRole="button">
            <Row gap={4} align="center">
              <IconChevronUp size={16} tint="#1A73E8" />
              <Txt variant="caption" style={{ color: '#1A73E8', fontWeight: '600' }}>
                Minimise
              </Txt>
            </Row>
          </Pressable>
        </Row>
      ) : null}

      {/* Search Header Container */}
      <View style={styles.header}>
        {/* Indicators Column (GPS dot, connecting dots, Map Pin) */}
        <View style={styles.indicatorCol}>
          <View style={styles.originDot} />
          <View style={[styles.dotLine, { borderColor: c.textTertiary }]} />
          <View style={styles.destPinWrap}>
            <IconMapPin size={18} tint="#EA4335" />
          </View>
        </View>

        {/* Inputs Column */}
        <View style={styles.inputsCol}>
          {/* Origin Row */}
          <Pressable
            onPress={() => {
              setFocusedField('origin');
              setQuery(origin ? origin.name : '');
            }}
            style={[
              styles.inputField,
              {
                backgroundColor: focusedField === 'origin' ? c.surfaceRaised : c.surfaceSunken,
                borderColor: focusedField === 'origin' ? '#1A73E8' : 'transparent',
              },
            ]}>
            {focusedField === 'origin' ? (
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Choose starting point"
                placeholderTextColor={c.textTertiary}
                style={[styles.textInput, { color: c.text }]}
                autoCapitalize="words"
                returnKeyType="search"
              />
            ) : (
              <Txt variant="body" numberOfLines={1} style={{ color: origin ? c.text : c.textSecondary }}>
                {origin ? origin.name : 'Your location'}
              </Txt>
            )}
          </Pressable>

          {/* Destination Row */}
          <Pressable
            onPress={() => {
              setFocusedField('destination');
              setQuery(destination ? destination.name : '');
            }}
            style={[
              styles.inputField,
              {
                backgroundColor: focusedField === 'destination' ? c.surfaceRaised : c.surfaceSunken,
                borderColor: focusedField === 'destination' ? '#1A73E8' : 'transparent',
              },
            ]}>
            {focusedField === 'destination' ? (
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search destination"
                placeholderTextColor={c.textTertiary}
                style={[styles.textInput, { color: c.text }]}
                autoFocus
                autoCapitalize="words"
                returnKeyType="search"
              />
            ) : (
              <Txt
                variant="body"
                numberOfLines={1}
                style={{
                  color: destination ? c.text : c.textSecondary,
                  fontWeight: destination ? '600' : '400',
                }}>
                {destination ? destination.name : 'Choose destination...'}
              </Txt>
            )}
          </Pressable>
        </View>

        {/* Right Action Icons (Swap & Clear) */}
        <View style={styles.actionCol}>
          <Pressable
            onPress={swap}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: pressed ? c.surfaceRaised : 'transparent' },
            ]}
            accessibilityLabel="Swap start and destination">
            <IconSwap size={18} tint={c.textSecondary} />
          </Pressable>

          {destination || activeRoute ? (
            <Pressable
              onPress={clearAll}
              style={({ pressed }) => [
                styles.iconBtn,
                { backgroundColor: pressed ? c.surfaceRaised : 'transparent' },
              ]}
              accessibilityLabel="Clear destination">
              <IconClose size={18} tint={c.textSecondary} />
            </Pressable>
          ) : (
            <View style={{ width: 32, height: 32 }} />
          )}
        </View>
      </View>

      {/* Mode Chips & Quick Actions Row */}
      <View style={styles.chipScroll}>
        <Row gap={Spacing.sm} align="center">
          {/* Drive Mode Pill */}
          <Pressable
            onPress={() => setMode('drive')}
            style={[
              styles.modePill,
              {
                backgroundColor: mode === 'drive' ? '#1A73E8' : c.surfaceRaised,
                borderColor: mode === 'drive' ? '#1A73E8' : c.border,
              },
            ]}>
            <Row gap={4} align="center">
              <IconCar size={16} tint={mode === 'drive' ? '#FFFFFF' : c.textSecondary} />
              <Txt variant="caption" style={{ color: mode === 'drive' ? '#FFFFFF' : c.textSecondary }}>
                Drive
              </Txt>
            </Row>
          </Pressable>

          {/* Walk Mode Pill */}
          <Pressable
            onPress={() => setMode('walk')}
            style={[
              styles.modePill,
              {
                backgroundColor: mode === 'walk' ? '#1A73E8' : c.surfaceRaised,
                borderColor: mode === 'walk' ? '#1A73E8' : c.border,
              },
            ]}>
            <Row gap={4} align="center">
              <IconWalk size={16} tint={mode === 'walk' ? '#FFFFFF' : c.textSecondary} />
              <Txt variant="caption" style={{ color: mode === 'walk' ? '#FFFFFF' : c.textSecondary }}>
                Walk
              </Txt>
            </Row>
          </Pressable>

          {/* Quick Use Current Location */}
          <Pressable
            onPress={useCurrentLocation}
            style={[styles.quickChip, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
            <Row gap={4} align="center">
              <IconCrosshair size={14} tint="#1A73E8" />
              <Txt variant="caption" style={{ color: '#1A73E8' }}>
                Current Location
              </Txt>
            </Row>
          </Pressable>
        </Row>
      </View>

      {/* Route Preview Strip if a route is ready */}
      {activeRoute ? (
        <View style={[styles.previewBar, { backgroundColor: `${c.accent}12`, borderColor: `${c.accent}33` }]}>
          <Row justify="space-between" align="center">
            <View>
              <Row gap={Spacing.sm} align="baseline">
                <Txt variant="heading" style={{ color: '#0F9D58', fontWeight: '700' }}>
                  {formatDuration(activeRoute.durationS)}
                </Txt>
                <Txt variant="caption" color="textSecondary">
                  ({formatDistance(activeRoute.distanceM, units)})
                </Txt>
              </Row>
              <Txt variant="micro" color="textTertiary">
                Fastest route • via {activeRoute.provider}
              </Txt>
            </View>

            <Row gap={Spacing.xs} align="center">
              <Pressable
                onPress={() => setIsMinimized(true)}
                style={[styles.previewMinBtn, { backgroundColor: c.surfaceRaised, borderColor: c.border }]}>
                <Row gap={2} align="center">
                  <IconChevronUp size={14} tint={c.textSecondary} />
                  <Txt variant="micro" color="textSecondary">
                    Minimise
                  </Txt>
                </Row>
              </Pressable>

              {onStartNavigation ? (
                <Pressable
                  onPress={onStartNavigation}
                  style={({ pressed }) => [
                    styles.startPill,
                    { backgroundColor: '#1A73E8', opacity: pressed ? 0.9 : 1 },
                  ]}>
                  <Row gap={4} align="center">
                    <IconNavigate size={16} tint="#FFFFFF" />
                    <Txt variant="bodyStrong" style={{ color: '#FFFFFF' }}>
                      Start
                    </Txt>
                  </Row>
                </Pressable>
              ) : null}
            </Row>
          </Row>
        </View>
      ) : null}

      {/* Loading & Error Status */}
      {planning ? (
        <Row gap={Spacing.sm} align="center" style={styles.statusRow}>
          <ActivityIndicator size="small" color="#1A73E8" />
          <Txt variant="caption" color="textSecondary">
            Calculating best route with dead reckoning anchor...
          </Txt>
        </Row>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Txt variant="caption" style={{ color: c.danger }}>
            {error}
          </Txt>
        </View>
      ) : null}

      {/* Place Suggestions Dropdown (Only shown when user types 2+ characters) */}
      {query.trim().length >= 2 && suggestions.length > 0 ? (
        <View style={[styles.dropdown, { borderTopColor: c.border }]}>
          <Row justify="space-between" align="center" style={styles.dropdownHeader}>
            <Txt variant="micro" color="textTertiary">
              SEARCH RESULTS
            </Txt>
            {searching ? <ActivityIndicator size="small" color="#1A73E8" /> : null}
          </Row>

          <ScrollView
            style={styles.resultsList}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled>
            {suggestions.slice(0, 5).map((place, idx) => (
              <Pressable
                key={`${place.id}-${idx}`}
                onPress={() => selectPlace(place)}
                style={({ pressed }) => [
                  styles.resultItem,
                  {
                    backgroundColor: pressed ? c.surfaceRaised : 'transparent',
                    borderBottomColor: idx === suggestions.length - 1 ? 'transparent' : c.border,
                  },
                ]}>
                <View style={[styles.resultIconWrap, { backgroundColor: c.surfaceRaised }]}>
                  <IconMapPin size={16} tint="#EA4335" />
                </View>

                <View style={styles.resultTextCol}>
                  <Txt variant="bodyStrong" numberOfLines={1}>
                    {place.name}
                  </Txt>
                  {place.address ? (
                    <Txt variant="caption" color="textSecondary" numberOfLines={1}>
                      {place.address}
                    </Txt>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  topBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  minimizeBtn: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  header: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    alignItems: 'center',
  },
  indicatorCol: {
    alignItems: 'center',
    width: 20,
    paddingVertical: 6,
  },
  originDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1A73E8',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dotLine: {
    width: 1,
    height: 24,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginVertical: 2,
  },
  destPinWrap: {
    marginTop: 2,
  },
  inputsCol: {
    flex: 1,
    gap: Spacing.xs,
  },
  inputField: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  textInput: {
    fontSize: 14,
    padding: 0,
    margin: 0,
  },
  actionCol: {
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 76,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipScroll: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  modePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  quickChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  previewBar: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    padding: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  previewMinBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  startPill: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
  },
  statusRow: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  errorBox: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  dropdown: {
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 220,
  },
  dropdownHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  resultsList: {
    maxHeight: 180,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultTextCol: {
    flex: 1,
  },
  // Minimized Floating Pill Styles
  minimizedCard: {
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  minimizedContent: {
    minHeight: 44,
  },
  minimizedPinWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizedStartBtn: {
    backgroundColor: '#1A73E8',
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
  },
  expandIconBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
});
