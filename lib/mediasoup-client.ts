/**
 * lib/mediasoup-client.ts
 * Mediasoup client-side controller managing Device, WebRtcTransports, Audio Producer/Consumers,
 * and Screen-Share Producer/Consumers.
 */
import type { Device, types } from 'mediasoup-client';

export interface MediasoupCallbacks {
  onScreenStream?: (stream: MediaStream | null) => void;
  onAudioTrack?: (peerId: string, stream: MediaStream) => void;
  onAudioTrackRemoved?: (peerId: string) => void;
  onScreenShareStopped?: () => void;
  onError?: (err: Error) => void;
}

export class MediasoupClientManager {
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;

  private audioProducer: types.Producer | null = null;
  private screenProducer: types.Producer | null = null;
  private localScreenStream: MediaStream | null = null;

  // Track consumers by producerId and consumerId
  private consumers = new Map<string, types.Consumer>(); // consumerId -> Consumer
  private producerToConsumerMap = new Map<string, string>(); // producerId -> consumerId
  private peerAudioStreams = new Map<string, MediaStream>(); // peerId -> MediaStream

  private callbacks: MediasoupCallbacks = {};
  private sendWsMessage: (msg: any) => void;

  constructor(sendWsMessage: (msg: any) => void, callbacks: MediasoupCallbacks = {}) {
    this.sendWsMessage = sendWsMessage;
    this.callbacks = callbacks;
  }

