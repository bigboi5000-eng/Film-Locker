/**
 * ToastProvider — lightweight in-app toast system.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast({ title: 'Added to Watchlist', subtitle: 'Interstellar · Inception' });
 *
 * Render <ToastProvider> near the root of the tree (inside SafeAreaProvider).
 * Toasts slide down from the top and auto-dismiss after 3.5 s.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  title: string;
  subtitle?: string;
  variant?: ToastVariant;
  /** Duration in ms before auto-dismiss. Default 3500. */
  duration?: number;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
}

// ── Context ────────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Internal toast item ────────────────────────────────────────────────────────

interface ActiveToast extends ToastOptions {
  id: number;
}

const ICON: Record<ToastVariant, string> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

const ACCENT: Record<ToastVariant, string> = {
  success: '#16A34A',
  error: '#DC2626',
  info: '#0066FF',
};

function ToastItem({
  toast,
  topOffset,
  onDismiss,
}: {
  toast: ActiveToast;
  topOffset: number;
  onDismiss: (id: number) => void;
}) {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const variant = toast.variant ?? 'success';
  const accent = ACCENT[variant];
  const icon = ICON[variant] as keyof typeof Ionicons.glyphMap;

  React.useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 200,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-dismiss
    const timer = setTimeout(() => dismiss(), toast.duration ?? 3500);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onDismiss(toast.id));
  }

  return (
    <Animated.View
      style={[
        styles.toastCard,
        {
          top: topOffset,
          transform: [{ translateY }],
          opacity,
          borderLeftColor: accent,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.toastInner}
        onPress={dismiss}
        activeOpacity={0.9}
      >
        <Ionicons name={icon} size={22} color={accent} style={styles.toastIcon} />
        <View style={styles.toastText}>
          <Text style={styles.toastTitle} numberOfLines={1}>
            {toast.title}
          </Text>
          {toast.subtitle ? (
            <Text style={styles.toastSubtitle} numberOfLines={2}>
              {toast.subtitle}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback((opts: ToastOptions) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  const handleDismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toasts float above everything — rendered outside any scroll view */}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            topOffset={insets.top + 12 + index * 80}
            onDismiss={handleDismiss}
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  toastCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 10,
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toastIcon: {
    marginRight: 12,
    flexShrink: 0,
  },
  toastText: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#111827',
    lineHeight: 19,
  },
  toastSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 17,
  },
});
