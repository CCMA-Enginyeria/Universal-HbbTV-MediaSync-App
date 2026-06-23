import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import './src/i18n';
import theme from './src/theme';

import DiscoveryScreen from './src/screens/DiscoveryScreen';
import HelpScreen from './src/screens/HelpScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.surfaceContainer,
        },
        headerTintColor: theme.colors.onSurface,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
      }}
    >
      <Stack.Screen
        name="Discovery"
        component={DiscoveryScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

function TabIcon({ focused, name }) {
  const color = focused ? theme.colors.primary : theme.colors.onSurfaceVariant;
  return <MaterialIcons name={name} size={24} color={color} />;
}

function TabLabel({ focused, label }) {
  const color = focused ? theme.colors.primary : theme.colors.onSurfaceVariant;
  return (
    <Text
      style={{
        fontSize: 12,
        color,
        marginTop: 2,
        fontWeight: focused ? '600' : '400',
      }}
    >
      {label}
    </Text>
  );
}

export default function App() {
  const { t } = useTranslation();
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.colors.surfaceContainer,
            borderTopColor: theme.colors.outlineVariant,
            borderTopWidth: 1,
            height: 80,
            paddingBottom: 12,
            paddingTop: 8,
          },
          tabBarShowLabel: true,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeStack}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="home" />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused} label={t('nav.home')} />,
          }}
        />
        <Tab.Screen
          name="Help"
          component={HelpScreen}
          options={{
            tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="help" />,
            tabBarLabel: ({ focused }) => <TabLabel focused={focused} label={t('nav.help')} />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
