/**
 * sttStream.ts — WebSocket proxy for Sarvam AI Streaming STT
 *
 * Verified API spec (docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe/ws):
 *   Endpoint : wss://api.sarvam.ai/speech-to-text/ws
 *   Auth     : header "Api-Subscription-Key: <key>"  (NOT a query param)
 *   Audio    : base64-encoded inside JSON { "data": "<base64>" }
 *   Params   : language-code, model, mode, sample_rate, input_audio_codec,
 *              vad_signals, high_vad_sensitivity, flush_signal
 *
 * Server message types:
 *   { type: "data",   data: { transcript, language_code, ... } }  — transcription result
 *   { type: "events", data: { signal_type: "START_SPEECH"|"END_SPEECH", occured_at } }
 *   { type: "error",  data: { error, code } }
 *
 * Protocol notes:
 *   - Each "data" message is a final transcript for that audio segment; there is no
 *     interim/is_final field — the server VAD decides segment boundaries.
 *   - We re-shape server messages to a simplified frontend protocol:
 *       { type: "connected" }
 *       { type: "transcript", transcript: "...", is_final: true }
 *       { type: "vad",        signal: "START_SPEECH"|"END_SPEECH" }
 *       { type: "error",      message: "..." }
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const SARVAM_STT_STREAM_URL = 'wss://api.sarvam.ai/speech-to-text/ws';

export function attachSTTStreamServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/stt' });

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    // Parse language from query string: /ws/stt?lang=hi-IN
    const url = new URL(req.url || '/', 'http://localhost');
    const langCode = url.searchParams.get('lang') || 'hi-IN';

    let sarvamWs: WebSocket | null = null;

    // Build Sarvam WebSocket URL with query params
    const sarvamUrl = new URL(SARVAM_STT_STREAM_URL);
    sarvamUrl.searchParams.set('language-code', langCode);
    sarvamUrl.searchParams.set('model', 'saaras:v3');
    sarvamUrl.searchParams.set('mode', 'transcribe');
    sarvamUrl.searchParams.set('sample_rate', '16000');
    sarvamUrl.searchParams.set('input_audio_codec', 'pcm_s16le');
    sarvamUrl.searchParams.set('vad_signals', 'true');
    sarvamUrl.searchParams.set('high_vad_sensitivity', 'true');

    try {
      // Auth is passed as a header, not a query param
      sarvamWs = new WebSocket(sarvamUrl.toString(), {
        headers: {
          'Api-Subscription-Key': SARVAM_API_KEY,
        },
      });

      sarvamWs.on('open', () => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'connected' }));
        }
      });

      sarvamWs.on('message', (rawData) => {
        if (clientWs.readyState !== WebSocket.OPEN) return;

        try {
          const msg = JSON.parse(rawData.toString()) as {
            type: string;
            data?: {
              transcript?: string;
              language_code?: string;
              signal_type?: string;
              occured_at?: number;
              error?: string;
              code?: number;
            };
          };

          if (msg.type === 'data' && msg.data?.transcript) {
            // Each Sarvam data message is a complete (final) transcript segment
            clientWs.send(JSON.stringify({
              type: 'transcript',
              transcript: msg.data.transcript,
              language_code: msg.data.language_code,
              is_final: true,
            }));
          } else if (msg.type === 'events' && msg.data?.signal_type) {
            clientWs.send(JSON.stringify({
              type: 'vad',
              signal: msg.data.signal_type, // "START_SPEECH" | "END_SPEECH"
            }));
          } else if (msg.type === 'error') {
            console.error('Sarvam STT error event:', msg.data);
            clientWs.send(JSON.stringify({
              type: 'error',
              message: msg.data?.error || 'STT error',
            }));
          }
        } catch {
          // Non-JSON message — forward as-is
          clientWs.send(rawData.toString());
        }
      });

      sarvamWs.on('error', (err) => {
        console.error('Sarvam STT stream error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', message: 'STT connection failed' }));
          clientWs.close();
        }
      });

      sarvamWs.on('close', (code, reason) => {
        console.log(`Sarvam STT closed: ${code} ${reason.toString()}`);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
      });

    } catch (err) {
      console.error('Failed to create Sarvam WebSocket:', err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to STT service' }));
        clientWs.close();
      }
      return;
    }

    // Forward audio from browser client → Sarvam
    // The browser sends raw ArrayBuffer (Int16 PCM); we base64-encode it for Sarvam
    clientWs.on('message', (data, isBinary) => {
      if (!sarvamWs || sarvamWs.readyState !== WebSocket.OPEN) return;

      if (isBinary) {
        // Convert raw PCM binary to base64 and wrap in the Sarvam JSON envelope
        const base64Audio = Buffer.from(data as ArrayBuffer).toString('base64');
        sarvamWs.send(JSON.stringify({ data: base64Audio }));
      } else {
        // Text control messages (e.g. flush signal) — forward directly
        sarvamWs.send(data.toString());
      }
    });

    clientWs.on('close', () => {
      if (sarvamWs && sarvamWs.readyState === WebSocket.OPEN) {
        // Send flush signal before closing to finalise any buffered audio
        try { sarvamWs.send(JSON.stringify({ flush: true })); } catch { /* ignore */ }
        sarvamWs.close();
      }
    });

    clientWs.on('error', (err) => {
      console.error('Client WebSocket error:', err.message);
      if (sarvamWs && sarvamWs.readyState === WebSocket.OPEN) sarvamWs.close();
    });
  });

  console.log('STT WebSocket proxy attached at /ws/stt');
  return wss;
}
