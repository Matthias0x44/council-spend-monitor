/** Resolve published register slugs against historical database aliases by identity. */
export function selectCouncils<T extends {slug:string;reference:string}>(
 councils:T[], registry:{slug:string;reference:string}[], requested:string[]|null, excluded:string[]=[],
):T[]{
 const canonical=new Map(registry.map(authority=>[authority.reference,authority.slug]));
 const matches=(council:T,slug:string)=>council.slug===slug||canonical.get(council.reference)===slug;
 if(requested){
  const missing=requested.filter(slug=>!councils.some(council=>matches(council,slug)));
  if(missing.length)throw new Error(`Requested authorities are not mapped in D1: ${missing.join(', ')}`);
 }
 return councils.filter(council=>(!requested||requested.some(slug=>matches(council,slug)))&&!excluded.some(slug=>matches(council,slug)));
}
