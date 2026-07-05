import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function EmptyState() {
  const colors = useColors();
  return (
    <View style={styles.container}>
      <View style={[styles.iconRing, { borderColor: colors.border }]}>
        <Feather name="film" size={36} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>Your locker is empty</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Paste a social caption above and tap{'\n'}Extract to find movies to lock in.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  iconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 21,
  },
});
