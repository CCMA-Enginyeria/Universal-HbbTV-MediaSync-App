export type CustomTabsMessagingModuleEvents = {
  onChannelReady: () => void;
  onChannelError: (event: { message: string }) => void;
  onMessage: (event: { message: string }) => void;
  onPageLoaded: () => void;
  onTabHidden: () => void;
};