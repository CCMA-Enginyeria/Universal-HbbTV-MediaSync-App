export type CustomTabsMessagingModuleEvents = {
  onChannelReady: () => void;
  onChannelError: (event: { message: string }) => void;
  onMessage: (event: { message: string }) => void;
  onPageLoaded: () => void;
  onTabHidden: () => void;
};

/**
 * Outcome of a Custom Tab launch. `opened` is false whenever the tab could not be
 * used (no provider, insecure origin, failed Digital Asset Links validation…), in
 * which case the caller should fall back to the in-app WebView.
 */
export type CustomTabsOpenResult = {
  opened: boolean;
  reason?: string;
};