  public setCallbacks(callbacks: Partial<MediasoupCallbacks>) {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Initialize mediasoup Device using server Router capabilities.
   */
  public async initDevice(routerRtpCapabilities: types.RtpCapabilities): Promise<void> {
    try {
      const msClient = await import('mediasoup-client');
      this.device = new msClient.Device();
      await this.device.load({ routerRtpCapabilities });
      console.log('[SFU Client] Device initialized successfully.');
    } catch (err: any) {
      console.error('[SFU Client] Failed to load mediasoup Device:', err);
      throw err;
    }
  }

  public get rtpCapabilities(): types.RtpCapabilities | undefined {
    return this.device?.rtpCapabilities;
  }

  public get isLoaded(): boolean {
    return !!this.device?.loaded;
  }

  /**
   * Set up Send Transport from server-provided parameters.
   */
  public setupSendTransport(params: {
    id: string;
    iceParameters: types.IceParameters;
    iceCandidates: types.IceCandidate[];
    dtlsParameters: types.DtlsParameters;
    sctpParameters?: types.SctpParameters;
  }): types.Transport {
    if (!this.device) throw new Error('Device not initialized');

    this.sendTransport = this.device.createSendTransport(params);

    this.sendTransport.on('connect', async ({ dtlsParameters }: { dtlsParameters: types.DtlsParameters }, callback: () => void, errback: (err: any) => void) => {
      try {
        this.sendWsMessage({
          type: 'connect-transport',
          transportId: this.sendTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (err: any) {
        errback(err);
      }
    });

    this.sendTransport.on('produce', async ({ kind, rtpParameters, appData }: { kind: types.MediaKind; rtpParameters: types.RtpParameters; appData: any }, callback: (params: { id: string }) => void, errback: (err: any) => void) => {
      try {
        // We will receive produced ack with producerId via WebSocket
        this.sendWsMessage({
          type: 'produce',
          transportId: this.sendTransport!.id,
          kind,
          rtpParameters,
          appData,
        });

        // Handler will be resolved when server responds with produced
        const handleProduced = (event: Event) => {
          const customEvent = event as CustomEvent<{ producerId: string; kind: string }>;
          if (customEvent.detail.kind === kind) {
            window.removeEventListener('collabo:produced', handleProduced);
            callback({ id: customEvent.detail.producerId });
          }
        };
        window.addEventListener('collabo:produced', handleProduced);
      } catch (err: any) {
        errback(err);
      }
    });

    return this.sendTransport;
  }

  private pendingProducerConsumes = new Set<string>();

  /**
   * Set up Receive Transport from server-provided parameters.
   */
  public setupRecvTransport(params: {
    id: string;
    iceParameters: types.IceParameters;
    iceCandidates: types.IceCandidate[];
    dtlsParameters: types.DtlsParameters;
    sctpParameters?: types.SctpParameters;
  }): types.Transport {
    if (!this.device) throw new Error('Device not initialized');

    this.recvTransport = this.device.createRecvTransport(params);

    this.recvTransport.on('connect', async ({ dtlsParameters }: { dtlsParameters: types.DtlsParameters }, callback: () => void, errback: (err: any) => void) => {
      try {
        this.sendWsMessage({
          type: 'connect-transport',
          transportId: this.recvTransport!.id,
          dtlsParameters,
        });
        callback();
      } catch (err: any) {
        errback(err);
      }
    });

    // Automatically drain and request consume for any producers that arrived before recvTransport was ready
    if (this.pendingProducerConsumes.size > 0) {
      console.log('[SFU Client] Draining pending consumes:', Array.from(this.pendingProducerConsumes));
      for (const producerId of this.pendingProducerConsumes) {
        this.sendWsMessage({
          type: 'consume',
          producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        });
      }
      this.pendingProducerConsumes.clear();
    }

    return this.recvTransport;
  }

  /**
   * Start local microphone audio stream and produce to SFU.
   */
  public async startAudio(): Promise<types.Producer> {
    if (!this.sendTransport) throw new Error('Send transport not initialized');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const track = stream.getAudioTracks()[0];
    this.audioProducer = await this.sendTransport.produce({
      track,
      codecOptions: {
        opusStereo: true,
        opusDtx: true,
      },
      appData: { kind: 'audio' },
    });

    return this.audioProducer;
  }

  /**
   * Mute or unmute microphone.
   */
  public async setAudioMuted(muted: boolean): Promise<void> {
    if (!this.audioProducer) return;

    if (muted) {
      await this.audioProducer.pause();
      this.sendWsMessage({
        type: 'pause-producer',
        producerId: this.audioProducer.id,
      });
    } else {
      await this.audioProducer.resume();
      this.sendWsMessage({
        type: 'resume-producer',
        producerId: this.audioProducer.id,
      });
    }
  }

  /**
   * Start screen sharing (host only) and produce video to SFU.
   */
  public async startScreenShare(): Promise<MediaStream> {
    if (!this.sendTransport) throw new Error('Send transport not initialized');

    // Prompt user for display media
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
        frameRate: { max: 15 },
        width: { max: 1920 },
        height: { max: 1080 },
      },
      audio: false,
    });

    this.localScreenStream = stream;
    const videoTrack = stream.getVideoTracks()[0];

    // Listen for user clicking the browser's "Stop sharing" bar
    videoTrack.onended = () => {
      this.stopScreenShare();
      if (this.callbacks.onScreenShareStopped) {
        this.callbacks.onScreenShareStopped();
      }
    };

    this.screenProducer = await this.sendTransport.produce({
      track: videoTrack,
      encodings: [
        {
          maxBitrate: 1500000,
        },
      ],
      appData: { kind: 'video' },
    });

    // Provide local preview to callback
    if (this.callbacks.onScreenStream) {
      this.callbacks.onScreenStream(stream);
    }

    return stream;
  }

  /**
   * Start screen sharing from an existing MediaStream (e.g. Electron desktopCapturer).
   */
  public async startScreenShareFromStream(stream: MediaStream): Promise<MediaStream> {
    if (!this.sendTransport) throw new Error('Send transport not initialized');

    this.localScreenStream = stream;
    const videoTrack = stream.getVideoTracks()[0];

    videoTrack.onended = () => {
      this.stopScreenShare();
      if (this.callbacks.onScreenShareStopped) {
        this.callbacks.onScreenShareStopped();
      }
    };

    this.screenProducer = await this.sendTransport.produce({
      track: videoTrack,
      encodings: [
        {
          maxBitrate: 2500000,
        },
      ],
      appData: { kind: 'video' },
    });

    if (this.callbacks.onScreenStream) {
      this.callbacks.onScreenStream(stream);
    }

    return stream;
  }

  /**
   * Stop screen sharing and close producer.
   */
  public async stopScreenShare(): Promise<void> {
    if (this.screenProducer) {
      const producerId = this.screenProducer.id;
      this.screenProducer.close();
      this.screenProducer = null;

      this.sendWsMessage({
        type: 'close-producer',
        producerId,
      });
    }

    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }

    if (this.callbacks.onScreenStream) {
      this.callbacks.onScreenStream(null);
    }
  }

