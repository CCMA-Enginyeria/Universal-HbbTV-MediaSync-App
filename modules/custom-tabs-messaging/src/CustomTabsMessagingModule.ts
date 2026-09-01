import { NativeModule, requireNativeModule } from 'expo';

import { CustomTabsMessagingModuleEvents } from './CustomTabsMessaging.types';

declare class CustomTabsMessagingModule extends NativeModule<CustomTabsMessagingModuleEvents> {
  open(url: string, origin: string): Promise<boolean>;
  postMessage(message: string): number;
  close(): void;
}

export default requireNativeModule<CustomTabsMessagingModule>('CustomTabsMessaging');