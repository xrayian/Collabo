/**
 * server/sfu.ts
 * Mediasoup SFU manager for Workers, Routers, Transports, Producers, and Consumers.
 */
import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import { config } from './config';

interface PeerSFUState {
  peerId: string;
  meetingId: string;
  sendTransport?: types.WebRtcTransport;
  recvTransport?: types.WebRtcTransport;
  producers: Map<string, types.Producer>; // producerId -> Producer
  consumers: Map<string, types.Consumer>; // consumerId -> Consumer
}

export class SFUManager {
  private workers: types.Worker[] = [];
  private nextWorkerIdx = 0;
  private routers = new Map<string, types.Router>(); // meetingId -> Router
  private peerStates = new Map<string, PeerSFUState>(); // peerId -> PeerSFUState

  /**
   * Initialize mediasoup worker pool.
   */
  public async init(): Promise<void> {
    const numWorkers = config.mediasoup.numWorkers || 1;
    console.log(`[SFU] Spawning ${numWorkers} mediasoup worker(s)...`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker(config.mediasoup.workerSettings);

      worker.on('died', () => {
        console.error(`[SFU] mediasoup Worker ${worker.pid} died! Exiting in 2 seconds...`);
        setTimeout(() => process.exit(1), 2000);
      });

      this.workers.push(worker);
    }
    console.log(`[SFU] Initialized ${this.workers.length} mediasoup worker(s).`);
  }

  /**
   * Get next worker using round-robin.
   */
  private getWorker(): types.Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  /**
   * Get or create a Router for the specified meeting room.
   */
  public async getOrCreateRouter(meetingId: string): Promise<types.Router> {
    let router = this.routers.get(meetingId);
    if (!router) {
      const worker = this.getWorker();
      router = await worker.createRouter({
        mediaCodecs: config.mediasoup.routerMediaCodecs,
      });
      this.routers.set(meetingId, router);
      console.log(`[SFU] Created Router for meeting ${meetingId}`);
    }
    return router;
  }

  /**
   * Get Router RTP Capabilities for client device initialization.
   */
  public async getRouterRtpCapabilities(meetingId: string): Promise<types.RtpCapabilities> {
    const router = await this.getOrCreateRouter(meetingId);
    return router.rtpCapabilities;
  }

  /**
   * Get or create SFU state container for a peer.
   */
  private getOrCreatePeerState(peerId: string, meetingId: string): PeerSFUState {
    let state = this.peerStates.get(peerId);
    if (!state) {
      state = {
        peerId,
        meetingId,
        producers: new Map(),
        consumers: new Map(),
      };
      this.peerStates.set(peerId, state);
    }
    return state;
  }

