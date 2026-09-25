/** Respect source-server rate limits across discovery and downloads. */
const deferredUntil = new Map<string, number>();
export function retryAfterMs(value: string | null, now = Date.now()): number {
 if (!value) return 60000;
 const seconds=Number(value);
 if (Number.isFinite(seconds)) return Math.max(60000,seconds*1000);
 const date=Date.parse(value);
 return Number.isFinite(date)?Math.max(60000,date-now):60000;
}
export async function publicFetch(url: string, options: RequestInit = {}): Promise<Response> {
 const host=new URL(url).host;
 const until=deferredUntil.get(host)||0;
 if(until>Date.now())throw new Error(`Source deferred until ${new Date(until).toISOString()}: ${host}`);
 const response=await fetch(url,options);
 if(response.status===429){
  const next=Date.now()+retryAfterMs(response.headers.get('retry-after'));
  deferredUntil.set(host,next);
  await response.body?.cancel();
  throw new Error(`Source rate limited (429); deferred until ${new Date(next).toISOString()}: ${host}`);
 }
 return response;
}
