const SAFE_MODELS = new Set(['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-3.1-flash-lite']);
export function sanitizeModel(model){return SAFE_MODELS.has(model)?model:'gemini-2.5-flash-lite'}
function extractJSON(text){
 const trimmed=String(text||'').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
 try{return JSON.parse(trimmed)}catch{}
 const a=trimmed.indexOf('{'),b=trimmed.lastIndexOf('}');
 if(a<0||b<=a)throw Error('Gemini did not return a JSON object');
 return JSON.parse(trimmed.slice(a,b+1));
}
function clean(s,max=180){return typeof s==='string'?s.trim().slice(0,max):''}
export async function writePost({key,model,topic,language='hi'}){
 if(!key) throw Error('Gemini API key required for custom topic generation.');
 const prompt=`You are creating an original social-media motivational quote poster.
Write ONE short original quote in ${language==='en'?'English':'Hindi in Devanagari script'}.
Important rules:
- Write an ORIGINAL quote. Do not quote or imitate famous authors, books, songs, movies, or existing pages.
- Tone: emotional, motivational, thought-provoking, suitable for a dark quote page.
- Headline is the main quote, max 170 characters, max 26 words.
- Detail is an optional supporting line, max 90 characters.
- Eyebrow is a small category label, max 24 characters.
- SEO title max 120 characters.
- Caption 1-2 short sentences.
- Exactly 3 hashtags.
Return JSON ONLY:
{"headline":"...","detail":"...","eyebrow":"...","seoTitle":"...","caption":"...","hashtags":["#..."],"imageQuery":"","insufficient":false}
TOPIC: ${topic.slice(0,180)}`;
 const target=`https://generativelanguage.googleapis.com/v1beta/models/${sanitizeModel(model)}:generateContent`;
 let error;
 for(let attempt=0;attempt<2;attempt++){
  let response;
  try{
   response=await fetch(target,{method:'POST',headers:{'x-goog-api-key':key,'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.9,maxOutputTokens:900}}),signal:AbortSignal.timeout(35000)});
  }catch(e){error=new Error('Gemini network error: '+e.message);continue}
  if(!response.ok){let detail=(await response.text()).slice(0,250);throw Error(`Gemini ${response.status}: ${detail}`)}
  try{
   const json=await response.json(), p=json.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
   const obj=extractJSON(p);
   const post={headline:clean(obj.headline,200),detail:clean(obj.detail,120),eyebrow:clean(obj.eyebrow,45),seoTitle:clean(obj.seoTitle,180),caption:clean(obj.caption,400),hashtags:(Array.isArray(obj.hashtags)?obj.hashtags:[]).map(s=>clean(s,40)).filter(s=>/^#[\p{L}\p{N}_]+$/u.test(s)).slice(0,4),imageQuery:'',sourceUrl:'',sourceName:'Original AI quote draft',verification:'ai_original_quote_review_required'};
   if(!post.headline)throw Error('Gemini response missing quote headline');
   if(!post.hashtags.length)post.hashtags=['#MotivationalQuotes'];
   return post;
  }catch(e){error=e}
 }
 throw Error('Gemini did not return a valid quote JSON: '+(error?.message||''));
}
