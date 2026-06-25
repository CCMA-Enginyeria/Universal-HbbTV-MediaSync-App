import { NativeModule, requireNativeModule } from "expo";

import { ForegroundSyncModuleEvents } from "./ForegroundSync.types";

declare class ForegroundSyncModule extends NativeModule<ForegroundSyncModuleEvents> {
  /**
   * Start (or update) the foreground service that keeps the process alive while
   * the companion stays synchronized with the TV. Shows a non-dismissible
   * notification WITHOUT media controls (all control happens on the TV).
   *
   * Must be called while the app is in the foreground (Android restriction).
   */
  start(title?: string, text?: string): boolean;

  /**
   * Stop the foreground service and remove its notification.
   */
  stop(): boolean;
}

export default requireNativeModule<ForegroundSyncModule>("ForegroundSync");
