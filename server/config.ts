/**
 * server/config.ts
 * Mediasoup SFU and Server Configuration
 */
import type { types } from 'mediasoup';
import os from 'os';

export const config = {
  // HTTP / WS Server
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },

  // mediasoup settings
  mediasoup: {
    // Number of mediasoup workers
    numWorkers: Object.keys(os.cpus()).length,
    
    // Worker settings
    workerSettings: {
      logLevel: (process.env.MEDIASOUP_LOG_LEVEL || 'warn') as types.WorkerLogLevel,
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
      ] as types.WorkerLogTag[],
      rtcMinPort: parseInt(process.env.MEDIASOUP_MIN_PORT || '40000', 10),
      rtcMaxPort: parseInt(process.env.MEDIASOUP_MAX_PORT || '49999', 10),
    },

    // Router media codecs (Opus for high quality audio, VP8/H264 for screen share)
    routerMediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
        },
      },
    ] as types.RouterRtpCodecCapability[],

    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000, // 1 Mbps
      maxSctpMessageSize: 262144,
    },
  },
};