  /**
   * Request to consume a producer from the room.
   */
  public requestConsume(producerId: string): void {
    if (!this.device || !this.recvTransport) {
      console.log('[SFU Client] Queueing consume until recvTransport is ready:', producerId);
      this.pendingProducerConsumes.add(producerId);
      return;
    }
    this.sendWsMessage({
      type: 'consume',
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
  }

  /**
   * Handle 'consumed' server message and create Consumer.
   */
  public async handleConsumed(params: {
    consumerId: string;
    producerId: string;
    kind: types.MediaKind;
    rtpParameters: types.RtpParameters;
    peerId: string;
    appData?: any;
  }): Promise<void> {
    if (!this.recvTransport) {
      console.warn('[SFU Client] Receive transport not ready yet.');
      return;
    }

    try {
      const consumer = await this.recvTransport.consume({
        id: params.consumerId,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
        appData: { ...params.appData, peerId: params.peerId },
      });

      this.consumers.set(consumer.id, consumer);
      this.producerToConsumerMap.set(params.producerId, consumer.id);

      // Tell server to resume consumer
      this.sendWsMessage({
        type: 'resume-consumer',
        consumerId: consumer.id,
      });

      if (params.kind === 'audio') {
        const stream = new MediaStream([consumer.track]);
        this.peerAudioStreams.set(params.peerId, stream);
        if (this.callbacks.onAudioTrack) {
          this.callbacks.onAudioTrack(params.peerId, stream);
        }
      } else if (params.kind === 'video') {
        const stream = new MediaStream([consumer.track]);
        if (this.callbacks.onScreenStream) {
          this.callbacks.onScreenStream(stream);
        }
      }
    } catch (err: any) {
      console.error('[SFU Client] Failed to handle consume:', err);
    }
  }

  /**
   * Handle producer closed by remote peer.
   */
  public handleProducerClosed(producerId: string, peerId: string, kind: types.MediaKind): void {
    const consumerId = this.producerToConsumerMap.get(producerId);
    if (consumerId) {
      const consumer = this.consumers.get(consumerId);
      if (consumer) {
        consumer.close();
        this.consumers.delete(consumerId);
      }
      this.producerToConsumerMap.delete(producerId);
    }

    if (kind === 'audio') {
      this.peerAudioStreams.delete(peerId);
      if (this.callbacks.onAudioTrackRemoved) {
        this.callbacks.onAudioTrackRemoved(peerId);
      }
    } else if (kind === 'video') {
      if (this.callbacks.onScreenStream) {
        this.callbacks.onScreenStream(null);
      }
    }
  }

  /**
   * Close all transports, producers, and consumers.
   */
  public close(): void {
    this.stopScreenShare().catch(() => {});

    if (this.audioProducer) {
      this.audioProducer.close();
      this.audioProducer = null;
    }

    for (const consumer of this.consumers.values()) {
      consumer.close();
    }
    this.consumers.clear();
    this.producerToConsumerMap.clear();
    this.peerAudioStreams.clear();

    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }

    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }
  }
}