  /**
   * Create a WebRtcTransport for sending or receiving media.
   */
  public async createWebRtcTransport(
    meetingId: string,
    peerId: string,
    direction: 'send' | 'recv'
  ): Promise<{
    id: string;
    iceParameters: any;
    iceCandidates: any;
    dtlsParameters: any;
    sctpParameters?: any;
  }> {
    const router = await this.getOrCreateRouter(meetingId);
    const peerState = this.getOrCreatePeerState(peerId, meetingId);

    const transport = await router.createWebRtcTransport({
      ...config.mediasoup.webRtcTransport,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      appData: { peerId, direction, meetingId },
    });

    if (direction === 'send') {
      peerState.sendTransport?.close();
      peerState.sendTransport = transport;
    } else {
      peerState.recvTransport?.close();
      peerState.recvTransport = transport;
    }

    transport.on('dtlsstatechange', (dtlsState: types.DtlsState) => {
      if (dtlsState === 'closed') {
        transport.close();
      }
    });

    transport.on('@close', () => {
      console.log(`[SFU] ${direction} transport closed for peer ${peerId}`);
    });

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters,
    };
  }

  /**
   * Connect a previously created WebRtcTransport with DTLS parameters.
   */
  public async connectWebRtcTransport(
    peerId: string,
    transportId: string,
    dtlsParameters: types.DtlsParameters
  ): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    if (!peerState) throw new Error(`Peer state not found for ${peerId}`);

    let transport: types.WebRtcTransport | undefined;
    if (peerState.sendTransport?.id === transportId) {
      transport = peerState.sendTransport;
    } else if (peerState.recvTransport?.id === transportId) {
      transport = peerState.recvTransport;
    }

    if (!transport) {
      throw new Error(`Transport ${transportId} not found for peer ${peerId}`);
    }

    await transport.connect({ dtlsParameters });
  }

  /**
   * Produce media on the peer's send transport.
   */
  public async produce(
    peerId: string,
    transportId: string,
    kind: types.MediaKind,
    rtpParameters: types.RtpParameters,
    appData: any = {}
  ): Promise<types.Producer> {
    const peerState = this.peerStates.get(peerId);
    if (!peerState || !peerState.sendTransport || peerState.sendTransport.id !== transportId) {
      throw new Error(`Valid send transport not found for peer ${peerId}`);
    }

    const producer = await peerState.sendTransport.produce({
      kind,
      rtpParameters,
      appData: { ...appData, peerId, kind },
    });

    peerState.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      producer.close();
      peerState.producers.delete(producer.id);
    });

    return producer;
  }

  /**
   * Consume media produced by another peer.
   */
  public async consume(
    meetingId: string,
    consumerPeerId: string,
    producerId: string,
    rtpCapabilities: types.RtpCapabilities
  ): Promise<{
    consumer: types.Consumer;
    params: {
      consumerId: string;
      producerId: string;
      kind: types.MediaKind;
      rtpParameters: types.RtpParameters;
      peerId: string;
      appData: any;
    };
  }> {
    const router = await this.getOrCreateRouter(meetingId);
    const peerState = this.getOrCreatePeerState(consumerPeerId, meetingId);

    if (!peerState.recvTransport) {
      throw new Error(`Receive transport not initialized for peer ${consumerPeerId}`);
    }

    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Cannot consume producer ${producerId} with provided RTP capabilities`);
    }

    const producer = this.findProducerById(producerId);
    const producerPeerId = (producer?.appData?.peerId as string) || '';

    const consumer = await peerState.recvTransport.consume({
      producerId,
      rtpCapabilities,
      paused: false, // Start unpaused
      appData: { consumerPeerId, producerId, producerPeerId },
    });

    peerState.consumers.set(consumer.id, consumer);

    // If video stream, immediately request keyframe from producer so late-joining consumer decodes immediately
    if (consumer.kind === 'video') {
      consumer.requestKeyFrame().catch((err) => {
        console.warn(`[SFU] Keyframe request note for consumer ${consumer.id}:`, err?.message);
      });
      // Secondary keyframe request after 300ms for network jitter safety
      setTimeout(() => {
        if (!consumer.closed) {
          consumer.requestKeyFrame().catch(() => {});
        }
      }, 300);
    }

    consumer.on('transportclose', () => {
      consumer.close();
      peerState.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      consumer.close();
      peerState.consumers.delete(consumer.id);
    });

    return {
      consumer,
      params: {
        consumerId: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        peerId: producerPeerId,
        appData: producer?.appData,
      },
    };
  }

  /**
   * Resume a consumer and trigger keyframe if video.
   */
  public async resumeConsumer(peerId: string, consumerId: string): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    const consumer = peerState?.consumers.get(consumerId);
    if (consumer) {
      await consumer.resume();
      if (consumer.kind === 'video') {
        consumer.requestKeyFrame().catch(() => {});
      }
    }
  }

  /**
   * Pause a producer (e.g. mic mute).
   */
  public async pauseProducer(peerId: string, producerId: string): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    const producer = peerState?.producers.get(producerId);
    if (producer) {
      await producer.pause();
    }
  }

  /**
   * Resume a producer (e.g. mic unmute).
   */
  public async resumeProducer(peerId: string, producerId: string): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    const producer = peerState?.producers.get(producerId);
    if (producer) {
      await producer.resume();
    }
  }

  /**
   * Close a producer (e.g. stop screen share).
   */
  public async closeProducer(peerId: string, producerId: string): Promise<void> {
    const peerState = this.peerStates.get(peerId);
    const producer = peerState?.producers.get(producerId);
    if (producer) {
      producer.close();
      peerState?.producers.delete(producerId);
    }
  }

  /**
   * Get all active producers in a meeting room, except those produced by `excludePeerId`.
   */
  public getRoomProducers(
    meetingId: string,
    excludePeerId?: string
  ): Array<{ producerId: string; peerId: string; kind: types.MediaKind }> {
    const results: Array<{ producerId: string; peerId: string; kind: types.MediaKind }> = [];

    for (const [peerId, state] of this.peerStates.entries()) {
      if (state.meetingId !== meetingId) continue;
      if (excludePeerId && peerId === excludePeerId) continue;

      for (const [producerId, producer] of state.producers.entries()) {
        if (!producer.closed) {
          results.push({
            producerId,
            peerId,
            kind: producer.kind,
          });
        }
      }
    }

    return results;
  }

  /**
   * Helper to find a producer across all peer states.
   */
  public findProducerById(producerId: string): types.Producer | undefined {
    for (const state of this.peerStates.values()) {
      const producer = state.producers.get(producerId);
      if (producer) return producer;
    }
    return undefined;
  }

  /**
   * Helper to find active video producer for a given peer.
   */
  public findVideoProducerByPeer(peerId: string): types.Producer | undefined {
    const state = this.peerStates.get(peerId);
    if (!state) return undefined;
    for (const producer of state.producers.values()) {
      if (producer.kind === 'video' && !producer.closed) {
        return producer;
      }
    }
    return undefined;
  }

  /**
   * Clean up all SFU resources for a disconnecting peer.
   */
  public cleanPeer(peerId: string): { closedProducers: Array<{ producerId: string; kind: types.MediaKind }> } {
    const state = this.peerStates.get(peerId);
    const closedProducers: Array<{ producerId: string; kind: types.MediaKind }> = [];

    if (!state) return { closedProducers };

    for (const [producerId, producer] of state.producers.entries()) {
      closedProducers.push({ producerId, kind: producer.kind });
      producer.close();
    }
    state.producers.clear();

    for (const consumer of state.consumers.values()) {
      consumer.close();
    }
    state.consumers.clear();

    state.sendTransport?.close();
    state.recvTransport?.close();

    this.peerStates.delete(peerId);
    return { closedProducers };
  }

  /**
   * Clean up and close a meeting room router.
   */
  public closeRoomRouter(meetingId: string): void {
    const router = this.routers.get(meetingId);
    if (router) {
      router.close();
      this.routers.delete(meetingId);
      console.log(`[SFU] Closed Router for meeting ${meetingId}`);
    }
  }
}

const globalForSfu = globalThis as unknown as {
  collaboSfuManager: SFUManager | undefined;
};

export const sfuManager = globalForSfu.collaboSfuManager ?? new SFUManager();

globalForSfu.collaboSfuManager = sfuManager;
