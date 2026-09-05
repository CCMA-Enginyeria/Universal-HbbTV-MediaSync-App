import { NativeModule, requireNativeModule } from 'expo';

import {
  CustomTabsMessagingModuleEvents,
  CustomTabsOpenResult,
} from './CustomTabsMessaging.types';

declare class CustomTabsMessagingModule extends NativeModule<CustomTabsMessagingModuleEvents> {
  open(url: string, origin: string): Promise<CustomTabsOpenResult>;
  postMessage(message: string): number;
  close(): void;
}

export default requireNativeModule<CustomTabsMessagingModule>('CustomTabsMessaging');