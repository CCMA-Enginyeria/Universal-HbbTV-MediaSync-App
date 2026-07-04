export type ForegroundSyncModuleEvents = {
  /**
   * Periodic native heartbeat emitted while the foreground service is running.
   * Used to wake the JS thread in the background (where React Native pauses
   * setTimeout) so reconnection logic can run.
   */
  onHeartbeat: (params: { timestamp: number }) => void;
  /**
   * Emitted when the user taps the "stop" action on the foreground-service
   * notification. The React layer should tear down the player and the
   * DVB-CSS synchronization in response.
   */
  onStopRequested: () => void;
};
