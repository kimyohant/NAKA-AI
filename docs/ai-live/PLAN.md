# AI Live: live selling with a LiveTalking avatar

## Goal

A Studio page (`/live`) where a shop owner can:

1. start a Thai-speaking avatar and preview it;
2. have AI write a host script from the product facts and play it as a queue;
3. paste viewer comments and get AI replies grounded in the shop facts, with a handoff for anything a human must decide;
4. relay the stream to TikTok / Facebook over RTMP.

## Architecture

```
frontend /live ──/api/v1/live/*──▶ backend services/ai-live.ts ──Bearer──▶ naka-live-agent (GPU box :8020)
                                                                              ├─ LiveTalking --transport rtcpush (session "0")
                                                                              ├─ SRS 5 (WHIP in, WHEP out, rtc_to_rtmp)
                                                                              └─ ffmpeg -c copy → platform RTMP
browser ◀── WebRTC media (SRS :8000 tcp/udp) ── SDP via backend → agent → SRS WHEP
```

- **Upstream:** LiveTalking comes from https://github.com/hfhfn/LiveTalking (Apache-2.0, fork of lipku/LiveTalking).
- **rtcpush, not rtmp:** rtmp output needs the native `python_rtmpstream` build. rtcpush uses aiortc, which is already a dependency, and pushes WHIP into SRS.
- **No WebRTC from LiveTalking:** its own WebRTC needs UDP 1–65536 open. Through SRS only 8000 tcp+udp is public.
- **Speech:** `/human` with `{sessionid: "0", type: "echo"}` is the single speech path. Studio's own LLM agents write the words, not LiveTalking's `llm.py`, so speech always uses the configured Studio text model and our guardrails.
- **Voice:** Edge TTS Thai voices (`th-TH-PremwadeeNeural`, `AcharaNeural`, `NiwatNeural`). The voice is set at start (`--REF_FILE`) and can be overridden per line (`tts.ref_file`).

## Studio pieces

| Piece | File |
|---|---|
| Agents `live_host` (`{"lines": []}`) and `live_responder` (`{"reply", "handoff", "reason"}`) | `backend/src/agents/index.ts` |
| Config (`app_settings.ai_live`), agent client, LLM parsing, Unsloth GPU unload | `backend/src/services/ai-live.ts` |
| Routes `/api/v1/live/*` | `backend/src/routes/live.ts` |
| Page, `liveAPI`, queue helpers | `frontend/app/pages/live.vue`, `composables/useApi.ts`, `utils/liveFlow.js` |
| Tests | `backend/tests/ai-live.test.ts` (stub agent + fake LLM), `frontend/tests/ai-live-structure.test.mjs` |
| GPU-box install | `deploy/ai-live/` (`install.sh`, `naka_live_agent.py`, `srs.conf`, systemd unit, README in Thai) |

## Security

- **Owner's choice:** the agent is reachable on a public port and protected by a 48-hex-character token.
- **Agent hardening:**
  - token compare is constant time
  - inputs are validated (avatar id, voice, `rtmp(s)://`)
  - LiveTalking (8010) and the SRS API (1985) bind to 127.0.0.1
- **Secrets in Studio:** the token and the RTMP URL (it contains the stream key) live only in the backend. The API returns `hasToken`, `hasRtmpUrl` and `rtmpHost` instead.
- **Going live** asks for confirmation (ConfirmDialog) because it broadcasts publicly.

## Not in this round

- reading comments automatically from TikTok/Facebook (comments are pasted)
- several simultaneous sessions (`--max_session 1`)
- MuseTalk avatars (the agent accepts the model name, but the UI starts wav2lip)
