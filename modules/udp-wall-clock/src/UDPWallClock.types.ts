export type UDPWallClockModuleEvents = {
  onMessage: (params: UDPMessageEvent) => void;
};

export type UDPMessageEvent = {
  socketId: number;
  data: string; // Hex string
  address: string;
  port: number;
};

export type SocketInfo = {
  localPort: number;
  localAddress: string;
  isBound: boolean;
  isClosed: boolean;
};
