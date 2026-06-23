export type UDPMulticastModuleEvents = {
  onMessage: (params: UDPMessageEvent) => void;
  onError: (params: UDPErrorEvent) => void;
  onBound: (params: UDPBoundEvent) => void;
};

export type UDPMessageEvent = {
  socketId: string;
  data: string; // Base64-encoded payload
  address: string;
  port: number;
  size: number;
};

export type UDPErrorEvent = {
  socketId: string;
  error: string;
};

export type UDPBoundEvent = {
  socketId: string;
  port: number;
  address: string;
};
