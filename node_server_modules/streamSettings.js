// streamSettings.js
export const streamSettings = {
  frameInterval: 16,
  maxQueueSize: 2,
  lastFrameSent: new Map(),
  frameQueue: new Map(),
  latestFrames: new Map(),
  frameCounter: new Map(),
  lastLogTime: new Map()
};
