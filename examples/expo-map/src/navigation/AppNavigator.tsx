import React, { useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import RoutePlannerScreen from '../screens/RoutePlannerScreen';
import SaveAddressScreen from '../screens/SaveAddressScreen';

type Tab = 'route' | 'address';

export default function AppNavigator() {
  const [activeTab, setActiveTab] = useState<Tab>('route');

  return (
    <View style={styles.root}>
      {/* Screens */}
      <View style={styles.screen}>
        {activeTab === 'route' ? <RoutePlannerScreen /> : <SaveAddressScreen />}
      </View>

      {/* Bottom Tab Bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'route', icon: '🗺️', label: 'Route Planner' },
          { key: 'address', icon: '📍', label: 'Save Address' },
        ] as { key: Tab; icon: string; label: string }[]).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0c10' },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 22, 36, 0.95)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingBottom: 8,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: '#6366f1',
  },
  tabIcon: { fontSize: 20 },
  tabLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '600' },
  tabLabelActive: { color: '#818cf8' },
});
