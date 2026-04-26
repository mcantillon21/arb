import type { Listing } from './db';
import type { BrandInfo } from './enrich';
import { extractBrand } from './enrich';

const fmt$ = (c: number | null) => (c != null ? `$${(c / 100).toFixed(0)}` : '?');

function pctOff(ask: number | null, fair: number | null): string | null {
  if (!ask || !fair || fair <= ask) return null;
  return `${Math.round(((fair - ask) / fair) * 100)}%`;
}

function ratWithoutBracket(rationale: string | null): string {
  if (!rationale) return '';
  return rationale.replace(/^\[[^\]]*\]\s*/, '');
}

function card(l: Listing, n: number): string {
  const spread = l.fair_value_cents && l.price_cents ? l.fair_value_cents - l.price_cents : null;
  const off = pctOff(l.price_cents, l.fair_value_cents);
  const brand = extractBrand(l.product_name || 'Other');
  return `
    <div class="card" data-brand="${esc(brand)}" data-model="${esc(extractModel(brand, l.product_name || ''))}" data-product="${esc(l.product_name || '')}" data-id="${esc(l.id)}" style="animation-delay:${n * 50}ms">
      <div class="photo-wrap" data-listing-id="${esc(l.id)}" data-url="${esc(l.url)}">
        ${l.photo_url ? `<img src="${l.photo_url}" loading="lazy" onerror="this.style.display='none'"/>` : '<div class="no-photo">no photo</div>'}
        <div class="agent-overlay deploy-cta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg><span>Deploy Agent</span></div>
        <div class="agent-status" hidden><span class="status-dot"></span><span class="status-text"></span></div>
        <div class="draft-msg" hidden></div>
      </div>
      <div class="body">
        <h3>${esc(/^just listed$/i.test(l.title.trim()) && l.product_name ? l.product_name : l.title)}</h3>
        <div class="compare">
          <div class="compare-col">
            <span class="compare-label">Retail</span>
            <span class="compare-price retail">${fmt$(l.fair_value_cents)}</span>
          </div>
          <div class="compare-arrow">&rarr;</div>
          <div class="compare-col">
            <span class="compare-label">Marketplace</span>
            <span class="compare-price market">${fmt$(l.price_cents)}</span>
          </div>
        </div>
        <div class="meta">
          ${l.location ? `${esc(l.location)} &middot; ` : ''}walk ${fmt$(l.walk_price_cents)}
        </div>
        <p class="rationale">${esc(ratWithoutBracket(l.rationale))}</p>
      </div>
    </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractModel(brand: string, productName: string): string {
  let model = productName.replace(new RegExp('^' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '');
  // take first word as model (Aeron, Eames, Mirra, Embody, etc.)
  const first = model.split(/\s+/)[0];
  return first || model;
}

function pillHtml(info: BrandInfo): string {
  const img = info.image_b64
    ? `<img class="pill-img" src="data:image/png;base64,${info.image_b64}" alt=""/>`
    : `<span class="pill-dot"></span>`;
  // group products by model name instead of listing every variant
  const modelCounts = new Map<string, { model: string; count: number; products: string[] }>();
  for (const p of info.products) {
    if (p === info.brand || p === 'Other') continue;
    const model = extractModel(info.brand, p);
    const existing = modelCounts.get(model);
    if (existing) { existing.count++; existing.products.push(p); }
    else modelCounts.set(model, { model, count: 1, products: [p] });
  }
  const models = [...modelCounts.values()].sort((a, b) => b.count - a.count);
  const dropdown = models.length > 0
    ? `<div class="pill-dropdown"><div class="pill-dropdown-inner">${models.map(m =>
        `<button class="pill-sub" data-model="${esc(m.model)}" data-brand="${esc(info.brand)}">${esc(m.model)}<span class="pill-count">${m.count}</span></button>`
      ).join('')}</div></div>`
    : '';
  return `<div class="pill-wrap"><button class="pill" data-filter="${esc(info.brand)}">${img}<span class="pill-label">${esc(info.brand)}</span><span class="pill-count">${info.count}</span></button>${dropdown}</div>`;
}

export function generateHTML(listings: Listing[], brands: Map<string, BrandInfo>): string {
  const gems = listings.filter((l) => (l.score ?? 0) >= 7).length;
  const totalSpread = listings.reduce((sum, l) => {
    if (l.fair_value_cents && l.price_cents) return sum + (l.fair_value_cents - l.price_cents);
    return sum;
  }, 0);

  const sortedBrands = [...brands.values()].sort((a, b) => b.count - a.count);
  const pillsHtml = sortedBrands.map(info => pillHtml(info)).join('');
  const cards = listings.map((l, i) => card(l, i + 1)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>arb / ${listings.length} candidates</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet"/>
<style>
  :root{
    --navy:#151A30;--charcoal:#293340;--gray:#8A8A8A;--pale-gray:#D9DEE8;
    --stone:#E8E6E0;--light-gray:#F3F3F3;--white:#FFFFFF;
    --money:#389800;--amber:#FFBD00;--red:#B50000;
    --radius:10px
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--light-gray);color:var(--charcoal);font-family:"Instrument Sans",system-ui,sans-serif;padding:clamp(1.125rem,2.2vw + 0.52rem,2.5rem);padding-bottom:48px;min-height:100vh;-webkit-font-smoothing:antialiased;font-size:clamp(1rem,0.2vw + 0.945rem,1.125rem);line-height:1.6;letter-spacing:0.2px}
  .wrap{max-width:1200px;margin:0 auto}
  .header{text-align:center;padding:clamp(1.5rem,2vw + 0.5rem,2.5rem) 0 clamp(1rem,1.5vw + 0.25rem,1.5rem)}
  .header h1{font-family:"Instrument Serif",serif;font-size:1.75rem;font-weight:400;letter-spacing:1.2px;line-height:1.2;color:var(--gray)}
  .header h1 span{color:var(--navy)}
  .stats{display:flex;gap:clamp(1.5rem,2vw + 0.5rem,2.5rem);justify-content:center;margin:16px 0 24px;font-size:0.875rem;color:var(--gray)}
  .stats .val{color:var(--navy);font-weight:600;font-size:clamp(1.125rem,0.3vw + 1rem,1.3125rem);font-variant-numeric:tabular-nums}
  .stats .accent{color:var(--navy)}

  .pills{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:0 0 clamp(1.5rem,2vw + 0.5rem,2rem);padding:0 16px}
  .pill{border:1px solid var(--pale-gray);border-radius:999px;padding:4px 12px 4px 4px;font-size:0.875rem;font-family:inherit;cursor:pointer;transition:background .2s,color .2s,border-color .2s,transform .15s;display:inline-flex;align-items:center;gap:6px;background:var(--white);color:var(--gray);min-height:34px}
  .pill:hover{background:var(--stone);color:var(--navy);border-color:var(--gray)}
  .pill:active{transform:scale(0.97)}
  .pill.active{background:var(--navy);color:var(--white);border-color:var(--navy);font-weight:500}
  .pill-all{padding:4px 14px;font-weight:500}
  .pill-img{width:24px;height:24px;border-radius:50%;object-fit:cover;background:var(--light-gray);outline:1px solid rgba(0,0,0,0.08);outline-offset:-1px;flex-shrink:0}
  .pill-dot{width:24px;height:24px;border-radius:50%;background:var(--pale-gray);flex-shrink:0}
  .pill-label{white-space:nowrap}
  .pill-count{font-size:0.75rem;opacity:0.5;font-weight:400}
  .pill.active .pill-count{opacity:0.6}
  .pill.active .pill-img{outline-color:rgba(255,255,255,0.2)}
  .pill-wrap{position:relative;display:inline-flex}
  .pill-dropdown{display:none;position:absolute;top:100%;left:0;padding-top:8px;z-index:20}
  .pill-dropdown-inner{background:var(--white);border:1px solid var(--pale-gray);border-radius:8px;box-shadow:0 8px 24px -4px rgba(21,26,48,0.15);padding:4px;min-width:180px;max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
  .pill-wrap:hover .pill-dropdown{display:block}
  .pill-sub{display:block;width:100%;text-align:left;padding:7px 12px;font-size:0.8125rem;font-family:inherit;border:none;background:none;color:var(--charcoal);cursor:pointer;border-radius:6px;transition:background .15s,color .15s;white-space:nowrap}
  .pill-sub:hover{background:var(--light-gray);color:var(--navy)}
  .pill-sub.active{background:var(--navy);color:var(--white);font-weight:500}

  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:clamp(1rem,1.5vw + 0.5rem,1.5rem)}
  @keyframes card-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  .card{background:var(--white);border:1px solid var(--pale-gray);border-radius:var(--radius);overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s;animation:card-in .4s ease both;box-shadow:0 1px 3px rgba(0,0,0,0.04)}
  .card:hover{transform:translateY(-4px);border-color:var(--gray);box-shadow:0 12px 32px -8px rgba(21,26,48,0.12)}
  .card[hidden]{display:none}
  .photo-wrap{position:relative;height:220px;overflow:hidden;background:var(--stone);display:block;cursor:pointer}
  .photo-wrap img{width:100%;height:100%;object-fit:cover;outline:1px solid rgba(0,0,0,0.06);outline-offset:-1px;transition:transform .3s}
  .photo-wrap:hover img{transform:scale(1.03)}
  .no-photo{display:flex;align-items:center;justify-content:center;height:100%;color:var(--gray);font-size:0.875rem}
  .agent-overlay{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:12px 16px;background:linear-gradient(0deg,rgba(21,26,48,0.85) 0%,rgba(21,26,48,0) 100%);color:var(--white);font-size:0.8125rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;opacity:0;transform:translateY(4px);transition:opacity .25s,transform .25s;pointer-events:none}
  .photo-wrap:hover .agent-overlay{opacity:1;transform:none}
  .agent-overlay svg{flex-shrink:0;transition:transform .25s}
  .photo-wrap:hover .agent-overlay svg{transform:translateX(3px)}
  .agent-status{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:10px 16px;background:linear-gradient(0deg,rgba(21,26,48,0.9) 0%,rgba(21,26,48,0) 100%);color:var(--white);font-size:0.8125rem;font-weight:600;letter-spacing:0.04em;text-transform:uppercase}
  .agent-status[hidden]{display:none}
  .card.deployed .deploy-cta{display:none!important}
  .card.deployed .agent-status{display:flex}
  .card.deployed .photo-wrap:hover .agent-overlay{opacity:0}
  .draft-msg{padding:10px 14px;background:var(--light-gray);border-radius:8px;margin-bottom:10px;font-size:0.8125rem;color:var(--charcoal);line-height:1.5;font-style:italic}
  .draft-msg[hidden]{display:none}
  .card.failed{cursor:pointer}
  .card.failed .status-text::after{content:' — click to retry'}
  @keyframes agent-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.3)}}
  .status-dot{width:8px;height:8px;border-radius:50%;background:var(--white);flex-shrink:0}
  .status-dot.active{animation:agent-pulse 1.5s ease-in-out infinite}
  .status-dot.sent{background:#389800;animation:none}
  .status-dot.failed{background:var(--red);animation:none}
  .body{padding:16px 20px 20px}
  h3{font-family:"Instrument Serif",serif;font-size:clamp(1.125rem,0.2vw + 1.07rem,1.25rem);font-weight:400;line-height:1.18;letter-spacing:0.4px;margin-bottom:12px;color:var(--navy);text-wrap:balance}
  .compare{display:flex;align-items:center;gap:0;margin-bottom:6px;padding:10px 14px;background:var(--light-gray);border-radius:8px}
  .compare-col{display:flex;flex-direction:column;gap:2px;flex:1}
  .compare-label{font-size:0.75rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--gray)}
  .compare-price{font-size:clamp(1.25rem,0.3vw + 1.1rem,1.5rem);font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
  .compare-price.retail{color:var(--gray);text-decoration:line-through;text-decoration-color:var(--pale-gray)}
  .compare-price.market{color:var(--navy)}
  .compare-arrow{color:var(--pale-gray);font-size:16px;padding:0 14px;align-self:flex-end;padding-bottom:4px}
  .save{font-size:0.8125rem;font-weight:600;color:var(--charcoal);margin-bottom:10px;padding-left:14px}
  .save .off{font-weight:400;color:var(--gray)}
  .meta{font-size:0.8125rem;color:var(--gray);margin-bottom:8px;font-variant-numeric:tabular-nums}
  .rationale{font-size:0.875rem;color:var(--charcoal);line-height:1.6;margin-bottom:14px;text-wrap:pretty;letter-spacing:0.2px}
  .actions{display:flex;gap:8px}
  .btn{padding:10px 16px;border-radius:var(--radius);font-size:0.875rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;border:1px solid var(--pale-gray);background:var(--white);color:var(--navy);text-decoration:none;transition:background .2s,color .2s,border-color .2s,transform .15s;min-height:40px;display:inline-flex;align-items:center}
  .btn:hover{background:var(--navy);color:var(--white);border-color:var(--navy)}
  .btn:active{transform:scale(0.96)}
  .btn.primary{background:var(--navy);border-color:var(--navy);color:var(--white)}
  .btn.primary:hover{background:var(--charcoal);border-color:var(--charcoal)}
  .search-wrap{display:flex;justify-content:center;margin:0 0 clamp(1rem,1.5vw + 0.25rem,1.25rem);padding:0 16px;gap:8px}
  .search{width:100%;max-width:400px;padding:9px 16px 9px 36px;border:1px solid var(--pale-gray);border-radius:999px;font-size:0.875rem;font-family:inherit;background:var(--white) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238A8A8A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") 12px center no-repeat;color:var(--charcoal);outline:none;transition:border-color .2s,box-shadow .2s}
  .search::placeholder{color:var(--gray)}
  .search:focus{border-color:var(--navy);box-shadow:0 0 0 3px rgba(21,26,48,0.08)}
  .search-status{font-size:0.8125rem;color:var(--gray);align-self:center;white-space:nowrap;min-width:0;transition:opacity .3s}
  @keyframes spin{to{transform:rotate(360deg)}}
  .spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--pale-gray);border-top-color:var(--navy);border-radius:50%;animation:spin .6s linear infinite;vertical-align:middle;margin-right:6px}
  .footer{text-align:center;padding:clamp(2rem,3vw + 1rem,3rem) 0 20px;font-size:0.75rem;color:var(--gray);letter-spacing:0.06em;text-transform:uppercase}
  @media(prefers-reduced-motion:reduce){.card{animation:none}}
</style>
</head>
<body>
<div class="wrap">
<div class="header">
  <h1><span>arb</span> fb marketplace</h1>
</div>
<div class="pills">
  <button class="pill pill-all active" data-filter="all">All <span class="pill-count">${listings.length}</span></button>
  ${pillsHtml}
</div>
<div class="search-wrap"><input class="search" id="search" type="text" placeholder="Find deals on marketplace..." autocomplete="off"/><span class="search-status" id="search-status"></span></div>
<div class="grid">${cards}</div>
</div>
<div class="footer">generated ${new Date().toLocaleString()} &middot; arb</div>
<script>
const pills=document.querySelector('.pills');
const searchEl=document.getElementById('search');
const statusEl=document.getElementById('search-status');
const grid=document.querySelector('.grid');
const knownIds=new Set([...document.querySelectorAll('.card')].map(c=>c.dataset.id));
let filterMode='all',filterValue='';

function clearActive(){document.querySelectorAll('.pill,.pill-sub').forEach(p=>p.classList.remove('active'))}
function applyFilters(){
  document.querySelectorAll('.card').forEach(c=>{
    let show=true;
    if(filterMode==='brand')show=c.dataset.brand===filterValue;
    else if(filterMode==='model')show=c.dataset.model===filterValue;
    c.hidden=!show;
  });
}
pills.addEventListener('click',e=>{
  const sub=e.target.closest('.pill-sub');
  if(sub){e.stopPropagation();clearActive();sub.classList.add('active');sub.closest('.pill-wrap')?.querySelector('.pill')?.classList.add('active');filterMode='model';filterValue=sub.dataset.model;applyFilters();return}
  const btn=e.target.closest('.pill');if(!btn)return;clearActive();btn.classList.add('active');
  const f=btn.dataset.filter;filterMode=f==='all'?'all':'brand';filterValue=f;applyFilters();
});

let searching=false;
searchEl.addEventListener('keydown',async e=>{
  if(e.key!=='Enter'||searching)return;
  const q=searchEl.value.trim();
  if(!q)return;
  searching=true;
  statusEl.innerHTML='<span class="spinner"></span>Scanning marketplace...';
  searchEl.disabled=true;
  try{
    await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
    statusEl.innerHTML='<span class="spinner"></span>Scoring finds...';
    let polls=0;
    const poll=setInterval(async()=>{
      polls++;
      try{
        const r=await fetch('/api/candidates');
        const rows=await r.json();
        let added=0;
        for(const item of rows){
          if(!knownIds.has(item.id)){
            knownIds.add(item.id);
            added++;
            const tmp=document.createElement('div');
            tmp.innerHTML=buildCard(item,knownIds.size);
            const card=tmp.firstElementChild;
            grid.prepend(card);
            wireCard(card);
          }
        }
        if(added)statusEl.textContent=added+' new deal'+(added===1?'':'s')+' found';
      }catch{}
      if(polls>=20){clearInterval(poll);finish()}
    },3000);
    function finish(){searching=false;searchEl.disabled=false;setTimeout(()=>{statusEl.textContent=''},4000)}
    setTimeout(()=>{clearInterval(poll);finish()},65000);
  }catch{statusEl.textContent='Search failed';searching=false;searchEl.disabled=false}
});

const fm=c=>c!=null?'$'+(c/100).toFixed(0):'?';
function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function buildCard(item,n){
  const brand=item.product_name||'Other';
  const title=/^just listed$/i.test((item.title||'').trim())&&item.product_name?item.product_name:item.title;
  const rat=(item.rationale||'').replace(/^\\[[^\\]]*\\]\\s*/,'');
  return '<div class="card" data-brand="'+esc(brand)+'" data-product="'+esc(item.product_name||'')+'" data-id="'+esc(item.id)+'" style="animation-delay:'+n*50+'ms">'
    +'<div class="photo-wrap" data-listing-id="'+esc(item.id)+'" data-url="'+esc(item.url)+'">'
    +(item.photo_url?'<img src="'+item.photo_url+'" loading="lazy" onerror="this.style.display=\\'none\\'"/>':'<div class="no-photo">no photo</div>')
    +'<div class="agent-overlay deploy-cta"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg><span>Deploy Agent</span></div>'
    +'<div class="agent-status" hidden><span class="status-dot"></span><span class="status-text"></span></div>'
    +'<div class="draft-msg" hidden></div>'
    +'</div>'
    +'<div class="body"><h3>'+esc(title)+'</h3>'
    +'<div class="compare"><div class="compare-col"><span class="compare-label">Retail</span><span class="compare-price retail">'+fm(item.fair_value_cents)+'</span></div><div class="compare-arrow">&rarr;</div><div class="compare-col"><span class="compare-label">Marketplace</span><span class="compare-price market">'+fm(item.price_cents)+'</span></div></div>'
    +'<div class="meta">'+(item.location?esc(item.location)+' &middot; ':'')+'walk '+fm(item.walk_price_cents)+'</div>'
    +'<p class="rationale">'+esc(rat)+'</p>'
    +'</div></div>';
}
function wireCard(card){
  const pw=card.querySelector('.photo-wrap');
  pw.addEventListener('click',e=>{
    e.preventDefault();
    if(card.classList.contains('failed')){deploy(card);return}
    if(card.classList.contains('deployed')){window.open(pw.dataset.url,'_blank');return}
    deploy(card);
  });
}

// Deploy agent
function deploy(card){
  const pw=card.querySelector('.photo-wrap');
  const id=pw.dataset.listingId;
  card.classList.add('deployed');
  card.classList.remove('failed');
  const dot=pw.querySelector('.status-dot');
  const txt=pw.querySelector('.status-text');
  pw.querySelector('.agent-status').hidden=false;
  dot.className='status-dot active';
  txt.textContent='Drafting offer...';
  fetch('/api/deploy/'+id,{method:'POST'}).catch(()=>{});
}
document.querySelectorAll('.photo-wrap').forEach(pw=>{
  pw.addEventListener('click',e=>{
    e.preventDefault();
    const card=pw.closest('.card');
    if(card.classList.contains('failed')){deploy(card);return}
    if(card.classList.contains('deployed')){window.open(pw.dataset.url,'_blank');return}
    deploy(card);
  });
});

// Poll
async function pollStatus(){
  try{
    const r=await fetch('/api/status');
    const data=await r.json();
    for(const[id,s]of Object.entries(data)){
      const card=document.querySelector('.card[data-id="'+id+'"]');
      if(!card)continue;
      card.classList.add('deployed');
      const pw=card.querySelector('.photo-wrap');
      const dot=pw.querySelector('.status-dot');
      const txt=pw.querySelector('.status-text');
      const draft=card.querySelector('.draft-msg');
      pw.querySelector('.agent-status').hidden=false;
      if(s.status==='drafting'){dot.className='status-dot active';txt.textContent='Drafting offer...'}
      else if(s.status==='sending'){
        dot.className='status-dot active';txt.textContent='Sending '+fm(s.offer_cents)+'...';
        if(s.message){draft.hidden=false;draft.textContent='"'+s.message+'"'}
      }
      else if(s.status==='sent'){
        dot.className='status-dot sent';txt.textContent='Bid '+fm(s.offer_cents)+' sent';
        if(s.message){draft.hidden=false;draft.textContent='"'+s.message+'"'}
      }
      else if(s.status==='failed'){
        dot.className='status-dot failed';txt.textContent='Failed';
        card.classList.add('failed');
      }
    }
  }catch{}
}
setInterval(pollStatus,2000);
pollStatus();
</script>
</body>
</html>`;
}
