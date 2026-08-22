import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';

LogBox.ignoreLogs([
  'Native module of @maplibre/maplibre-react-native',
  'SafeAreaView has been deprecated',
]);

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0a0c10" />
      <AppNavigator />
    </SafeAreaProvider>
  );
}
