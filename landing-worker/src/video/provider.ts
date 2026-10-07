// The contract between naka-ai's AI video jobs (src/video/index.ts) and a video generation
// provider. Each provider module registers itself in VIDEO_PROVIDERS; the active one, its key,
// base URL and model are chosen in /admin/system/ (VIDEO_PROVIDER, VIDEO_API_KEY, …).

export interface VideoProviderConfig { apiKey: string; baseUrl: string; model: string }

export interface VideoRequest {
  prompt: string;
  /** Public https links the provider downloads (signed, short-lived links to our R2 objects). */
  referenceImages: string[];
  referenceVideos: string[];
  durationSec: number;
  aspectRatio: "9:16" | "1:1" | "16:9";
  resolution: "480p" | "720p";
  generateAudio: boolean;
}

export type VideoSubmitResult = { taskId: string } | { videoUrl: string };
export type VideoPollResult =
  | { status: "running" }
  | { status: "done"; videoUrl: string; durationSec?: number }
  | { status: "failed"; error: string };

export interface VideoProvider {
  id: string;
  label: string;
  /** Used when VIDEO_BASE_URL / VIDEO_MODEL are left blank. */
  defaultBaseUrl: string;
  defaultModel: string;
  limits: { minSec: number; maxSec: number; images: number; videos: number };
  submit(config: VideoProviderConfig, request: VideoRequest): Promise<VideoSubmitResult>;
  poll(config: VideoProviderConfig, taskId: string): Promise<VideoPollResult>;
}

/** Thrown by a provider when the request itself is wrong (bad key, bad media): retrying cannot help. */
export class VideoProviderRejected extends Error {}

export const VIDEO_PROVIDERS: Record<string, VideoProvider> = {};

export function registerVideoProvider(provider: VideoProvider): void {
  VIDEO_PROVIDERS[provider.id] = provider;
}
