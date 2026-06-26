export type ForegroundSyncModuleEvents = {
  /**
   * Periodic native heartbeat emitted while the foreground service is running.
   * Used to wake the JS thread in the background (where React Native pauses
   * setTimeout) so reconnection logic can run.
   */
  onHeartbeat: (params: { timestamp: number }) => void;
};
