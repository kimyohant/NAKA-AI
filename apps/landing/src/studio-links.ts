// Every "start" button on naka-ai opens a Naka Studio menu: /go/studio/<menu> redirects to that menu on
// STUDIO_URL, and the studio signs the member in through naka-ai (auth/studio.ts) when it needs to.
// The pages naka-ai used to make videos on (/review/, /create/, /chatbot/, the old /studio/ marketer)
// are gone; their URLs keep working by sending visitors to the studio menu that replaced them.
import type { Env } from './types';
import { studioConfig } from './auth/studio';

/** Landing name of a studio menu → its path in the studio app (apps/studio/frontend/menus). */
export const STUDIO_MENUS: Record<string, string> = {
  '': '/',
  skills: '/studio',
  drama: '/drama',
  'viral-clone': '/viral-clone',
  live: '/live',
  seller: '/seller',
  marketer: '/marketer',
};

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } });

// /create/?workflow=… named the job to start; the studio has a menu for each, the chatbot lives in /app/inbox/
const WORKFLOW: Record<string, string> = { sales: '/go/studio/skills', drama: '/go/studio/drama', live: '/go/studio/live', bot: '/app/inbox/' };

export function handleStudioLinks(request: Request, env: Env, url: URL): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = url.pathname;

  const go = /^\/go\/studio(?:\/([a-z-]*))?\/?$/.exec(path);
  if (go) {
    const menu = go[1] ?? '';
    if (!(menu in STUDIO_MENUS)) return redirect('/go/studio/');
    const studio = studioConfig(env);
    // studio switched off: the member area is the next best place
    if (!studio) return redirect('/app/');
    return redirect(studio.origin + STUDIO_MENUS[menu]);
  }

  if (/^\/review(\/|$)/.test(path)) return redirect('/go/studio/skills', 301);
  if (/^\/create(\/|$)/.test(path)) return redirect(WORKFLOW[url.searchParams.get('workflow') ?? ''] ?? '/go/studio/', 301);
  if (/^\/chatbot(\/|$)/.test(path)) return redirect('/app/inbox/', 301);
  if (/^\/studio(\/|$)/.test(path)) return redirect('/go/studio/marketer', 301);
  return null;
}
