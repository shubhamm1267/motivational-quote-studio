export async function findWikipedia(topic){
 const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:topic.slice(0,120),gsrnamespace:'0',gsrlimit:'4',prop:'extracts|info',inprop:'url',explaintext:'1',exintro:'1',exchars:'3000',format:'json',formatversion:'2'});
 const res=await fetch(`https://en.wikipedia.org/w/api.php?${params}`,{signal:AbortSignal.timeout(13000),headers:{'user-agent':'FactCraftStudio/1.0 (local editor; information retrieval)'}});
 if(!res.ok)throw Error('Wikipedia search unavailable: '+res.status);
 const data=await res.json(),pages=data.query?.pages||[];
 const usable=pages.find(p=>p.extract&&p.extract.trim().length>120);
 if(!usable)throw Error('No source article found for this topic. Try another specific topic.');
 return {topic:usable.title,sourceText:usable.extract.slice(0,3000),sourceUrl:usable.fullurl||`https://en.wikipedia.org/wiki/${encodeURIComponent(usable.title.replaceAll(' ','_'))}`,sourceName:'Wikipedia (review before posting)'};
}
