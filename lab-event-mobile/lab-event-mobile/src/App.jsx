import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar, FileText, LayoutDashboard, LogOut, ChevronRight,
  AlertCircle, Loader2, TrendingUp, Clock, Euro, Users, MapPin,
  RefreshCw, Phone, Mail, Building2, Plus, X, CheckCircle2,
  AlertTriangle, Activity, ChevronLeft, CreditCard, Receipt,
  UserRound, Briefcase
} from 'lucide-react';

// ─── Design tokens ───────────────────────────────────────────────
const T = {
  brand:'#00b3b5', brandStrong:'#00aeb1', brandPressed:'#009da0',
  brandLight:'#26c0c3', brandTint:'#e6f7f7', brandSubtle:'#f3fbfb',
  success:'#0abb87', info:'#5578eb', warning:'#ffb822', danger:'#f44336',
  secondary:'#607d8b', ink:'#1b283f', text:'#464e5f', textMuted:'#80808f',
  textSubtle:'#b5b5c3', surface:'#ffffff', surfaceMuted:'#f9fafb',
  border:'#ecf0f3', borderStrong:'#e5eaee',
};

// ─── API ─────────────────────────────────────────────────────────
const PROXY = 'https://lab-event-proxy.vercel.app';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes avant rafraîchissement silencieux
const CACHE_MAX = 2 * 60 * 60 * 1000; // 2 heures max (force refresh)

function buildSubdomain(s) {
  return s.trim().replace(/^https?:\/\//,'').replace(/\.lab-event\.com.*$/,'').replace(/\/$/,'');
}

// ─── Cache hybride : mémoire (gros) + localStorage (petits) ─────
// localStorage ~5MB max → on garde en mémoire les gros datasets
const _memCache = new Map(); // clé → {data, ts}

function cacheKey(subdomain, path) {
  return `le_cache_${subdomain}_${path.replace(/[^a-z0-9]/gi,'_')}`;
}
// Endpoints volumineux → mémoire uniquement
const BIG_PATHS = ['analytics_events','rentability','planning_by_day','partner_companies'];
function isBig(key) { return BIG_PATHS.some(p => key.includes(p)); }

function cacheGet(key) {
  // Mémoire d'abord
  if (_memCache.has(key)) {
    const {data, ts} = _memCache.get(key);
    return { data, age: Date.now() - ts };
  }
  // localStorage ensuite
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, age: Date.now() - ts };
  } catch { return null; }
}
function cacheSet(key, data) {
  _memCache.set(key, { data, ts: Date.now() });
  if (!isBig(key)) {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }
}
function cacheClear(subdomain) {
  // Vider la mémoire
  for (const k of _memCache.keys()) { if (k.includes(subdomain)) _memCache.delete(k); }
  // Vider localStorage
  try {
    Object.keys(localStorage).filter(k=>k.startsWith(`le_cache_${subdomain}`)).forEach(k=>localStorage.removeItem(k));
  } catch {}
}
// Lit une entrée de cache localStorage et renvoie TOUJOURS un tableau, que la réponse API
// d'origine soit un tableau brut ou enveloppée dans {data:[...]} (comme /v3/scheduler).
// Les lectures directes de localStorage pour les recherches croisées (fiche événement/société/
// contact) bypassent apiCached() et son unwrapping : sans ce helper, un appel .filter() sur un
// objet enveloppé lève une exception silencieuse et affiche "0" partout.
function cacheArr(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));
    const d = raw?.data;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.data)) return d.data;
    return [];
  } catch { return []; }
}
// Les événements ('analytics_events') sont dans BIG_PATHS : jamais persistés en localStorage,
// seulement en mémoire (_memCache). Une recherche via Object.keys(localStorage) ne les trouvera
// donc jamais. On utilise cacheGet() (mémoire d'abord) avec la clé exacte de l'endpoint events.
function findEventByName(session, name) {
  if (!name || !session) return null;
  const n = String(name).toLowerCase().trim();
  if (!n) return null;
  const key = cacheKey(session.subdomain, '/v3/analytics/events');
  const cached = cacheGet(key);
  const raw = cached?.data;
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
  return arr.find(e => (e.event_name||'').toLowerCase().trim() === n) || null;
}

async function api(subdomain, token, path, { method='GET', body }={}) {
  let finalPath = path;
  if (method === 'GET') {
    const sep = path.includes('?') ? '&' : '?';
    finalPath = `${path}${sep}per_page=2000`;
  }
  const url = `${PROXY}/api/proxy?path=${encodeURIComponent(finalPath)}`;
  const enrichedBody = method === 'POST' && body !== undefined
    ? { per_page: 2000, ...body }
    : body;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Subdomain': subdomain,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: enrichedBody ? JSON.stringify(enrichedBody) : undefined,
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.error || data?.message || `${res.status}`);
  if (data?.error) throw new Error(data.error);
  return data;
}

// apiCached : retourne le cache immédiatement, rafraîchit en arrière-plan si besoin
async function apiCached(subdomain, token, path, opts={}, onRefresh) {
  // Use stable key (path only, not body) for analytics endpoints
  // This ensures the stale-while-revalidate works properly across sessions
  const isAnalytics = path.includes('/v3/analytics/') || path.includes('/v3/scheduler');
  const key = isAnalytics ? cacheKey(subdomain, path) : cacheKey(subdomain, path + JSON.stringify(opts.body||''));
  const cached = cacheGet(key);

  if (cached && cached.age < CACHE_MAX) {
    // Retourne le cache tout de suite
    if (cached.age > CACHE_TTL && onRefresh) {
      // Rafraîchit silencieusement en arrière-plan
      api(subdomain, token, path, opts).then(fresh => {
        cacheSet(key, fresh);
        onRefresh(fresh);
      }).catch(()=>{});
    }
    return cached.data;
  }
  // Pas de cache ou expiré : fetch normal
  const fresh = await api(subdomain, token, path, opts);
  cacheSet(key, fresh);
  return fresh;
}

async function fetchAllPagesCached(subdomain, token, basePath, onRefresh) {
  const key = cacheKey(subdomain, 'allpages_' + basePath);
  const cached = cacheGet(key);

  if (cached && cached.age < CACHE_MAX) {
    if (cached.age > CACHE_TTL && onRefresh) {
      fetchAllPages(subdomain, token, basePath).then(fresh => {
        cacheSet(key, fresh);
        onRefresh(fresh);
      }).catch(()=>{});
    }
    return cached.data;
  }
  const fresh = await fetchAllPages(subdomain, token, basePath);
  cacheSet(key, fresh);
  return fresh;
}


// Date j-2 ans pour filtrer les données
function dateJ2Ans() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().split('T')[0];
}

// Date j-6 mois pour filtrer les activités (fenêtre glissante, évite les comptes
// à plusieurs milliers d'activités de dépasser le plafond de pagination de l'API)
function dateJ6Mois() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().split('T')[0];
}

// ─── Helpers ─────────────────────────────────────────────────────
const money = n => n==null||isNaN(n)?'—':new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const date  = d => { if(!d) return '—'; try { return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(d)); } catch{return d;} };
const strip = h => h ? h.replace(/<[^>]*>/g,'').trim() : '';
const formatVAT = v => {
  if (!v || typeof v !== 'object') return safeStr(v)||'—';
  return Object.entries(v).filter(([k,val])=>val&&val!=='').map(([k,val])=>`${k}% : ${money(val)}`).join(' · ')||'—';
};
const formatEventState = s => {
  if (!s || /^\d+$/.test(String(s))) return null; // hide numeric IDs
  return s;
};
const dateTime = d => {
  if (!d) return '—';
  try { return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(d)); } catch { return d; }
};

// ─── Shared Components ───────────────────────────────────────────
function SearchBar({value, onChange, placeholder}) {
  return <div style={{position:'relative',marginBottom:12}}>
    <svg style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',pointerEvents:'none'}} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      value={value}
      onChange={e=>onChange(e.target.value)}
      placeholder={placeholder||'Rechercher…'}
      style={{width:'100%',height:42,padding:'0 36px 0 36px',border:`1.5px solid ${T.borderStrong}`,borderRadius:9,fontSize:13.5,color:T.ink,outline:'none',background:T.surface,boxSizing:'border-box',boxShadow:'0 1px 3px rgba(16,24,40,0.06)'}}
      onFocus={e=>{e.target.style.borderColor=T.brand;e.target.style.boxShadow=`0 0 0 4px rgba(0,179,181,0.12)`;}}
      onBlur={e=>{e.target.style.borderColor=T.borderStrong;e.target.style.boxShadow='0 1px 3px rgba(16,24,40,0.06)';}}
    />
    {value&&<button onClick={()=>onChange('')} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:T.textMuted,display:'flex',alignItems:'center'}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>}
  </div>;
}
function Card({children,style,onClick}) {
  return <div onClick={onClick} style={{background:T.surface,borderRadius:12,border:`1px solid ${T.border}`,boxShadow:'0 1px 3px rgba(16,24,40,0.06)',cursor:onClick?'pointer':'default',...style}}>{children}</div>;
}

function Spinner() {
  return <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:60}}><Loader2 size={24} color={T.brand} style={{animation:'spin 1s linear infinite'}}/></div>;
}

function ErrBanner({msg,onRetry}) {
  return <div style={{display:'flex',gap:8,alignItems:'flex-start',background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 14px',margin:'0 16px 16px',fontSize:12.5,color:T.danger,lineHeight:1.5,whiteSpace:'pre-wrap'}}>
    <AlertCircle size={16} style={{flexShrink:0,marginTop:1}}/>
    <span style={{flex:1}}>{msg}</span>
    {onRetry&&<button onClick={onRetry} style={{background:'none',border:'none',color:T.danger,cursor:'pointer',flexShrink:0}}><RefreshCw size={14}/></button>}
  </div>;
}

function Empty({icon:Icon,msg}) {
  return <div style={{textAlign:'center',padding:'48px 16px',color:T.textMuted}}><Icon size={32} color={T.textSubtle} style={{marginBottom:12}}/><p style={{fontSize:13.5,margin:0}}>{msg}</p></div>;
}

function Badge({label,color}) {
  const c = color||T.brand;
  return <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,background:`${c}1a`,color:c,border:`1px solid ${c}33`,whiteSpace:'nowrap'}}>{label}</span>;
}

function StatCard({icon:Icon,label,value,accent}) {
  return <Card style={{padding:16,flex:1,minWidth:140}}>
    <div style={{width:32,height:32,borderRadius:8,background:`${accent}1a`,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:10}}>
      <Icon size={16} color={accent} strokeWidth={2.2}/>
    </div>
    <div style={{fontSize:20,fontWeight:700,color:T.ink,lineHeight:1.2}}>{value}</div>
    <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{label}</div>
  </Card>;
}

// ─── Login ───────────────────────────────────────────────────────
function Login({onLogin}) {
  const [sub,setSub]=useState('');
  const [tok,setTok]=useState('');
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState('');

  const go = async () => {
    setErr('');
    if(!sub.trim()||!tok.trim()){setErr('Sous-domaine et token requis.');return;}
    setLoading(true);
    const s = buildSubdomain(sub);
    try {
      await api(s,tok.trim(),'/v3/countries');
      onLogin({subdomain:s,token:tok.trim()});
    } catch(e) {
      setErr(e.message==='Failed to fetch'?'Impossible de joindre le proxy.':e.message);
    } finally { setLoading(false); }
  };

  return <div style={{minHeight:'100vh',background:`linear-gradient(160deg,${T.brandSubtle} 0%,${T.surface} 60%)`,display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:"'Roboto','Helvetica Neue',Arial,sans-serif"}}>
    <div style={{width:'100%',maxWidth:380}}>
      <div style={{textAlign:'center',marginBottom:32}}>
        <div style={{width:56,height:56,borderRadius:16,background:`linear-gradient(135deg,${T.brand},${T.brandLight})`,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',boxShadow:'0 12px 32px rgba(0,179,181,0.25)'}}>
          <Calendar color="#fff" size={28} strokeWidth={2.2}/>
        </div>
        <h1 style={{fontSize:22,fontWeight:700,color:T.ink,margin:0}}>Lab-event</h1>
        <p style={{fontSize:13,color:T.textMuted,margin:'4px 0 0'}}>Espace client — événements & devis</p>
      </div>
      <Card style={{padding:24}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Sous-domaine</label>
        <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
          <input value={sub} onChange={e=>setSub(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="mon-entreprise"
            style={{flex:1,minHeight:44,padding:'0 12px',border:`1px solid ${T.border}`,borderRadius:'8px 0 0 8px',fontSize:14,color:T.ink,outline:'none'}}/>
          <span style={{minHeight:44,display:'flex',alignItems:'center',padding:'0 12px',background:T.surfaceMuted,border:`1px solid ${T.border}`,borderLeft:'none',borderRadius:'0 8px 8px 0',fontSize:13,color:T.textMuted}}>.lab-event.com</span>
        </div>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Token API</label>
        <input type="password" value={tok} onChange={e=>setTok(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="••••••••••••••••"
          style={{width:'100%',minHeight:44,padding:'0 12px',marginBottom:20,border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box'}}/>
        {err&&<div style={{display:'flex',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 12px',marginBottom:16,fontSize:12.5,color:T.danger,lineHeight:1.5,whiteSpace:'pre-wrap'}}>
          <AlertCircle size={16} style={{flexShrink:0,marginTop:1}}/><span>{err}</span></div>}
        <button onClick={go} disabled={loading} style={{width:'100%',minHeight:44,borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,boxShadow:'0 4px 16px rgba(0,179,181,0.2)'}}>
          {loading&&<Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>}{loading?'Connexion…':'Se connecter'}
        </button>
      </Card>
      <p style={{textAlign:'center',fontSize:11.5,color:T.textSubtle,marginTop:16}}>Identifiants stockés uniquement sur cet appareil.</p>
    </div>
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
  </div>;
}

// ─── Dashboard ───────────────────────────────────────────────────
function Dashboard({session, onEventClick, onNavigate}) {
  const [events,setEvents]=useState(null);
  const [quotes,setQuotes]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);

  const load = useCallback(async()=>{
    setLoading(true);setErr('');
    try {
      const [e,q]=await Promise.all([
        apiCached(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{events_date_from:dateJ2Ans()}},d=>{setEvents(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}).then(d=>d),
        apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setQuotes(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}).then(d=>d),
      ]);
      setEvents(Array.isArray(e)?e:[]);
      setQuotes(Array.isArray(q)?q:[]);
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  },[session]);

  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const now=new Date();
  const thisMonth=new Date(now.getFullYear(),now.getMonth(),1);
  const last12m=new Date(now); last12m.setFullYear(last12m.getFullYear()-1);

  // Events
  const upcoming=(events||[]).filter(e=>e.events_date_from&&new Date(e.events_date_from)>=now).sort((a,b)=>new Date(a.events_date_from)-new Date(b.events_date_from));
  const won=(events||[]).filter(e=>e.win_lost==='Gagné').length;
  const lost=(events||[]).filter(e=>e.win_lost==='Perdu').length;
  const inProgress=(events||[]).filter(e=>!e.win_lost||e.win_lost==='En cours'||e.win_lost==='En Cours').length;

  // Quotes
  const pending=(quotes||[]).filter(q=>!/sign|annul|rejet/i.test(q.status||''));
  const allSigned=(quotes||[]).filter(q=>/^sign[ée]/i.test(q.status||''));

  // CA HT des 12 derniers mois par date d'événement
  const signed12m=allSigned.filter(q=>q.date_of_event&&new Date(q.date_of_event)>=last12m);
  const ca12mHT=signed12m.reduce((s,q)=>s+(Number(q.total_ht)||0),0);

  // CA HT ce mois par date d'émission du devis (pas de date_signed dans l'API)
  const signedThisMonth=allSigned.filter(q=>q.date_of_quote&&new Date(q.date_of_quote)>=thisMonth);
  const caThisMonthHT=signedThisMonth.reduce((s,q)=>s+(Number(q.total_ht)||0),0);

  // KPI cards
  const kpis=[
    {label:'À venir', value:upcoming.length, accent:T.brand, icon:Calendar, hint:'events', onClick:()=>onNavigate&&onNavigate('events')},
    {label:'Devis en cours', value:pending.length, accent:T.warning, icon:FileText, hint:'finances', onClick:()=>onNavigate&&onNavigate('finances-devis')},
    {label:'CA HT signé 12 mois', value:money(ca12mHT), accent:T.success, icon:Euro, hint:'Par date événement', onClick:()=>onNavigate&&onNavigate('rentabilite')},
    {label:'CA HT signé ce mois', value:money(caThisMonthHT), accent:T.info, icon:Euro, hint:'Par date devis', onClick:()=>onNavigate&&onNavigate('finances-signes-mois')},
  ];

  return <div style={{padding:16}}>
    {/* KPIs cliquables */}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
      {kpis.map((k,i)=><button key={i} onClick={k.onClick} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:'12px 14px',textAlign:'left',cursor:k.onClick?'pointer':'default',transition:'all 0.15s',display:'flex',flexDirection:'column',gap:4}} onMouseEnter={e=>{if(k.onClick)e.currentTarget.style.borderColor=T.brand;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;}}>
        <k.icon size={16} color={k.accent}/>
        <div style={{fontSize:17,fontWeight:700,color:k.accent,lineHeight:1.2}}>{k.value}</div>
        <div style={{fontSize:11.5,color:T.ink,fontWeight:500}}>{k.label}</div>
        {k.onClick&&<div style={{fontSize:10,color:T.textSubtle,display:'flex',alignItems:'center',gap:3,marginTop:2}}>Voir →</div>}
      </button>)}
    </div>

    {/* Pipeline */}
    <div style={{display:'flex',gap:8,marginBottom:16}}>
      {[{label:'En cours',val:inProgress,color:T.info},{label:'Gagnés',val:won,color:T.success},{label:'Perdus',val:lost,color:T.danger}].map(p=><div key={p.label} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 8px',textAlign:'center'}}>
        <div style={{fontSize:18,fontWeight:700,color:p.color}}>{p.val}</div>
        <div style={{fontSize:11,color:T.textMuted}}>{p.label}</div>
      </div>)}
    </div>

    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'0 0 10px'}}>
      <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:0}}>Prochains événements</h2>
      {upcoming.length>5&&<button onClick={()=>onNavigate&&onNavigate('events')} style={{background:'none',border:'none',cursor:'pointer',fontSize:12,color:T.brand,fontWeight:500}}>Voir les {upcoming.length} →</button>}
    </div>
    {upcoming.length===0?<Empty icon={Calendar} msg="Aucun événement à venir."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {upcoming.slice(0,5).map((ev,i)=><EventRow key={ev.event_id||i} event={ev} onClick={()=>onEventClick(ev)}/>)}
        {upcoming.length>5&&<button onClick={()=>onNavigate&&onNavigate('events')} style={{width:'100%',padding:'10px',borderRadius:10,border:`1px dashed ${T.border}`,background:'none',cursor:'pointer',fontSize:12.5,color:T.textMuted,fontWeight:500}}>+ {upcoming.length-5} événement{upcoming.length-5>1?'s':''} à venir — Voir tout</button>}
      </div>}
  </div>;
}

function EventRow({event,onClick}) {
  const wl=event.win_lost;
  const wlColor=wl==='Gagné'?T.success:wl==='Perdu'?T.danger:wl==='En cours'?T.info:T.warning;
  return <Card onClick={onClick} style={{padding:14,display:'flex',alignItems:'center',gap:12}}>
    <div style={{width:40,height:40,borderRadius:10,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
      <Calendar size={18} color={T.brand} strokeWidth={2.2}/>
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{event.event_name||'Événement sans nom'}</div>
      {(event.company_name||event.customer)&&<div style={{fontSize:12,color:T.brand,fontWeight:500,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{event.company_name||event.customer}</div>}
      <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
        <span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{date(event.events_date_from)}{event.events_date_to&&date(event.events_date_to)!==date(event.events_date_from)?` → ${date(event.events_date_to)}`:''}</span>
        {event.number_of_persons?<span style={{display:'flex',alignItems:'center',gap:3}}><Users size={11}/>{event.number_of_persons}</span>:null}
        {event.quotes_sell_price_sign?<span style={{color:T.success,fontWeight:600}}>{money(event.quotes_sell_price_sign)}</span>:null}
        {wl?<Badge label={wl} color={wlColor}/>:null}
      </div>
    </div>
    <ChevronRight size={16} color={T.textSubtle}/>
  </Card>;
}

// ─── Sticky back header ──────────────────────────────────────────
function BackHeader({title, subtitle, onBack, badge}) {
  return <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 16px',position:'sticky',top:0,zIndex:8,display:'flex',alignItems:'center',gap:10,minHeight:52,boxShadow:'0 2px 8px rgba(16,24,40,0.04)'}}>
    <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:T.brand,display:'flex',alignItems:'center',gap:4,fontSize:13,fontWeight:600,flexShrink:0,padding:'12px 0'}}>
      <ChevronLeft size={18}/> Retour
    </button>
    <div style={{width:1,height:20,background:T.border,flexShrink:0}}/>
    {title&&<div style={{flex:1,minWidth:0,overflow:'hidden'}}>
      <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</div>
      {subtitle&&<div style={{fontSize:11,color:T.textMuted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{subtitle}</div>}
    </div>}
    {badge&&<div style={{flexShrink:0}}>{badge}</div>}
  </div>;
}

// ─── Event Detail ────────────────────────────────────────────────
function EventDetail({event, onBack, session, onCompanyClick}) {
  const [docTab, setDocTab] = useState('devis');
  const wl=event.win_lost;
  const wlColor=wl==='Gagné'?T.success:wl==='Perdu'?T.danger:T.warning;
  const fields=[
    {label:'Date début',value:date(event.events_date_from)||'—',alwaysShow:true},
    {label:'Date fin',value:date(event.events_date_to)||'—',alwaysShow:true},
    {label:'Personnes',value:event.number_of_persons},
    {label:'Société',value:event.company_name||event.customer},
    {label:'Contact',value:event.contact_name},
    {label:'Email',value:event.client_email},
    {label:'Téléphone',value:event.client_phone},
    {label:'Commercial',value:event.nickname||event.member},
    {label:'Résultat',value:event.win_lost},
    {label:'Probabilité',value:event.percentage_success!=null?`${event.percentage_success}%`:null},
    {label:'Lieu',value:event.place},
    {label:'Type',value:event.event_type},
    {label:'Source',value:event.source_name||event.source},
    {label:'Catégorie',value:event.event_category},
    {label:'Code',value:event.incremental_code},
    {label:'Prestation',value:event.main_product},
  ].filter(f=>f.alwaysShow||(f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value)));

  // Load related docs from cache using incremental_code as link
  const code = String(event.incremental_code||'');
  const relatedQuotes = (() => {
    try {
      const k = Object.keys(localStorage).find(k => k.includes('quotes'));
      return k ? cacheArr(k).filter(q => String(q.incremental_code)===code) : [];
    } catch { return []; }
  })().sort((a,b) => new Date(b.date_of_quote||0) - new Date(a.date_of_quote||0));

  const relatedBills = (() => {
    try {
      const k = Object.keys(localStorage).find(k => k.includes('bills'));
      return k ? cacheArr(k).filter(b => String(b.incremental_code)===code) : [];
    } catch { return []; }
  })().sort((a,b) => new Date(b.date||0) - new Date(a.date||0));

  const relatedPayments = (() => {
    try {
      const k = Object.keys(localStorage).find(k => k.includes('prepayments'));
      const billIds = new Set(relatedBills.map(b => String(b.bill_id||b.id)));
      return k ? cacheArr(k).filter(p => billIds.has(String(p.bill_id||''))) : [];
    } catch { return []; }
  })().sort((a,b) => new Date(b.prepayment_date||0) - new Date(a.prepayment_date||0));

  const [schedulerData,setSchedulerData]=useState(null);
  const [schedulerLoading,setSchedulerLoading]=useState(false);
  const [schedulerErr,setSchedulerErr]=useState('');
  const [selectedDoc,setSelectedDoc]=useState(null); // {type:'quote'|'bill', data}

  const relatedActivities = (() => {
    try {
      const k = Object.keys(localStorage).find(k => k.includes('activity'));
      const evName = (event.event_name||'').toLowerCase();
      return k ? cacheArr(k)
        .filter(a => (a.event_name||'').toLowerCase()===evName)
        .sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)) : [];
    } catch { return []; }
  })();

  const docTabs = [
    {k:'devis', label:`Devis (${relatedQuotes.length})`},
    {k:'factures', label:`Factures (${relatedBills.length})`},
    {k:'paiements', label:`Paiements (${relatedPayments.length})`},
    {k:'activites', label:`Activités (${relatedActivities.length})`},
    {k:'planning', label:'Planning'},
  ];

  // Recherche paginée dans vue-planning (l'API ne filtre pas fiablement par date, voir Planning
  // salles) : on parcourt les pages et on garde uniquement les lignes de CET événement.
  useEffect(()=>{
    if(docTab!=='planning'||schedulerData!==null||schedulerLoading) return;
    setSchedulerLoading(true);setSchedulerErr('');
    const code=String(event.incremental_code||'');
    const evName=(event.event_name||'').toLowerCase().trim();
    const filterFn=r=>
      (code&&String(r.incremental_code)===code)||
      (evName&&(r.event_name||'').toLowerCase().trim()===evName);
    (async()=>{
      try{
        const MAX_PAGES=25;
        let matches=[]; let page=1;
        while(page<=MAX_PAGES){
          const batch=await api(session.subdomain,session.token,'/v3/analytics/events/vue-planning',{method:'POST',body:{date_from:dateJ2Ans(),page}});
          const arr=Array.isArray(batch)?batch:(batch?.data||[]);
          if(arr.length===0) break;
          const found=arr.filter(filterFn);
          matches=matches.concat(found);
          if(found.length>0||arr.length<2000) break; // trouvé, ou dernière page atteinte
          page++;
        }
        setSchedulerData(matches.sort((a,b)=>new Date(a.start_at||0)-new Date(b.start_at||0)));
      }catch(e){setSchedulerErr(e.message);}
      finally{setSchedulerLoading(false);}
    })();
  },[docTab, event, session]);

  if(selectedDoc?.type==='quote') return <QuoteDetail quote={selectedDoc.data} session={session} onBack={()=>setSelectedDoc(null)} onCompanyClick={onCompanyClick}/>;
  if(selectedDoc?.type==='bill') return <BillDetail bill={selectedDoc.data} session={session} onBack={()=>setSelectedDoc(null)} onCompanyClick={onCompanyClick}/>;

  return <div>
    <BackHeader title={event.event_name||'Événement'} subtitle={event.company_name||event.customer} onBack={onBack} badge={wl?<Badge label={wl} color={wlColor}/>:null}/>
    <div style={{padding:'20px 16px 8px'}}>
      {event.status_name&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        <Badge label={event.status_name} color={T.brand}/>
      </div>}
      {/* CA Cards */}
      {[money(event.quotes_sell_price_sign),money(event.quotes_sell_price),money(event.total_marge)].some(v=>v!=='—')&&<div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[
          {label:'CA signé HT',value:money(event.quotes_sell_price_sign),accent:T.success},
          {label:'CA total HT',value:money(event.quotes_sell_price),accent:T.brand},
          {label:'Marge',value:money(event.total_marge),accent:T.info},
        ].filter(f=>f.value!=='—').map((f,i)=><div key={i} style={{flex:1,minWidth:90,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted,marginBottom:2}}>{f.label}</div>
          <div style={{fontSize:13.5,fontWeight:700,color:f.accent}}>{f.value}</div>
        </div>)}
      </div>}

      {/* Infos event */}
      <Card style={{marginBottom:16}}>
        {fields.map((f,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 16px',borderBottom:i<fields.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          {(f.label==='Email'&&f.value&&f.value!=='null')?<a href={`mailto:${f.value}`} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{f.value}</a>
          :(f.label==='Téléphone'&&f.value&&f.value!=='null')?<a href={`tel:${f.value}`} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{f.value}</a>
          :f.label==='Société'?<button onClick={()=>{const k=Object.keys(localStorage).find(k=>k.includes('customer_company'));const cos=k?cacheArr(k):[];const co=cos.find(x=>(x.name||'').toLowerCase()===(f.value||'').toLowerCase());if(co&&onCompanyClick)onCompanyClick(co);}} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:T.brand,padding:0}}>{safeStr(f.value)}</button>
          :<span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{safeStr(f.value)}</span>}
        </div>)}
      </Card>
    </div>

    {/* Onglets Devis / Factures / Paiements */}
    <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,background:T.surface,display:'flex',position:'sticky',top:52,zIndex:7}}>
      {docTabs.map(t=><button key={t.k} onClick={()=>setDocTab(t.k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 4px',fontSize:12,fontWeight:docTab===t.k?600:400,color:docTab===t.k?T.brand:T.textMuted,borderBottom:docTab===t.k?`2px solid ${T.brand}`:'2px solid transparent'}}>{t.label}</button>)}
    </div>

    <div style={{padding:'12px 16px 32px'}}>
      {/* Devis */}
      {docTab==='devis'&&(relatedQuotes.length===0
        ?<Empty icon={FileText} msg="Aucun devis pour cet événement."/>
        :<div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relatedQuotes.map((q,i)=><Card key={i} onClick={()=>setSelectedDoc({type:'quote',data:q})} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{q.title||q.nb||'Devis'}</div>
                <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{q.nb} · {date(q.date_of_quote)}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(q.total_ht||q.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
                {q.status&&<Badge label={q.status} color={/sign/i.test(q.status)?T.success:/rejet|annul/i.test(q.status)?T.danger:T.warning}/>}
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Factures */}
      {docTab==='factures'&&(relatedBills.length===0
        ?<Empty icon={Receipt} msg="Aucune facture pour cet événement."/>
        :<div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relatedBills.map((b,i)=><Card key={i} onClick={()=>setSelectedDoc({type:'bill',data:b})} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{b.title||b.nb||'Facture'}</div>
                <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{b.nb} · {date(b.date)}</div>
                {b.contact_name&&<div style={{fontSize:12,color:T.textMuted}}>{b.contact_name}</div>}
              </div>
              <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(b.total_ht||b.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
                {b.status&&<Badge label={b.status} color={/pay[ée]/i.test(b.status)?T.success:/annul/i.test(b.status)?T.danger:T.warning}/>}
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Paiements */}
      {docTab==='paiements'&&(relatedPayments.length===0
        ?<Empty icon={CreditCard} msg="Aucun paiement pour cet événement."/>
        :<div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relatedPayments.map((p,i)=><Card key={i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{p.bill_number||'Paiement'}</div>
                <div style={{fontSize:12,color:T.textMuted}}>{date(p.prepayment_date)} · {p.payment_type||'—'}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:13.5,fontWeight:700,color:T.success}}>{money(p.prepayment_amount)}</div>
                {p.remaining_balance!=null&&<div style={{fontSize:11,color:T.textMuted}}>Reste : {money(p.remaining_balance)}</div>}
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Activités */}
      {docTab==='activites'&&(relatedActivities.length===0
        ?<Empty icon={Activity} msg="Aucune activité pour cet événement."/>
        :<div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relatedActivities.map((a,i)=><Card key={i} style={{padding:12}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:(()=>{const t=new Date();t.setHours(0,0,0,0);const s=new Date(t);s.setDate(s.getDate()+30);const exp=!!a.deadline&&new Date(a.deadline)<t;const son=!!a.deadline&&new Date(a.deadline)>=t&&new Date(a.deadline)<=s;return exp?T.danger:son?T.warning:T.success;})(),marginTop:5,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{a.type||'Activité'} {a.category?`· ${a.category}`:''}</div>
                  {a.status&&<Badge label={a.status} color={T.info}/>}
                </div>
                {a.corporation_client_name&&<div style={{fontSize:12,color:T.brand,fontWeight:500,marginTop:2}}>{a.corporation_client_name}</div>}
                {a.comment&&<div style={{fontSize:12,color:T.textMuted,marginTop:4,lineHeight:1.5,borderLeft:`2px solid ${T.border}`,paddingLeft:6}}>{strip(a.comment).slice(0,120)}{strip(a.comment).length>120?'…':''}</div>}
                <div style={{fontSize:11,color:T.textSubtle,marginTop:4,display:'flex',gap:8,flexWrap:'wrap'}}>
                  {a.date&&<span><Clock size={10}/> {date(a.date)}</span>}
                  {a.deadline&&<span style={{color:(()=>{const t=new Date();t.setHours(0,0,0,0);return !!a.deadline&&new Date(a.deadline)<t;})() ?T.danger:T.textSubtle}}>{ (()=>{const t=new Date();t.setHours(0,0,0,0);return !!a.deadline&&new Date(a.deadline)<t;})()?'⚠ ':''}Échéance : {date(a.deadline)}</span>}
                </div>
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Planning / Scheduler */}
      {docTab==='planning'&&(
        schedulerLoading?<div style={{textAlign:'center',padding:32}}><Loader2 size={20} color={T.brand} style={{animation:'spin 1s linear infinite'}}/></div>
        :schedulerErr?<ErrBanner msg={schedulerErr}/>
        :(!schedulerData||schedulerData.length===0)?<Empty icon={Calendar} msg="Aucune réservation de salle trouvée pour cet événement."/>
        :<div style={{display:'flex',flexDirection:'column',gap:8}}>
          {schedulerData.map((r,i)=>{
            const room=r.room_name||r.product_real_name||(r.name&&r.name.trim())||'Salle sans nom';
            const hasAssembly=r.assembly_client_enabled||r.assembly_intern_enabled;
            const hasDisassembly=r.disassembly_client_enabled||r.disassembly_intern_enabled;
            return <Card key={i} style={{padding:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:hasAssembly||hasDisassembly?8:0}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{room}</div>
                  <div style={{fontSize:12,color:T.textMuted,marginTop:3,display:'flex',gap:8,flexWrap:'wrap'}}>
                    {r.start_at&&<span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{r.start_at.substring(0,16).replace('T',' ')}</span>}
                    {r.end_at&&r.end_at!==r.start_at&&<span>→ {r.end_at.substring(11,16)}</span>}
                    {r.number_of_persons?<span style={{display:'flex',alignItems:'center',gap:3}}><Users size={11}/>{r.number_of_persons}</span>:null}
                  </div>
                </div>
                {r.status_name&&<Badge label={r.status_name} color={r.status_color||T.brand}/>}
              </div>
              {/* Montage / Démontage */}
              {hasAssembly&&<div style={{fontSize:11.5,color:T.info,marginTop:6,display:'flex',gap:6,flexWrap:'wrap'}}>
                <span style={{fontWeight:600}}>Montage :</span>
                {r.assembly_date_start_client&&<span>{r.assembly_date_start_client.substring(0,10)}</span>}
                {r.assembly_date_start_intern&&<span>(int. {r.assembly_date_start_intern.substring(0,10)})</span>}
              </div>}
              {hasDisassembly&&<div style={{fontSize:11.5,color:T.warning,marginTop:3,display:'flex',gap:6,flexWrap:'wrap'}}>
                <span style={{fontWeight:600}}>Démontage :</span>
                {r.disassembly_date_start_client&&<span>{r.disassembly_date_start_client.substring(0,10)}</span>}
              </div>}
              {(r.comment||r.room_configuration)&&<div style={{fontSize:11.5,color:T.textMuted,marginTop:4}}>
                {r.room_configuration&&<span>Config : {r.room_configuration} · </span>}
                {r.comment&&strip(r.comment).slice(0,80)}
              </div>}
            </Card>;
          })}
        </div>
      )}
    </div>
  </div>;
}

// ─── Events list ─────────────────────────────────────────────────
function Events({session, onCompanyClick, initialFilter={}}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [pipeline,setPipeline]=useState(initialFilter.pipeline||'');
  const [datePeriod,setDatePeriod]=useState(initialFilter.datePeriod||'');
  const [upcomingOnly,setUpcomingOnly]=useState(initialFilter.upcomingOnly||false);

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{events_date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]))});setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(selected) return <EventDetail event={selected} session={session} onBack={()=>setSelected(null)} onCompanyClick={onCompanyClick}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const _now=new Date();
  const sorted=[...(items||[])].sort((a,b)=>{
    const hasA=!!a.events_date_from, hasB=!!b.events_date_from;
    // Events without date → always at the bottom
    if(!hasA&&!hasB) return (a.event_name||'').localeCompare(b.event_name||'');
    if(!hasA) return 1;
    if(!hasB) return -1;
    const da=new Date(a.events_date_from), db=new Date(b.events_date_from);
    const af=da>=_now, bf=db>=_now;
    if(af&&!bf) return -1; // futur avant passé
    if(!af&&bf) return 1;
    if(af&&bf) return da-db; // futurs : le plus proche en premier
    return db-da; // passés : le plus récent en premier
  });
  const pipelines=[...new Set(sorted.map(e=>e.win_lost).filter(Boolean))];
  const now=new Date();
  const byDate=applyDateFilter(sorted,'events_date_from',datePeriod);
  const byUpcoming=upcomingOnly?byDate.filter(e=>e.events_date_from&&new Date(e.events_date_from)>=now):byDate;
  const filtered=byUpcoming.filter(e=>{
    const mQ=!q||(e.event_name||'').toLowerCase().includes(q)||(e.customer||'').toLowerCase().includes(q)||(e.company_name||'').toLowerCase().includes(q)||(e.contact_name||'').toLowerCase().includes(q)||(e.status_name||'').toLowerCase().includes(q)||(e.place||'').toLowerCase().includes(q);
    const mP=!pipeline||e.win_lost===pipeline;
    return mQ&&mP;
  });

  return <div style={{padding:'12px 16px 16px'}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom événement, client, lieu…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    {pipelines.length>0&&<div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
      <button onClick={()=>setPipeline('')} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${!pipeline?T.brand:T.border}`,background:!pipeline?T.brandTint:'none',color:!pipeline?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:!pipeline?600:400}}>Tous</button>
      {pipelines.map(p=><button key={p} onClick={()=>setPipeline(p===pipeline?'':p)} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${pipeline===p?T.brand:T.border}`,background:pipeline===p?T.brandTint:'none',color:pipeline===p?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:pipeline===p?600:400}}>{p}</button>)}
    </div>}
    {upcomingOnly&&<div style={{background:`${T.brand}12`,border:`1.5px solid ${T.brand}66`,borderRadius:8,padding:'8px 12px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12.5}}><span style={{color:T.brand,fontWeight:600}}>📅 Événements à venir uniquement</span><button onClick={()=>setUpcomingOnly(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,fontSize:12,padding:'0 4px'}}>✕ Tout voir</button></div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} événement{filtered.length>1?'s':''}{(q||pipeline||datePeriod||upcomingOnly)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={Calendar} msg={q?"Aucun résultat.":"Aucun événement."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((ev,i)=><EventRow key={ev.event_id||i} event={ev} onClick={()=>setSelected(ev)}/>)}
      </div>}
  </div>;
}

// ─── Planning ────────────────────────────────────────────────────
function Planning({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [truncated,setTruncated]=useState(false);

  const [search,setSearch]=useState('');

  // Même souci que Planning par jour : l'API renvoie son historique depuis le début, plafonné
  // à 2000 lignes par page, donc date_from seul ne suffit pas à atteindre les dates futures.
  // On paginate jusqu'à croiser des réservations proches d'aujourd'hui.
  const load=useCallback(async()=>{
    setLoading(true);setErr('');setTruncated(false);
    try{
      const threshold=new Date(); threshold.setDate(threshold.getDate()-3); threshold.setHours(0,0,0,0);
      const MAX_PAGES=25;
      let all=[]; let page=1; let reachedRecent=false; let lastBatchSize=0;
      while(page<=MAX_PAGES){
        const batch=await api(session.subdomain,session.token,'/v3/analytics/events/vue-planning',{method:'POST',body:{date_from:dateJ2Ans(),page}});
        const arr=Array.isArray(batch)?batch:(batch?.data||[]);
        lastBatchSize=arr.length;
        if(arr.length===0) break;
        all=all.concat(arr);
        reachedRecent=arr.some(r=>(r.end_at||r.start_at)&&new Date(r.end_at||r.start_at)>=threshold);
        if(reachedRecent||arr.length<2000) break;
        page++;
      }
      if(!reachedRecent&&lastBatchSize>=2000) setTruncated(true);
      setItems(all);
    }
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const threshold=new Date(); threshold.setDate(threshold.getDate()-3); threshold.setHours(0,0,0,0);
  // On ne garde que les réservations en cours ou à venir (fin >= seuil)
  const future=(items||[]).filter(r=>(r.end_at||r.start_at)&&new Date(r.end_at||r.start_at)>=threshold);
  const sorted=[...future].sort((a,b)=>new Date(a.start_at||0)-new Date(b.start_at||0));
  const filtered=q?sorted.filter(i=>
    (i.event_name||'').toLowerCase().includes(q)||
    (i.room_name||'').toLowerCase().includes(q)||
    (i.status_name||'').toLowerCase().includes(q)
  ):sorted;

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom événement, salle…"/>
    {truncated&&<div style={{background:`${T.warning}12`,border:`1.5px solid ${T.warning}66`,borderRadius:8,padding:'8px 12px',marginBottom:10,fontSize:12,color:T.warning,lineHeight:1.5}}>
      ⚠ L'historique est trop volumineux : la limite de pages a été atteinte avant de rejoindre les réservations récentes. Certaines peuvent manquer — réessayer ou contacter le support si le problème persiste.
    </div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} réservation{filtered.length>1?'s':''}{q?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={Calendar} msg={q?"Aucun résultat.":"Aucune réservation à venir."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((item,i)=>{
          const room=item.room_name||item.product_real_name||item.name;
          const client=[item.customer_name,item.customer_last_name].filter(Boolean).join(' ')||item.company_name;
          const timeStr=item.start_at&&item.end_at?`${dateTime(item.start_at).split(' ').slice(1).join(' ')} → ${dateTime(item.end_at).split(' ').slice(1).join(' ')}`:date(item.start_at);
          return <Card key={item.schedule_id||i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.event_name||'Sans nom'}</div>
                {room&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:4,marginBottom:1,padding:'3px 9px 3px 7px',borderRadius:7,background:T.brandTint,maxWidth:'100%'}}><MapPin size={14} color={T.brandStrong} style={{flexShrink:0}}/><span style={{fontSize:14,fontWeight:700,color:T.brandStrong,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{room}</span></div>}
                {client&&<div style={{fontSize:12,color:T.brand,fontWeight:500,marginTop:1}}>{client}</div>}
                <div style={{fontSize:12,color:T.textMuted,marginTop:3,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  {date(item.start_at)&&<span style={{display:'flex',alignItems:'center',gap:3}}><Calendar size={11}/>{date(item.start_at)}</span>}
                  {item.start_at&&<span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{item.start_at.substring(11,16)} → {(item.end_at||'').substring(11,16)}</span>}
                  {item.number_of_persons?<span style={{display:'flex',alignItems:'center',gap:3}}><Users size={11}/>{item.number_of_persons}</span>:null}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end',flexShrink:0}}>
                {item.status_name&&<Badge label={item.status_name} color={item.status_color||T.brand}/>}
                {item.total_goods?<span style={{fontSize:10.5,color:T.textMuted}}>{item.total_goods} prestation{item.total_goods>1?'s':''}</span>:null}
              </div>
            </div>
          </Card>;
        })}
      </div>}
  </div>;
}

// ─── Date Filter ─────────────────────────────────────────────────
function DateFilter({value, onChange}) {
  const opts=[
    {k:'30d', label:'30 j'},
    {k:'90d', label:'90 j'},
    {k:'6m', label:'6 mois'},
    {k:'year', label:'1 an'},
    {k:'', label:'2 ans'},
  ];
  return <div style={{display:'flex',gap:5,marginBottom:10}}>
    {opts.map(o=><button key={o.k||'all'} onClick={()=>onChange(o.k)} style={{flex:1,padding:'5px 4px',borderRadius:8,border:`1.5px solid ${value===o.k?T.brand:T.border}`,background:value===o.k?T.brandTint:'none',color:value===o.k?T.brand:T.textMuted,fontSize:11.5,cursor:'pointer',fontWeight:value===o.k?600:400}}>{o.label}</button>)}
  </div>;
}
function applyDateFilter(items, dateField, period) {
  if (!period) return items;
  const now = new Date();
  let from = new Date(now);
  if (period==='30d') from.setDate(from.getDate()-30);
  else if (period==='90d') from.setDate(from.getDate()-90);
  else if (period==='6m') from.setMonth(from.getMonth()-6);
  else if (period==='year'||period==='12m') from.setFullYear(from.getFullYear()-1);
  // Legacy calendar periods
  else if (period==='month') { from=new Date(now.getFullYear(),now.getMonth(),1); }
  else if (period==='quarter') { from=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1); }
  else return items;
  return items.filter(i=>i[dateField]&&new Date(i[dateField])>=from);
}

// ─── Finances ────────────────────────────────────────────────────
function Finances({session, initialFilter={}, onCompanyClick, onEventClick}) {
  const [sub,setSub]=useState(initialFilter.sub||'quotes');
  const [quotesFilter]=useState(initialFilter.quotesFilter||{});
  const [inDetail,setInDetail]=useState(false);
  const tabs=[{k:'quotes',label:'Devis'},{k:'bills',label:'Factures'},{k:'payments',label:'Paiements'}];
  return <div>
    {!inDetail&&<div style={{display:'flex',borderBottom:`1px solid ${T.border}`,background:T.surface,position:'sticky',top:0,zIndex:5}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setSub(t.k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'12px 8px',fontSize:13,fontWeight:sub===t.k?600:400,color:sub===t.k?T.brand:T.textMuted,borderBottom:sub===t.k?`2px solid ${T.brand}`:'2px solid transparent',transition:'all 0.18s'}}>{t.label}</button>)}
    </div>}
    {sub==='quotes'&&<Quotes session={session} onDetailChange={setInDetail} initialFilter={quotesFilter} onCompanyClick={onCompanyClick} onEventClick={onEventClick}/>}
    {sub==='bills'&&<Bills session={session} onDetailChange={setInDetail} onCompanyClick={onCompanyClick} onEventClick={onEventClick}/>}
    {sub==='payments'&&<Payments session={session}/>}
  </div>;
}


function dateAroundEvent(d, daysBefore=30) {
  const dt = new Date(d || new Date());
  dt.setDate(dt.getDate() - daysBefore);
  return dt.toISOString().split('T')[0];
}
// ─── Quote Detail ─────────────────────────────────────────────────
function safeStr(v) {
  if (v == null) return '';
  if (v === 'null' || v === 'undefined') return ''; // API sometimes returns string "null"
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function QuoteDetail({quote:q, session, onBack, onEventClick, onCompanyClick}) {
  const [lines,setLines]=useState(null);
  const [renta,setRenta]=useState(null);
  const [loadingLines,setLoadingLines]=useState(true);

  useEffect(()=>{
    // Load lines from vue-analytics-light filtered by document_id
    // Use narrow date range around the event date to get the right document
    const qDateFrom = dateAroundEvent(q.date_of_event||q.date_of_quote||q.date, 60);
    const docIds=new Set([String(q.id),String(q.quote_id)].filter(Boolean));
    Promise.all([
      api(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:qDateFrom,per_page:9999}}).catch(()=>null),
      api(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:qDateFrom}}).catch(()=>null),
    ]).then(([analytics,rentability])=>{
      if(Array.isArray(analytics)) setLines(analytics.filter(l=>docIds.has(String(l.document_id))));
      if(Array.isArray(rentability)) setRenta(rentability.filter(r=>docIds.has(String(r.document_id))));
      setLoadingLines(false);
    });
  },[q,session]);

  const statusColor = /sign/i.test(q.status||'')?T.success:/rejet|annul/i.test(q.status||'')?T.danger:T.warning;

  // Sections from the quote object itself (fallback)
  const sections = Array.isArray(q.sections) ? q.sections : [];

  const fields = [
    {label:'Numéro', value:safeStr(q.nb||q.incremental_code)},
    {label:'Date d\'émission', value:date(q.date_of_quote||q.date)},
    {label:'Date événement', value:date(q.date_of_event)},
    {label:'Client', value:safeStr(q.customer)},
    {label:'Événement', value:safeStr(q.event)},
    {label:'Statut événement', value:formatEventState(q.event_state)&&safeStr(q.event_state)},
    {label:'Commercial', value:safeStr(q.owner||q.member)},
    {label:'Chef de projet', value:safeStr(q.pm)},
    {label:'Prestation principale', value:safeStr(q.main_product)},
    {label:'TVA', value:formatVAT(q.vat_rates)},
  ].filter(f=>f.alwaysShow||(f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value)));

  return <div>
    <BackHeader title={q.title||q.event||'Devis'} subtitle={q.nb} onBack={onBack} badge={q.status?<Badge label={q.status} color={statusColor}/>:null}/>
    <div style={{padding:'20px 16px 24px'}}>

      {/* Montants */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[
          {label:'HT', value:money(q.total_ht), accent:T.ink},
          {label:'TTC', value:money(q.ttc), accent:T.brand},
          {label:'Marge', value:money(q.total_marge), accent:T.success},
          {label:'Commission', value:money(q.total_com), accent:T.info},
        ].filter(f=>f.value!=='—').map((f,i)=><div key={i} style={{flex:1,minWidth:80,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>{f.label}</div>
          <div style={{fontSize:14,fontWeight:700,color:f.accent}}>{f.value}</div>
        </div>)}
      </div>

      {/* Lignes du devis */}
      <h2 style={{fontSize:13,fontWeight:700,color:T.ink,margin:'0 0 8px',textTransform:'uppercase',letterSpacing:'0.4px'}}>
        Lignes {loadingLines&&<Loader2 size={12} color={T.textMuted} style={{animation:'spin 1s linear infinite',verticalAlign:'middle'}}/>}
      </h2>
      {!loadingLines&&lines&&lines.length>0&&<div style={{display:'flex',flexDirection:'column',gap:0,marginBottom:16}}>
        {Object.entries(lines.reduce((acc,l)=>{
          const section=l.product_name||'Articles';
          if(!acc[section]) acc[section]=[];
          acc[section].push(l);
          return acc;
        },{})).map(([section,items])=><div key={section} style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:'uppercase',letterSpacing:'0.5px',padding:'4px 0 6px'}}>{section}</div>
          <div style={{display:'flex',flexDirection:'column',gap:5}}>
            {items.map((l,i)=><Card key={i} style={{padding:'10px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:500,color:T.ink,flex:1}}>{l.good_name||l.product_name||'—'}</div>
                {Number(l.sell_price)>0&&<div style={{fontSize:13,fontWeight:700,color:T.brand,flexShrink:0}}>{money(l.sell_price)}</div>}
              </div>
            </Card>)}
          </div>
        </div>)}
      </div>}

      {/* Sections brutes si pas de lignes analytics */}
      {!loadingLines&&(!lines||lines.length===0)&&sections.length>0&&<div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:16}}>
        {sections.filter(s=>Number(s.sellPrice)>0||Number(s.price)>0).map((s,i)=><Card key={i} style={{padding:'10px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:500,color:T.ink}}>
              Ligne {i+1}

            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {Number(s.sellPrice)>0&&<div style={{fontSize:13,fontWeight:700,color:T.brand}}>{money(s.sellPrice)}</div>}
            </div>
          </div>
        </Card>)}
      </div>}

      {!loadingLines&&(!lines||lines.length===0)&&sections.length===0&&<div style={{fontSize:12.5,color:T.textMuted,marginBottom:16,padding:'12px 0'}}>Aucune ligne disponible.</div>}

      {/* Rentabilité par section */}
      {!loadingLines&&renta&&renta.length>0&&<>
        <h2 style={{fontSize:13,fontWeight:700,color:T.ink,margin:'16px 0 8px',textTransform:'uppercase',letterSpacing:'0.4px'}}>Rentabilité par section</h2>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
          {renta.map((r,i)=><Card key={i} style={{padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink,flex:1}}>{safeStr(r.goods_section)||'—'}</div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(r.sell_price)}</div>
                <div style={{fontSize:11.5,color:Number(r.margin)>=0?T.success:T.danger}}>
                  Marge : {money(r.margin)}
                  {r.sell_price&&Number(r.sell_price)>0?` (${((Number(r.margin)/Number(r.sell_price))*100).toFixed(0)}%)` :''}
                </div>
                {r.commission&&<div style={{fontSize:11.5,color:T.info}}>Comm. : {money(r.commission)}</div>}
              </div>
            </div>
          </Card>)}
        </div>
      </>}

      {/* Infos */}
      <Card style={{marginBottom:16}}>
        {fields.map((f,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'11px 16px',borderBottom:i<fields.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          {f.label==='Client'&&onCompanyClick?<button onClick={()=>{
            const k=Object.keys(localStorage).find(k=>k.includes('customer_company'));
            const cos=k?cacheArr(k):[];
            const co=cos.find(x=>(x.name||'').toLowerCase()===(f.value||'').toLowerCase());
            if(co) onCompanyClick(co);
          }} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:T.brand,padding:0,textAlign:'right'}}>{f.value}</button>
          :f.label==='Événement'&&onEventClick?<button onClick={()=>{
            const ev=findEventByName(session, f.value);
            if(ev) onEventClick(ev);
          }} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:T.brand,padding:0,textAlign:'right'}}>{f.value}</button>
          :<span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>}
        </div>)}
      </Card>

      {q.info&&<Card style={{padding:14}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>Notes</div>
        <div style={{fontSize:13,color:T.text,lineHeight:1.6}}>{strip(safeStr(q.info))}</div>
      </Card>}
    </div>
  </div>;
}

function Quotes({session, onDetailChange=()=>{}, initialFilter={}, onCompanyClick, onEventClick}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState(null);
  const [datePeriod,setDatePeriod]=useState(initialFilter.datePeriod||'');
  const [pendingOnly,setPendingOnly]=useState(initialFilter.pendingOnly||false);
  const [signedThisMonth,setSignedThisMonth]=useState(initialFilter.signedThisMonth||false);
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]))});setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ onDetailChange(!!selected); },[selected]);
  if(selected) return <QuoteDetail quote={selected} session={session} onBack={()=>setSelected(null)} onCompanyClick={onCompanyClick} onEventClick={onEventClick}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date_of_quote||0)-new Date(a.date_of_quote||0));
  const byDate=applyDateFilter(sorted,'date_of_quote',datePeriod);
  const byPending=pendingOnly?byDate.filter(q=>!/sign|annul|rejet/i.test(q.status||'')):byDate;
  const thisMonthStart=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  const bySignedMonth=signedThisMonth?byPending.filter(q=>/^sign[ée]/i.test(q.status||'')&&q.date_of_quote&&new Date(q.date_of_quote)>=thisMonthStart):byPending;
  const filtered=q?bySignedMonth.filter(d=>
    (d.title||'').toLowerCase().includes(q)||
    (d.event||'').toLowerCase().includes(q)||
    (d.nb||'').toLowerCase().includes(q)||
    (d.customer||'').toLowerCase().includes(q)||
    (d.status||'').toLowerCase().includes(q)
  ):bySignedMonth;
  return <div style={{padding:'12px 16px 16px'}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom, numéro, client, statut…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    {pendingOnly&&<div style={{background:`${T.warning}12`,border:`1.5px solid ${T.warning}66`,borderRadius:8,padding:'8px 12px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12.5}}><span style={{color:T.warning,fontWeight:600}}>📋 Devis en cours uniquement</span><button onClick={()=>setPendingOnly(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,fontSize:12,padding:'0 4px'}}>✕ Tout voir</button></div>}
    {signedThisMonth&&<div style={{background:`${T.success}12`,border:`1.5px solid ${T.success}66`,borderRadius:8,padding:'8px 12px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12.5}}><span style={{color:T.success,fontWeight:600}}>✅ Devis signés ce mois</span><button onClick={()=>setSignedThisMonth(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,fontSize:12,padding:'0 4px'}}>✕ Tout voir</button></div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} devis{(q||datePeriod||pendingOnly||signedThisMonth)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={FileText} msg={q?"Aucun résultat.":"Aucun devis."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((item,i)=><Card key={item.quote_id||i} onClick={()=>setSelected(item)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              {item.nb&&<div style={{fontSize:14,fontWeight:700,color:T.brandStrong,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.nb}</div>}
              <div style={{fontSize:13,fontWeight:600,color:T.ink,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.title||item.event||'Devis'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>Émis le {date(item.date_of_quote)}</div>
              {item.customer&&<div style={{fontSize:12,color:T.textMuted}}>{item.customer}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(item.total_ht)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
              {item.status&&<Badge label={item.status} color={/sign/i.test(item.status)?T.success:/rejet|annul/i.test(item.status)?T.danger:T.warning}/>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

function BillDetail({bill:b, session, onBack, onEventClick, onCompanyClick}) {
  const [lines,setLines]=useState(null);
  const [renta,setRenta]=useState(null);
  const [loadingLines,setLoadingLines]=useState(true);

  useEffect(()=>{
    const billDocIds=new Set([String(b.id),String(b.bill_id)].filter(Boolean));
    const bDateFrom = dateAroundEvent(b.date_of_event||b.date_of_bill||b.date, 60);
    Promise.all([
      api(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:bDateFrom,per_page:9999}}).catch(()=>null),
      api(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:bDateFrom}}).catch(()=>null),
    ]).then(([analytics,rentability])=>{
      if(Array.isArray(analytics)) setLines(analytics.filter(l=>billDocIds.has(String(l.document_id))));
      if(Array.isArray(rentability)) setRenta(rentability.filter(r=>billDocIds.has(String(r.document_id))));
      setLoadingLines(false);
    });
  },[b,session]);

  const statusColor=/pay[ée]/i.test(b.status||'')?T.success:/annul/i.test(b.status||'')?T.danger:T.warning;
  const fields=[
    {label:'Numéro', value:safeStr(b.nb)},
    {label:'Date facture', value:date(b.date_of_bill||b.date)},
    {label:'Date événement', value:date(b.date_of_event)},
    {label:'Client', value:safeStr(b.customer)},
    {label:'Contact', value:safeStr(b.contact_name)},
    {label:'Email', value:safeStr(b.contact_email)},
    {label:'Téléphone', value:safeStr(b.contact_phone||b.contact_portable_phone)},
    {label:'Événement', value:safeStr(b.event)},
    {label:'Commercial', value:safeStr(b.owner)},
    {label:'Chef de projet', value:safeStr(b.pm)},
  ].filter(f=>f.alwaysShow||(f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value)));

  return <div>
    <BackHeader title={b.title||b.event||'Facture'} subtitle={b.nb} onBack={onBack} badge={b.status?<Badge label={b.status} color={statusColor}/>:null}/>
    <div style={{padding:'20px 16px 24px'}}>
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[
          {label:'HT', value:money(b.total_ht), accent:T.ink},
          {label:'TTC', value:money(b.ttc), accent:T.brand},
          {label:'Marge', value:money(b.total_marge), accent:T.success},
          {label:'Commission', value:money(b.total_com), accent:T.info},
        ].filter(f=>f.value!=='—').map((f,i)=><div key={i} style={{flex:1,minWidth:80,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
          <div style={{fontSize:11,color:T.textMuted,marginBottom:2}}>{f.label}</div>
          <div style={{fontSize:14,fontWeight:700,color:f.accent}}>{f.value}</div>
        </div>)}
      </div>
      {/* Lignes */}
      <h2 style={{fontSize:13,fontWeight:700,color:T.ink,margin:'0 0 8px',textTransform:'uppercase',letterSpacing:'0.4px'}}>
        Lignes {loadingLines&&<Loader2 size={12} color={T.textMuted} style={{animation:'spin 1s linear infinite',verticalAlign:'middle'}}/>}
      </h2>
      {!loadingLines&&lines&&lines.length>0&&<div style={{display:'flex',flexDirection:'column',gap:0,marginBottom:16}}>
        {Object.entries(lines.reduce((acc,l)=>{
          const section=l.product_name||'Articles';
          if(!acc[section]) acc[section]=[];
          acc[section].push(l);
          return acc;
        },{})).map(([section,items])=><div key={section} style={{marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:'uppercase',letterSpacing:'0.5px',padding:'4px 0 6px'}}>{section}</div>
          <div style={{display:'flex',flexDirection:'column',gap:5}}>
            {items.map((l,i)=><Card key={i} style={{padding:'10px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}>
                <div style={{fontSize:13,fontWeight:500,color:T.ink,flex:1}}>{l.good_name||l.product_name||'—'}</div>
                {Number(l.sell_price)>0&&<div style={{fontSize:13,fontWeight:700,color:T.brand,flexShrink:0}}>{money(l.sell_price)}</div>}
              </div>
            </Card>)}
          </div>
        </div>)}
      </div>}
      {!loadingLines&&(!lines||lines.length===0)&&<div style={{fontSize:12.5,color:T.textMuted,marginBottom:16}}>Aucune ligne disponible.</div>}
      {/* Rentabilité */}
      {!loadingLines&&renta&&renta.length>0&&<>
        <h2 style={{fontSize:13,fontWeight:700,color:T.ink,margin:'0 0 8px',textTransform:'uppercase',letterSpacing:'0.4px'}}>Rentabilité</h2>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
          {renta.map((r,i)=><Card key={i} style={{padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink,flex:1}}>{safeStr(r.goods_section)||'—'}</div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(r.sell_price)}</div>
                <div style={{fontSize:11.5,color:Number(r.margin)>=0?T.success:T.danger}}>Marge : {money(r.margin)}{r.sell_price&&Number(r.sell_price)>0?` (${((Number(r.margin)/Number(r.sell_price))*100).toFixed(0)}%)`:''}
                </div>
              </div>
            </div>
          </Card>)}
        </div>
      </>}
      <Card>
        {fields.map((f,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'11px 16px',borderBottom:i<fields.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          {f.label==='Client'&&onCompanyClick?<button onClick={()=>{
            const k=Object.keys(localStorage).find(k=>k.includes('customer_company'));
            const cos=k?cacheArr(k):[];
            const co=cos.find(x=>(x.name||'').toLowerCase()===(f.value||'').toLowerCase());
            if(co) onCompanyClick(co);
          }} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:T.brand,padding:0,textAlign:'right'}}>{f.value}</button>
          :f.label==='Événement'&&onEventClick?<button onClick={()=>{
            const ev=findEventByName(session, f.value);
            if(ev) onEventClick(ev);
          }} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:600,color:T.brand,padding:0,textAlign:'right'}}>{f.value}</button>
          :<span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>}
        </div>)}
      </Card>
    </div>
  </div>;
}

function Bills({session, onDetailChange=()=>{}, onCompanyClick, onEventClick}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState(null);
  const [datePeriod,setDatePeriod]=useState('');
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/bills',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]))});setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ onDetailChange(!!selected); },[selected]);
  if(selected) return <BillDetail bill={selected} session={session} onBack={()=>setSelected(null)} onCompanyClick={onCompanyClick} onEventClick={onEventClick}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  const byDate=applyDateFilter(sorted,'date',datePeriod);
  const filtered=q?byDate.filter(b=>
    (b.event||'').toLowerCase().includes(q)||
    (b.customer||'').toLowerCase().includes(q)||
    (b.nb||'').toLowerCase().includes(q)||
    (b.contact_name||'').toLowerCase().includes(q)||
    (b.status||'').toLowerCase().includes(q)
  ):byDate;
  return <div style={{padding:'12px 16px 16px'}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Événement, client, numéro…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} facture{filtered.length>1?'s':''}{(q||datePeriod)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={Receipt} msg={q?"Aucun résultat.":"Aucune facture."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((b,i)=><Card key={b.bill_id||i} onClick={()=>setSelected(b)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              {b.nb&&<div style={{fontSize:14,fontWeight:700,color:T.brandStrong,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.nb}</div>}
              <div style={{fontSize:13,fontWeight:600,color:T.ink,marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.event||b.customer||'Facture'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>Facturé le {date(b.date)}</div>
              {b.customer&&<div style={{fontSize:12,color:T.textMuted}}>{b.customer}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(b.total_ht||b.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
              {b.status&&<Badge label={b.status} color={/pay[ée]/i.test(b.status)?T.success:/annul/i.test(b.status)?T.danger:T.warning}/>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

function Payments({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [datePeriod,setDatePeriod]=useState('');
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/bill-prepayments',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]))});setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.prepayment_date||0)-new Date(a.prepayment_date||0));
  const byDate=applyDateFilter(sorted,'prepayment_date',datePeriod);
  const filtered=q?byDate.filter(p=>
    (p.bill_number||'').toLowerCase().includes(q)||
    (p.payment_type||'').toLowerCase().includes(q)||
    (p.prepayment_info||'').toLowerCase().includes(q)
  ):byDate;
  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="N° facture, mode de paiement…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} paiement{filtered.length>1?'s':''}{(q||datePeriod)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={CreditCard} msg={q?"Aucun résultat.":"Aucun paiement."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((p,i)=><Card key={p.id||i} onClick={()=>setSelected(p)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{p.bill_number||'Paiement'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{date(p.prepayment_date)} · {p.payment_type||'—'}</div>
              {p.prepayment_info&&<div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{p.prepayment_info}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.success}}>{money(p.prepayment_amount)}</div>
              {p.remaining_balance!=null&&<div style={{fontSize:11,color:T.textMuted}}>Reste : {money(p.remaining_balance)}</div>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

// ─── Activités ───────────────────────────────────────────────────
function Activites({session, onEventClick, onCompanyClick}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [truncated,setTruncated]=useState(false);

  // Fenêtre glissante : 6 mois passés + tout le futur. Sur la quasi-totalité des
  // comptes ça tient en une seule page (évite les timeouts liés à la pagination sur
  // les comptes à plusieurs milliers d'activités). Garde-fou de pagination conservé
  // au cas où un compte très actif dépasse quand même 2000 lignes sur 6 mois.
  const load=useCallback(async()=>{
    setLoading(true);setErr('');setTruncated(false);
    try{
      const MAX_PAGES=5;
      let all=[]; let page=1;
      while(page<=MAX_PAGES){
        const batch=await api(session.subdomain,session.token,'/v3/analytics/activity',{method:'POST',body:{date_from:dateJ6Mois(),page}});
        const arr=Array.isArray(batch)?batch:(Array.isArray(batch?.data)?batch.data:[]);
        if(arr.length===0) break;
        all=all.concat(arr);
        if(arr.length<2000) break; // dernière page atteinte
        page++;
      }
      if(page>MAX_PAGES) setTruncated(true);
      setItems(all);
    }catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const allRaw=items||[];
  const all=allRaw; // No date filter in activities (use all data, filter by deadline status)
  // ─── Calcul temps réel des échéances (ne pas se fier aux champs API qui sont périmés)
  const _today=new Date(); _today.setHours(0,0,0,0);
  const _soon30=new Date(_today); _soon30.setDate(_soon30.getDate()+30);
  const isExp=a=>!!a.deadline&&new Date(a.deadline)<_today;
  const isSoon=a=>!!a.deadline&&new Date(a.deadline)>=_today&&new Date(a.deadline)<=_soon30;
  const expired=all.filter(a=>isExp(a));
  const soon=all.filter(a=>isSoon(a));

  const q=search.toLowerCase();
  const bySorted=[...all].sort((a,b)=>{
    // Expired first, then by deadline asc, then by date
    if(isExp(a)&&!isExp(b)) return -1;
    if(!isExp(a)&&isExp(b)) return 1;
    const da=new Date(a.deadline||a.date||0), db=new Date(b.deadline||b.date||0);
    return da-db; // échéance la plus proche en premier
  });
  const expired2=bySorted.filter(a=>isExp(a));
  const soon2=bySorted.filter(a=>isSoon(a));
  const byFilter=filter==='expired'?expired2:filter==='soon'?soon2:bySorted;
  const filtered=q?byFilter.filter(a=>
    (a.corporation_client_name||'').toLowerCase().includes(q)||
    (a.client_contact_name||'').toLowerCase().includes(q)||
    (a.event_name||'').toLowerCase().includes(q)||
    (a.type||'').toLowerCase().includes(q)||
    (a.category||'').toLowerCase().includes(q)||
    (a.comment||'').toLowerCase().includes(q)
  ):byFilter;
  const filters=[{k:'all',label:`Toutes (${all.length})`},{k:'expired',label:`En retard (${expired.length})`},{k:'soon',label:`Bientôt (${soon.length})`}];

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Client, contact, événement, type…"/>
    {truncated&&<div style={{background:`${T.warning}12`,border:`1.5px solid ${T.warning}66`,borderRadius:8,padding:'8px 12px',marginBottom:10,fontSize:12,color:T.warning,lineHeight:1.5}}>
      ⚠ Ce compte a beaucoup d'activités sur les 6 derniers mois : certaines peuvent manquer — réessayer ou contacter le support si le problème persiste.
    </div>}
    <div style={{fontSize:11,color:T.textSubtle,marginBottom:8}}>Activités des 6 derniers mois et à venir.</div>
    {expired.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12.5,color:T.danger}}>
      <AlertTriangle size={15}/><span>{expired.length} activité{expired.length>1?'s':''} en retard</span>
    </div>}
    <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
      {filters.map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:'5px 12px',borderRadius:999,border:`1px solid ${filter===f.k?T.brand:T.border}`,background:filter===f.k?T.brandTint:'none',color:filter===f.k?T.brand:T.textMuted,fontSize:12,fontWeight:filter===f.k?600:400,cursor:'pointer'}}>{f.label}</button>)}
    </div>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} activité{filtered.length>1?'s':''}{q?` sur ${byFilter.length}`:''}</div>
    {filtered.length===0?<Empty icon={Activity} msg={q?"Aucun résultat.":"Aucune activité."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((a,i)=>{
          const isExp_a=isExp(a);
          const isSoon_a=isSoon(a);
          const dot=isExp?T.danger:isSoon?T.warning:T.success;
          return <Card key={a.activity_id||i} style={{padding:14}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:dot,marginTop:5,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{a.type||'Activité'} {a.category?`· ${a.category}`:''}</div>
                  {a.status&&<Badge label={a.status} color={T.info}/>}
                </div>
                {a.corporation_client_name&&<div style={{fontSize:12,color:T.brand,marginTop:2,fontWeight:500}}>{a.corporation_client_name}</div>}
                {a.client_contact_name&&<div style={{fontSize:12,color:T.textMuted}}>{a.client_contact_name}{a.client_contact_email?` · ${a.client_contact_email}`:''}</div>}
                {a.event_name&&<div style={{fontSize:12,color:T.textMuted,display:'flex',alignItems:'center',gap:4,marginTop:2}}><Calendar size={11}/>{a.event_name}</div>}
                {a.comment&&<div style={{fontSize:12,color:T.textMuted,marginTop:6,lineHeight:1.5,borderLeft:`2px solid ${T.border}`,paddingLeft:8}}>{strip(a.comment).slice(0,120)}{strip(a.comment).length>120?'…':''}</div>}
                {(a.event_name||a.corporation_client_name)&&<div style={{display:'flex',gap:6,marginTop:6}}>
                  {a.event_name&&onEventClick&&<button onClick={()=>{
                    const ev=findEventByName(session, a.event_name);
                    if(ev) onEventClick(ev); else if(a.event_link) window.open(a.event_link,'_blank');
                  }} style={{fontSize:11.5,color:T.brand,background:'none',textDecoration:'none',border:`1px solid ${T.brand}`,borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Voir événement</button>}
                  {a.corporation_client_name&&onCompanyClick&&<button onClick={()=>{
                    const k=Object.keys(localStorage).find(k=>k.includes('customer_company'));
                    const cos=k?cacheArr(k):[];
                    const co=cos.find(c=>(c.name||'').toLowerCase()===(a.corporation_client_name||'').toLowerCase());
                    if(co) onCompanyClick(co); else if(a.corporation_client_link) window.open(a.corporation_client_link,'_blank');
                  }} style={{fontSize:11.5,color:T.secondary,background:'none',textDecoration:'none',border:`1px solid ${T.secondary}`,borderRadius:6,padding:'3px 8px',cursor:'pointer'}}>Voir client</button>}
                </div>}
                <div style={{display:'flex',gap:10,marginTop:6,fontSize:11,color:T.textSubtle,flexWrap:'wrap'}}>
                  {a.date&&<span><Clock size={10}/> {date(a.date)}</span>}
                  {a.deadline&&<span style={{color:isExp?T.danger:isSoon?T.warning:T.textSubtle}}>{isExp?'⚠ ':isSoon?'⏰ ':''}Échéance : {date(a.deadline)}</span>}
                  {a.module&&<Badge label={a.module} color={T.secondary}/>}
                </div>
              </div>
            </div>
          </Card>;
        })}
      </div>}
  </div>;
}

// ─── Fetch all pages helper ───────────────────────────────────────
async function fetchAllPages(subdomain, token, basePath) {
  let page = 1;
  let allData = [];
  let lastPage = 1;
  do {
    const sep = basePath.includes('?') ? '&' : '?';
    const res = await api(subdomain, token, `${basePath}${sep}per_page=100&page=${page}`);
    const items = Array.isArray(res) ? res : (res?.data || []);
    allData = [...allData, ...items];
    lastPage = res?.meta?.last_page || 1;
    page++;
  } while (page <= lastPage);
  return allData;
}

// ─── Company Detail ───────────────────────────────────────────────
function CompanyDetail({company, allCustomers, session, onBack}) {
  const [tab, setTab] = useState('contacts');
  const [details, setDetails] = useState(null);

  useEffect(()=>{
    // Load full company details from API
    api(session.subdomain,session.token,`/v3/customer-company/${company.id}`).then(d=>{
      setDetails(d?.data||d||null);
    }).catch(()=>{});
  },[company.id,session]);

  const co = details || company || {}; // Use API details if available
  const linked = allCustomers.filter(c =>
    c.company?.id === company.id ||
    c.company?.name?.toLowerCase() === (company.name||'').toLowerCase()
  );
  const coName = (company.name||'').toLowerCase();

  // Load related data from cache
  const relEvents = (() => { try {
    const k=Object.keys(localStorage).find(k=>k.includes('analytics_events')&&!k.includes('vue')&&!k.includes('planning'));
    return k?cacheArr(k).filter(e=>(e.company_name||e.customer||'').toLowerCase()===coName).sort((a,b)=>new Date(b.events_date_from||0)-new Date(a.events_date_from||0)):[];
  } catch{return [];} })();

  const relQuotes = (() => { try {
    const k=Object.keys(localStorage).find(k=>k.includes('quotes'));
    return k?cacheArr(k).filter(q=>(q.customer||'').toLowerCase()===coName).sort((a,b)=>new Date(b.date_of_quote||0)-new Date(a.date_of_quote||0)):[];
  } catch{return [];} })();

  const relBills = (() => { try {
    const k=Object.keys(localStorage).find(k=>k.includes('bills'));
    return k?cacheArr(k).filter(b=>(b.customer||'').toLowerCase()===coName).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)):[];
  } catch{return [];} })();

  const relActivities = (() => { try {
    const k=Object.keys(localStorage).find(k=>k.includes('activity'));
    return k?cacheArr(k).filter(a=>(a.corporation_client_name||'').toLowerCase()===coName).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)):[];
  } catch{return [];} })();

  const tabs=[
    {k:'contacts',label:`Contacts (${linked.length})`},
    {k:'events',label:`Événements (${relEvents.length})`},
    {k:'docs',label:`Devis/Fact. (${relQuotes.length+relBills.length})`},
    {k:'activities',label:`Activités (${relActivities.length})`},
  ];

  return <div>
    <BackHeader title={company.name||'Société'} subtitle={company.city&&`${company.city}${company.country?', '+formatCountry(company.country):''}`} onBack={onBack}/>
    <div style={{padding:'16px 16px 8px'}}>
      <Card style={{marginBottom:12}}>
        {[
          {label:'Ville', value:co.city||co.address?.city},
          {label:'Code postal', value:co.address?.zipcode},
          {label:'Pays', value:formatCountry(co.country||co.address?.country)},
          {label:'Adresse', value:co.address?.street_1},
          {label:'Site web', value:co.web_site},
          {label:'SIRET', value:co.finance?.siret||co.data?.nb_siret},
          {label:'N° TVA', value:co.finance?.tva_number||co.data?.tva_number},
          {label:'Service', value:co.finance?.service||co.data?.service},
          {label:'Type', value:co.type_name},
          {label:'Langue', value:co.company_language},
        ].filter(f=>f.value&&f.value!=='null'&&safeStr(f.value)).map((f,i,arr)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 16px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted}}>{f.label}</span>
          <span style={{fontSize:13,fontWeight:500,color:T.ink}}>{f.value}</span>
        </div>)}
      </Card>
    </div>

    {/* Onglets */}
    <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,background:T.surface,display:'flex',position:'sticky',top:52,zIndex:7,overflowX:'auto'}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{flexShrink:0,background:'none',border:'none',cursor:'pointer',padding:'10px 10px',fontSize:11.5,fontWeight:tab===t.k?600:400,color:tab===t.k?T.brand:T.textMuted,borderBottom:tab===t.k?`2px solid ${T.brand}`:'2px solid transparent',whiteSpace:'nowrap'}}>{t.label}</button>)}
    </div>

    <div style={{padding:'12px 16px 32px'}}>
      {/* Contacts */}
      {tab==='contacts'&&(linked.length===0?<Empty icon={UserRound} msg="Aucun contact lié."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {linked.map((c,i)=><Card key={c.id||i} style={{padding:14}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:9,background:`${T.info}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><UserRound size={16} color={T.info}/></div>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{[c.civility==='1'?'Mme':c.civility==='2'?'M.':c.civility,c.name,c.last_name].filter(Boolean).join(' ')||'Sans nom'}</div>
                {c.position&&<div style={{fontSize:12,color:T.textMuted}}>{c.position}</div>}
                <div style={{display:'flex',gap:10,marginTop:4,flexWrap:'wrap'}}>
                  {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Mail size={11}/>{c.email}</a>}
                  {(c.mobile||c.phone)&&<a href={`tel:${c.mobile||c.phone}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Phone size={11}/>{c.mobile||c.phone}</a>}
                </div>
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Événements */}
      {tab==='events'&&(relEvents.length===0?<Empty icon={Calendar} msg="Aucun événement lié."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relEvents.map((ev,i)=><Card key={i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ev.event_name}</div>
                <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8}}>
                  <span>{date(ev.events_date_from)}</span>
                  {ev.number_of_persons&&<span><Users size={11}/> {ev.number_of_persons}</span>}
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                {ev.quotes_sell_price_sign&&<div style={{fontSize:13,fontWeight:700,color:T.success}}>{money(ev.quotes_sell_price_sign)}</div>}
                {ev.win_lost&&<Badge label={ev.win_lost} color={ev.win_lost==='Gagné'?T.success:ev.win_lost==='Perdu'?T.danger:T.warning}/>}
              </div>
            </div>
          </Card>)}
        </div>)}

      {/* Devis & Factures */}
      {tab==='docs'&&<div style={{display:'flex',flexDirection:'column',gap:8}}>
        {relQuotes.length===0&&relBills.length===0&&<Empty icon={FileText} msg="Aucun document lié."/>}
        {relQuotes.map((q,i)=><Card key={`q${i}`} style={{padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12.5,fontWeight:600,color:T.ink}}>{q.title||q.event||q.nb}</div>
              <div style={{fontSize:11.5,color:T.textMuted}}>{q.nb} · {date(q.date_of_quote)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(q.total_ht||q.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
              {q.status&&<Badge label={q.status} color={/sign/i.test(q.status)?T.success:/rejet|annul/i.test(q.status)?T.danger:T.warning}/>}
            </div>
          </div>
        </Card>)}
        {relBills.map((b,i)=><Card key={`b${i}`} style={{padding:12,borderLeft:`3px solid ${T.info}`}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12.5,fontWeight:600,color:T.ink}}>{b.event||b.nb} <Badge label="Facture" color={T.info}/></div>
              <div style={{fontSize:11.5,color:T.textMuted}}>{b.nb} · {date(b.date)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(b.total_ht||b.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
              {b.status&&<Badge label={b.status} color={/pay/i.test(b.status)?T.success:T.warning}/>}
            </div>
          </div>
        </Card>)}
      </div>}

      {/* Activités */}
      {tab==='activities'&&(relActivities.length===0?<Empty icon={Activity} msg="Aucune activité liée."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {relActivities.map((a,i)=><Card key={i} style={{padding:12}}>
            <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:(()=>{const t=new Date();t.setHours(0,0,0,0);const s=new Date(t);s.setDate(s.getDate()+30);const exp=!!a.deadline&&new Date(a.deadline)<t;const son=!!a.deadline&&new Date(a.deadline)>=t&&new Date(a.deadline)<=s;return exp?T.danger:son?T.warning:T.success;})(),marginTop:5,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{a.type||'Activité'} {a.category?`· ${a.category}`:''}</div>
                {a.event_name&&<div style={{fontSize:12,color:T.textMuted,display:'flex',alignItems:'center',gap:4}}><Calendar size={11}/>{a.event_name}</div>}
                {a.comment&&<div style={{fontSize:12,color:T.textMuted,marginTop:4,lineHeight:1.5,borderLeft:`2px solid ${T.border}`,paddingLeft:6}}>{strip(a.comment).slice(0,100)}{strip(a.comment).length>100?'…':''}</div>}
                <div style={{fontSize:11,color:T.textSubtle,marginTop:4,display:'flex',gap:8,flexWrap:'wrap'}}>
                  {a.date&&<span><Clock size={10}/> {date(a.date)}</span>}
                  {a.deadline&&<span style={{color:(()=>{const t=new Date();t.setHours(0,0,0,0);return !!a.deadline&&new Date(a.deadline)<t;})() ?T.danger:T.textSubtle}}>{ (()=>{const t=new Date();t.setHours(0,0,0,0);return !!a.deadline&&new Date(a.deadline)<t;})()?'⚠ ':''}Échéance : {date(a.deadline)}</span>}
                </div>
              </div>
            </div>
          </Card>)}
        </div>)}
    </div>
  </div>;
}

// ─── Contacts ────────────────────────────────────────────────────
function Contacts({session, initialCompany, onConsumeInitial}) {
  const [companies,setCompanies]=useState(null);
  const [customers,setCustomers]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [sub,setSub]=useState('companies');
  const [search,setSearch]=useState('');
  const [selectedCompany,setSelectedCompany]=useState(null);
  const [selectedContact,setSelectedContact]=useState(null);

  // Handle navigation from Activities "Voir client"
  useEffect(()=>{
    if(initialCompany&&onConsumeInitial){
      setSelectedCompany(initialCompany);
      onConsumeInitial();
    }
  },[initialCompany]);

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{
      const [co,cu]=await Promise.all([
        fetchAllPagesCached(session.subdomain,session.token,'/v3/customer-company',d=>{setCompanies(d)}),
        fetchAllPagesCached(session.subdomain,session.token,'/v3/customers',d=>{setCustomers(d)}),
      ]);
      setCompanies(co);
      setCustomers(cu);
    } catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <div style={{padding:16}}><Spinner/><p style={{textAlign:'center',fontSize:12,color:T.textMuted}}>Chargement de tous les contacts…</p></div>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  if(selectedContact) return <ContactDetail contact={selectedContact} session={session} onBack={()=>setSelectedContact(null)} onCompanyClick={co=>{setSelectedContact(null);setSelectedCompany(co);}}/>;  
  if(selectedCompany) return <CompanyDetail company={selectedCompany} allCustomers={customers||[]} session={session} onBack={()=>setSelectedCompany(null)}/>;

  const q=search.toLowerCase();
  const allCo=companies||[];
  const allCu=customers||[];
  const filteredCo=q?allCo.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.city||'').toLowerCase().includes(q)):allCo;
  const filteredCu=q?allCu.filter(c=>[c.name,c.last_name,c.email,c.position].filter(Boolean).join(' ').toLowerCase().includes(q)):allCu;

  const tabs=[{k:'companies',label:`Sociétés (${allCo.length})`},{k:'contacts',label:`Contacts (${allCu.length})`}];

  return <div>
    <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,position:'sticky',top:0,zIndex:5}}>
      <div style={{display:'flex'}}>
        {tabs.map(t=><button key={t.k} onClick={()=>{setSub(t.k);setSearch('');}} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'12px 8px',fontSize:13,fontWeight:sub===t.k?600:400,color:sub===t.k?T.brand:T.textMuted,borderBottom:sub===t.k?`2px solid ${T.brand}`:'2px solid transparent'}}>{t.label}</button>)}
      </div>
      <div style={{padding:'8px 16px 10px'}}>
        <SearchBar value={search} onChange={setSearch} placeholder={sub==='companies'?'Nom société, ville…':'Nom, email, poste…'}/>
      </div>
    </div>
    <div style={{padding:'12px 16px 16px'}}>
      {sub==='companies'&&<>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filteredCo.length} société{filteredCo.length>1?'s':''}{q?` sur ${allCo.length}`:''}</div>
        {filteredCo.length===0?<Empty icon={Building2} msg={q?'Aucun résultat.':'Aucune société.'}/>:
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {filteredCo.map((c,i)=><Card key={c.id||i} onClick={()=>setSelectedCompany(c)} style={{padding:14}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Building2 size={16} color={T.brand}/></div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name||'Sans nom'}</div>
                  {c.city&&<div style={{fontSize:12,color:T.textMuted}}>{c.city}{c.country?`, ${formatCountry(c.country)}`:''}</div>}
                </div>
                <ChevronRight size={16} color={T.textSubtle}/>
              </div>
            </Card>)}
          </div>}
      </>}
      {sub==='contacts'&&<>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filteredCu.length} contact{filteredCu.length>1?'s':''}{q?` sur ${allCu.length}`:''}</div>
        {filteredCu.length===0?<Empty icon={UserRound} msg={q?'Aucun résultat.':'Aucun contact.'}/>:
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {filteredCu.map((c,i)=><Card key={c.id||i} onClick={()=>setSelectedContact(c)} style={{padding:14}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:`${T.info}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><UserRound size={16} color={T.info}/></div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{[c.civility,c.name,c.last_name].filter(Boolean).join(' ')||'Sans nom'}</div>
                  {c.position&&<div style={{fontSize:12,color:T.textMuted}}>{c.position}</div>}
                  {c.company?.name&&<div style={{fontSize:12,color:T.brand,fontWeight:500}}>{c.company.name}</div>}
                  <div style={{display:'flex',gap:10,marginTop:4,flexWrap:'wrap'}}>
                    {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Mail size={11}/>{c.email}</a>}
                    {(c.mobile||c.phone)&&<a href={`tel:${c.mobile||c.phone}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Phone size={11}/>{c.mobile||c.phone}</a>}
                  </div>
                </div>
              </div>
            </Card>)}
          </div>}
      </>}
    </div>
  </div>;
}

// ─── Quick Create Event Modal ─────────────────────────────────────
// ─── Shared form helpers ──────────────────────────────────────────
const inp = {width:'100%',minHeight:44,padding:'0 12px',marginBottom:14,border:`1px solid ${T.borderStrong}`,borderRadius:8,fontSize:14,color:'#1b283f',outline:'none',boxSizing:'border-box',fontFamily:'inherit'};

function SuccessScreen({msg,onClose}) {
  return <div style={{textAlign:'center',padding:'32px 0 8px'}}>
    <CheckCircle2 size={44} color={T.success} style={{marginBottom:12}}/>
    <p style={{fontSize:14,color:'#464e5f',margin:'0 0 24px',lineHeight:1.5}}>{msg}</p>
    <button onClick={onClose} style={{padding:'10px 28px',borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer'}}>Fermer</button>
  </div>;
}

// ─── Create Event Form ─────────────────────────────────────────────
function CreateEventForm({session, onDone}) {
  const [name,setName]=useState('');
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [persons,setPersons]=useState('');
  const [description,setDescription]=useState('');
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState('');
  // Customer search
  const [customerSearch,setCustomerSearch]=useState('');
  const [selectedCustomer,setSelectedCustomer]=useState(null);

  // Load contacts from cache
  const allCustomers = (() => {
    try {
      const k = Object.keys(localStorage).find(k => k.includes('allpages') && k.includes('customers'));
      return k ? cacheArr(k) : [];
    } catch { return []; }
  })();
  const filteredCustomers = customerSearch && !selectedCustomer
    ? allCustomers.filter(c => [c.name,c.last_name,c.email].filter(Boolean).join(' ').toLowerCase().includes(customerSearch.toLowerCase())).slice(0,6)
    : [];

  const submit = async () => {
    if (!name.trim()) { setErr("Le nom de l'événement est requis."); return; }
    setLoading(true); setErr('');
    try {
      await api(session.subdomain, session.token, '/v3/events/quick/create', {
        method: 'POST',
        body: {
          event_name: name.trim(),
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          number_of_persons: persons ? parseInt(persons) : undefined,
          description: description || undefined,
          customer_id: selectedCustomer?.id || undefined,
        }
      });
      onDone();
    } catch(e) { setErr(e.message); } finally { setLoading(false); }
  };

  return <>
    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Nom de l'événement *</label>
    <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex: Séminaire direction 2026" style={inp}/>

    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Contact client</label>
    <input value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);setSelectedCustomer(null);}} placeholder="Nom, prénom ou email…" style={inp}/>
    {filteredCustomers.length>0&&<div style={{border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden',marginTop:-10,marginBottom:14}}>
      {filteredCustomers.map((c,i)=><button key={c.id||i} onClick={()=>{setSelectedCustomer(c);setCustomerSearch([c.name,c.last_name].filter(Boolean).join(' '));}} style={{width:'100%',padding:'9px 14px',background:'none',border:'none',borderBottom:i<filteredCustomers.length-1?`1px solid ${T.border}`:'none',cursor:'pointer',textAlign:'left',fontSize:13,color:'#1b283f',display:'flex',flexDirection:'column',gap:2}}>
        <span style={{fontWeight:500}}>{[c.name,c.last_name].filter(Boolean).join(' ')||'—'}</span>
        {c.email&&<span style={{fontSize:11.5,color:'#80808f'}}>{c.email}</span>}
      </button>)}
    </div>}
    {selectedCustomer&&<div style={{background:`${T.brandTint}`,border:`1px solid ${T.brandLight}`,borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:12.5,color:T.brandStrong,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <span>✓ {[selectedCustomer.name,selectedCustomer.last_name].filter(Boolean).join(' ')}</span>
      <button onClick={()=>{setSelectedCustomer(null);setCustomerSearch('');}} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,fontSize:16,lineHeight:1}}>×</button>
    </div>}

    <div style={{display:'flex',gap:10,marginBottom:0}}>
      <div style={{flex:1}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Date début</label>
        <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={inp}/>
      </div>
      <div style={{flex:1}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Date fin</label>
        <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={inp}/>
      </div>
    </div>

    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Nombre de personnes</label>
    <input type="number" value={persons} onChange={e=>setPersons(e.target.value)} placeholder="Ex: 50" style={inp}/>

    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Description</label>
    <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={2} placeholder="Description du projet…" style={{...inp,padding:'10px 12px',resize:'none',height:'auto'}}/>

    {err&&<div style={{display:'flex',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12.5,color:T.danger}}><AlertCircle size={16}/><span>{err}</span></div>}
    <button onClick={submit} disabled={loading} style={{width:'100%',minHeight:44,borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:4}}>
      {loading&&<Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>}{loading?'Création…':"Créer l'événement"}
    </button>
  </>;
}

// ─── Create Contact Form ───────────────────────────────────────────
function CreateContactForm({session,companies,onDone}) {
  const [mode,setMode]=useState('new_company'); // 'new_company' | 'existing_company'
  // Société
  const [companyName,setCompanyName]=useState('');
  const [companySearch,setCompanySearch]=useState('');
  const [selectedCompany,setSelectedCompany]=useState(null);
  // Contact
  const [civility,setCivility]=useState('');
  const [firstName,setFirstName]=useState('');
  const [lastName,setLastName]=useState('');
  const [email,setEmail]=useState('');
  const [phone,setPhone]=useState('');
  const [mobile,setMobile]=useState('');
  const [position,setPosition]=useState('');
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState('');
  const [step,setStep]=useState(1); // 1=société, 2=contact

  const filteredCos=(companies||[]).filter(c=>(c.name||'').toLowerCase().includes(companySearch.toLowerCase())).slice(0,8);

  const submitContact=async(companyId)=>{
    if(!email.trim()){setErr("L'email est requis.");return;}
    setLoading(true);setErr('');
    try{
      await api(session.subdomain,session.token,'/v3/customers/create',{method:'POST',body:{
        company_id:companyId,
        email:email.trim(),
        name:firstName.trim()||undefined,
        last_name:lastName.trim()||undefined,
        phone:phone.trim()||undefined,
        mobile_phone:mobile.trim()||undefined,
        position:position.trim()||undefined,
        civility:civility||undefined,
        active:true,
      }});
      onDone();
    }catch(e){setErr(e.message);}finally{setLoading(false);}
  };

  const handleNext=async()=>{
    if(mode==='new_company'){
      if(!companyName.trim()){setErr('Le nom de la société est requis.');return;}
      setLoading(true);setErr('');
      try{
        const res=await api(session.subdomain,session.token,'/v3/customer-company/create',{method:'POST',body:{name:companyName.trim(),active:true}});
        const newId=res?.data?.id||res?.id;
        if(!newId) throw new Error("ID société non reçu.");
        setSelectedCompany({id:newId,name:companyName.trim()});
        setStep(2);
      }catch(e){setErr(e.message);}finally{setLoading(false);}
    } else {
      if(!selectedCompany){setErr('Sélectionnez une société.');return;}
      setStep(2);
    }
  };

  if(step===2) return <>
    <div style={{background:T.brandTint,border:`1px solid ${T.brandLight}`,borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:12.5,color:T.brandStrong,display:'flex',alignItems:'center',gap:6}}>
      <Building2 size={14}/><span>Société : <strong>{selectedCompany?.name}</strong></span>
    </div>
    <div style={{display:'flex',gap:10,marginBottom:0}}>
      <div style={{flex:'0 0 90px'}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Civilité</label>
        <select value={civility} onChange={e=>setCivility(e.target.value)} style={{...inp,marginBottom:14}}>
          <option value="">—</option>
          <option value="2">M.</option>
          <option value="1">Mme</option>
        </select>
      </div>
      <div style={{flex:1}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Prénom</label>
        <input value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Prénom" style={inp}/>
      </div>
    </div>
    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Nom *</label>
    <input value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="Nom de famille" style={inp}/>
    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Email *</label>
    <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="contact@exemple.fr" style={inp}/>
    <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Poste</label>
    <input value={position} onChange={e=>setPosition(e.target.value)} placeholder="Ex: Directeur commercial" style={inp}/>
    <div style={{display:'flex',gap:10}}>
      <div style={{flex:1}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Téléphone</label>
        <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="01 23 45 67 89" style={inp}/>
      </div>
      <div style={{flex:1}}>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Mobile</label>
        <input type="tel" value={mobile} onChange={e=>setMobile(e.target.value)} placeholder="06 00 00 00 00" style={inp}/>
      </div>
    </div>
    {err&&<div style={{display:'flex',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12.5,color:T.danger}}><AlertCircle size={16}/><span>{err}</span></div>}
    <div style={{display:'flex',gap:8,marginTop:4}}>
      <button onClick={()=>{setStep(1);setErr('');}} style={{flex:'0 0 auto',minHeight:44,padding:'0 16px',borderRadius:8,border:`1px solid ${T.border}`,background:'none',color:T.textMuted,fontSize:14,cursor:'pointer'}}>
        <ChevronLeft size={16}/>
      </button>
      <button onClick={()=>submitContact(selectedCompany?.id)} disabled={loading} style={{flex:1,minHeight:44,borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
        {loading&&<Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>}{loading?'Création…':'Créer le contact'}
      </button>
    </div>
  </>;

  return <>
    {/* Mode selector */}
    <div style={{display:'flex',gap:6,marginBottom:16}}>
      {[{k:'new_company',label:'Nouvelle société'},{k:'existing_company',label:'Société existante'}].map(o=><button key={o.k} onClick={()=>{setMode(o.k);setErr('');setSelectedCompany(null);}} style={{flex:1,padding:'8px 6px',borderRadius:8,border:`1.5px solid ${mode===o.k?T.brand:T.border}`,background:mode===o.k?T.brandTint:'none',color:mode===o.k?T.brand:T.textMuted,fontSize:12.5,fontWeight:mode===o.k?600:400,cursor:'pointer'}}>{o.label}</button>)}
    </div>

    {mode==='new_company'&&<>
      <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Nom de la société *</label>
      <input value={companyName} onChange={e=>setCompanyName(e.target.value)} placeholder="Ex: Acme SAS" style={inp}/>
    </>}

    {mode==='existing_company'&&<>
      <label style={{display:'block',fontSize:13,fontWeight:500,color:'#464e5f',marginBottom:6}}>Rechercher une société *</label>
      <input value={companySearch} onChange={e=>{setCompanySearch(e.target.value);setSelectedCompany(null);}} placeholder="Tapez le nom de la société…" style={inp}/>
      {companySearch&&filteredCos.length>0&&!selectedCompany&&<div style={{border:`1px solid ${T.border}`,borderRadius:8,overflow:'hidden',marginTop:-8,marginBottom:14}}>
        {filteredCos.map((c,i)=><button key={c.id||i} onClick={()=>{setSelectedCompany(c);setCompanySearch(c.name);}} style={{width:'100%',padding:'10px 14px',background:'none',border:'none',borderBottom:i<filteredCos.length-1?`1px solid ${T.border}`:'none',cursor:'pointer',textAlign:'left',fontSize:13.5,color:'#1b283f',display:'block'}}>
          {c.name}
          {c.city&&<span style={{fontSize:11.5,color:'#80808f',marginLeft:8}}>{c.city}</span>}
        </button>)}
      </div>}
      {selectedCompany&&<div style={{background:T.brandTint,border:`1px solid ${T.brandLight}`,borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:12.5,color:T.brandStrong}}>
        ✓ {selectedCompany.name}
      </div>}
    </>}

    {err&&<div style={{display:'flex',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 12px',marginBottom:12,fontSize:12.5,color:T.danger}}><AlertCircle size={16}/><span>{err}</span></div>}

    <button onClick={handleNext} disabled={loading} style={{width:'100%',minHeight:44,borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:4}}>
      {loading&&<Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>}
      {loading?'Création société…':'Suivant — Infos contact'}
      {!loading&&<ChevronRight size={16}/>}
    </button>
  </>;
}

// ─── Quick Create Modal (choix multiple) ──────────────────────────
function QuickCreateModal({session,companies,onClose,onSuccess}) {
  const [type,setType]=useState(null); // null | 'event' | 'contact'
  const [done,setDone]=useState(false);
  const [doneMsg,setDoneMsg]=useState('');

  const handleDone=(msg)=>{setDone(true);setDoneMsg(msg);};

  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
    <div style={{background:T.surface,borderRadius:20,width:'100%',maxWidth:480,maxHeight:'90vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'20px 24px 16px',borderBottom:type?`1px solid ${T.border}`:'none',flexShrink:0}}>
        <h2 style={{fontSize:16,fontWeight:700,color:T.ink,margin:0}}>
          {!type?'Créer…':type==='event'?'Nouvel événement':'Nouveau client'}
        </h2>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted}}><X size={20}/></button>
      </div>

      <div style={{overflowY:'auto',flex:1,padding:'16px 24px 24px'}}>
        {done?<SuccessScreen msg={doneMsg} onClose={()=>{onSuccess();}}/>:
        !type?<>
          {/* Choix du type */}
          <p style={{fontSize:13,color:T.textMuted,margin:'0 0 16px'}}>Que souhaitez-vous créer ?</p>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {[
              {k:'event',icon:Calendar,label:'Événement',desc:'Créer un nouvel événement rapide'},
              {k:'contact',icon:Users,label:'Client',desc:'Nouvelle société avec contact, ou contact dans société existante'},
            ].map(({k,icon:Icon,label,desc})=><button key={k} onClick={()=>setType(k)} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',borderRadius:12,border:`1.5px solid ${T.border}`,background:T.surface,cursor:'pointer',textAlign:'left',transition:'all 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.brand;e.currentTarget.style.background=T.brandSubtle;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.surface;}}>
              <div style={{width:40,height:40,borderRadius:10,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <Icon size={20} color={T.brand}/>
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:T.ink}}>{label}</div>
                <div style={{fontSize:12.5,color:T.textMuted,marginTop:2}}>{desc}</div>
              </div>
              <ChevronRight size={16} color={T.textSubtle} style={{marginLeft:'auto',flexShrink:0}}/>
            </button>)}
          </div>
        </>:
        type==='event'?
          <CreateEventForm session={session} onDone={()=>handleDone('Événement créé avec succès !')}/>:
          <CreateContactForm session={session} companies={companies} onDone={()=>handleDone('Client créé avec succès !')}/>
        }
      </div>
    </div>
  </div>;
}

// ─── App Shell ───────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(()=>{
    try { const s=localStorage.getItem('le_session'); return s?JSON.parse(s):null; } catch { return null; }
  });
  const [tab,setTab]=useState('dashboard');
  const [showCreate,setShowCreate]=useState(false);
  const [eventDetail,setEventDetail]=useState(null);
  const [companyDetailOverride,setCompanyDetailOverride]=useState(null);
  const [eventsInitFilter,setEventsInitFilter]=useState({_k:0});
  const [financesInitFilter,setFinancesInitFilter]=useState({_k:0});
  const [drawerOpen,setDrawerOpen]=useState(false);
  const [showSupport,setShowSupport]=useState(false);

  // Helper to prefetch all data for a session
  const prefetchAll = s => {
    const endpoints = [
      {path:'/v3/analytics/events', opts:{method:'POST',body:{events_date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/finance-documents/quotes', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/finance-documents/bills', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/bill-prepayments', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/activity', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/partner-companies', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/finance-documents/rentability', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/finance-documents/vue-analytics-light', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/goods', opts:{method:'POST',body:{}}},
      {path:'/v3/analytics/events/vue-planning', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
      {path:'/v3/analytics/events/vue-planning-by-day', opts:{method:'POST',body:{date_from:dateJ2Ans()}}},
    ];
    endpoints.forEach(({path,opts})=>apiCached(s.subdomain,s.token,path,opts).catch(()=>{}));
    fetchAllPagesCached(s.subdomain,s.token,'/v3/customer-company').catch(()=>{});
    fetchAllPagesCached(s.subdomain,s.token,'/v3/customers').catch(()=>{});
  };

  // Prefetch on session restore (page reload)
  useEffect(()=>{ if(session) prefetchAll(session); },[]);

  const handleLogin = s => {
    try { localStorage.setItem('le_session', JSON.stringify(s)); } catch {}
    setSession(s);
    prefetchAll(s);
  };

  const handleLogout = () => {
    if(session) cacheClear(session.subdomain);
    try { localStorage.removeItem('le_session'); } catch {}
    setSession(null);
  };

  if(!session) return <Login onLogin={handleLogin}/>;

  const tabs=[
    {k:'dashboard',label:'Aperçu',icon:LayoutDashboard},
    {k:'events',label:'Événements',icon:Calendar},
    {k:'finances',label:'Finances',icon:Euro},
    {k:'activites',label:'Activités',icon:Activity},
    {k:'contacts',label:'Contacts',icon:Users},
  ];
  const extraTabs=['prestataires','rentabilite','analytics','scheduler','planning','articles','planningbyday','support'];
  const navTo=k=>{setTab(k);setDrawerOpen(false);if(k!=='events')setEventDetail(null);};
  const drawerGroups=[
    {section:'Principal',items:[
      {k:'dashboard',label:'Aperçu',icon:LayoutDashboard},
      {k:'events',label:'Événements',icon:Calendar},
      {k:'finances',label:'Finances',icon:Euro},
      {k:'activites',label:'Activités',icon:Activity},
      {k:'contacts',label:'Contacts',icon:Users},
    ]},
    {section:'Commercial & Finance',items:[
      {k:'prestataires',label:'Prestataires',icon:Briefcase},
      {k:'rentabilite',label:'Rentabilité',icon:TrendingUp},
      {k:'analytics',label:'Analytics produits',icon:TrendingUp},
    ]},
    {section:'Planning',items:[
      {k:'planning',label:'Planning salles',icon:Calendar},
      {k:'planningbyday',label:'Planning par jour',icon:Calendar},
    ]},
    {section:'Catalogue',items:[
      {k:'articles',label:'Articles',icon:FileText},
    ]},
    {section:'Aide',items:[
      {k:'support',label:'Support & Aide',icon:FileText},
    ]},
  ];

  return <div style={{minHeight:'100vh',background:T.surfaceMuted,fontFamily:"'Roboto','Helvetica Neue',Arial,sans-serif",display:'flex',flexDirection:'column'}}>
    {/* Overlay */}
    {drawerOpen&&<div onClick={()=>setDrawerOpen(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.35)',zIndex:50}}/>}
    {/* Drawer */}
    <div style={{position:'fixed',top:0,left:0,bottom:0,width:280,background:T.surface,zIndex:51,transform:drawerOpen?'translateX(0)':'translateX(-100%)',transition:'transform 0.25s ease',boxShadow:'4px 0 24px rgba(16,24,40,0.12)',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'20px 16px 12px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:16,fontWeight:700,color:T.ink}}>Lab-event</div>
          <div style={{fontSize:12,color:T.textMuted}}>{session.subdomain}</div>
        </div>
        <button onClick={()=>setDrawerOpen(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,padding:4}}><X size={20}/></button>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'4px 0'}}>
        {drawerGroups.map(g=><div key={g.section}>
          <div style={{padding:'12px 16px 4px',fontSize:10,fontWeight:700,color:T.textSubtle,textTransform:'uppercase',letterSpacing:'0.8px'}}>{g.section}</div>
          {g.items.map(({k,label,icon:Icon})=><button key={k} onClick={()=>navTo(k)} style={{width:'100%',background:tab===k?T.brandTint:'none',border:'none',cursor:'pointer',padding:'10px 16px',display:'flex',alignItems:'center',gap:10,color:tab===k?T.brand:T.text,fontSize:13.5,fontWeight:tab===k?600:400,textAlign:'left',borderRight:tab===k?`3px solid ${T.brand}`:'3px solid transparent',transition:'all 0.15s'}}>
            <Icon size={17} strokeWidth={2}/>{label}
          </button>)}
        </div>)}
      </div>
      <div style={{padding:16,borderTop:`1px solid ${T.border}`}}>
        <button onClick={handleLogout} style={{width:'100%',background:'none',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',padding:'10px 16px',display:'flex',alignItems:'center',gap:8,color:T.textMuted,fontSize:13}}>
          <LogOut size={15}/> Déconnexion
        </button>
      </div>
    </div>
    {/* Header */}
    <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:10}}>
      <div style={{display:'flex',alignItems:'center',gap:10}}>
        <button onClick={()=>setDrawerOpen(true)} style={{background:'none',border:'none',cursor:'pointer',display:'flex',flexDirection:'column',gap:4,padding:4}}>
          <span style={{display:'block',width:18,height:2,background:T.ink,borderRadius:2}}/>
          <span style={{display:'block',width:14,height:2,background:T.ink,borderRadius:2}}/>
          <span style={{display:'block',width:18,height:2,background:T.ink,borderRadius:2}}/>
        </button>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:T.ink,lineHeight:1.1}}>Lab-event</div>
          <div style={{fontSize:10.5,color:T.textMuted}}>{session.subdomain}</div>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <button onClick={()=>setShowCreate(true)} style={{width:34,height:34,borderRadius:9,background:T.brand,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,179,181,0.3)'}}>
          <Plus size={18} color="#fff" strokeWidth={2.5}/>
        </button>
        <button onClick={handleLogout} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,display:'flex',alignItems:'center'}}>
          <LogOut size={15}/>
        </button>
      </div>
    </div>
    {/* Content */}
    <div style={{flex:1,overflowY:'auto',paddingBottom:extraTabs.includes(tab)?16:72}}>
      {tab==='dashboard'&&<Dashboard session={session} onEventClick={ev=>{setEventDetail(ev);setTab('events');}} onNavigate={dest=>{
        const k=Date.now();
        if(dest==='events'){setEventsInitFilter({upcomingOnly:true,_k:k});setTab('events');}
        else if(dest==='finances-devis'){setFinancesInitFilter({sub:'quotes',quotesFilter:{pendingOnly:true},_k:k});setTab('finances');}
        else if(dest==='finances-signes-mois'){setFinancesInitFilter({sub:'quotes',quotesFilter:{signedThisMonth:true},_k:k});setTab('finances');}
        else if(dest==='rentabilite'){setTab('rentabilite');}
      }}/>}
      {tab==='events'&&(eventDetail?<EventDetail event={eventDetail} session={session} onBack={()=>setEventDetail(null)} onCompanyClick={co=>{setCompanyDetailOverride(co);setTab('contacts');}}/>:<Events key={eventsInitFilter._k||0} session={session} onCompanyClick={co=>{setCompanyDetailOverride(co);setTab('contacts');}} initialFilter={eventsInitFilter}/>)}
      {tab==='finances'&&<Finances key={financesInitFilter._k||0} session={session} initialFilter={financesInitFilter} onCompanyClick={co=>{setCompanyDetailOverride(co);setTab('contacts');}} onEventClick={ev=>{setEventDetail(ev);setTab('events');}}/>}
      {tab==='activites'&&<Activites session={session} onEventClick={ev=>{setEventDetail(ev);setTab('events');}} onCompanyClick={co=>{setCompanyDetailOverride(co);setTab('contacts');}}/>}
      {tab==='contacts'&&<Contacts session={session} initialCompany={companyDetailOverride} onConsumeInitial={()=>setCompanyDetailOverride(null)}/>}
      {tab==='planning'&&<Planning session={session}/>}
      {tab==='prestataires'&&<Prestataires session={session}/>}
      {tab==='rentabilite'&&<Rentabilite session={session}/>}
      {tab==='analytics'&&<AnalyticsLight session={session}/>}
      {tab==='articles'&&<Articles session={session}/>}
      {tab==='planningbyday'&&<PlanningByDay session={session}/>}
      {tab==='support'&&<Support onBack={()=>setTab('dashboard')}/>}
    </div>
    {/* Bottom nav */}
    {!extraTabs.includes(tab)&&<div style={{position:'fixed',bottom:0,left:0,right:0,background:T.surface,borderTop:`1px solid ${T.border}`,display:'flex',boxShadow:'0 -4px 16px rgba(16,24,40,0.06)'}}>
      {tabs.map(({k,label,icon:Icon})=><button key={k} onClick={()=>navTo(k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 0 12px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,color:tab===k?T.brand:T.textMuted,transition:'color 0.18s'}}>
        <Icon size={18} strokeWidth={tab===k?2.4:2.2}/>
        <span style={{fontSize:9.5,fontWeight:tab===k?600:400}}>{label}</span>
      </button>)}
    </div>}
    {showCreate&&<QuickCreateModal session={session} companies={(() => { try { const c=cacheGet(cacheKey(session.subdomain,'allpages_/v3/customer-company')); return c?.data||[]; } catch{return [];} })()} onClose={()=>setShowCreate(false)} onSuccess={()=>{setShowCreate(false);setTab('contacts');}}/>}
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
  </div>;
}

// ─── Prestataires ─────────────────────────────────────────────────

// ─── PartnerDetail ────────────────────────────────────────────────
const formatCountry = c => c ? String(c).replace('country.','') : '';
function PartnerDetail({partner, session, onBack}) {
  const [details, setDetails] = useState(null);
  const partnerId = partner.id || partner.company_id || partner.corporation_id;
  useEffect(()=>{
    if(!partnerId) return;
    api(session.subdomain, session.token, `/v3/customer-company/${partnerId}`)
      .then(d=>setDetails(d?.data||d||null)).catch(()=>{});
  },[partnerId, session]);
  const p = {...partner, ...details}; // fusion : ne perd jamais les données déjà connues (analytics)

  // Champs garantis par /v3/analytics/partner-companies (voir doc API) + bonus si l'enrichissement customer-company matche
  const fields = [
    {label:'Type', value:p.type_name||p.company_type},
    {label:'Potentiel', value:p.potential},
    {label:'Ville', value:p.city||(p.address?.city)},
    {label:'Code postal', value:p.zip_code||p.address?.zipcode},
    {label:'Pays', value:formatCountry(p.country||p.address?.country)},
    {label:'Adresse', value:p.address?.street_1},
    {label:'Code APE', value:p.code_ape},
    {label:'Site web', value:p.web_site},
    {label:'Email', value:p.finance?.contact?.email, link:`mailto:${p.finance?.contact?.email}`},
    {label:'Téléphone', value:p.finance?.contact?.phone, link:`tel:${p.finance?.contact?.phone}`},
    {label:'SIRET', value:p.finance?.siret||p.data?.nb_siret},
    {label:'N° TVA', value:p.finance?.tva_number||p.data?.tva_number},
    {label:'Langue', value:p.company_language},
    {label:'Exposant', value:p.is_exposant?'Oui':null},
  ].filter(f=>f.value&&f.value!=='null'&&safeStr(f.value));

  return <div>
    <BackHeader title={p.name||'Prestataire'} subtitle={p.city} onBack={onBack}/>
    <div style={{padding:'20px 16px 32px'}}>
      {/* Montants HT + TTC */}
      {(partner.total_ttc_quotes_signed||partner.total_ttc_bills_signed||partner.total_ht_quotes_signed||partner.total_ht_bills_signed)&&<div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {partner.total_ht_quotes_signed?<div style={{flex:1,minWidth:100,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Devis signés HT</div>
          <div style={{fontSize:13.5,fontWeight:700,color:T.brand}}>{money(partner.total_ht_quotes_signed)}</div>
        </div>:null}
        {partner.total_ttc_quotes_signed?<div style={{flex:1,minWidth:100,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Devis signés TTC</div>
          <div style={{fontSize:13.5,fontWeight:700,color:T.brand}}>{money(partner.total_ttc_quotes_signed)}</div>
        </div>:null}
        {partner.total_ht_bills_signed?<div style={{flex:1,minWidth:100,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Facturé HT</div>
          <div style={{fontSize:13.5,fontWeight:700,color:T.success}}>{money(partner.total_ht_bills_signed)}</div>
        </div>:null}
        {partner.total_ttc_bills_signed?<div style={{flex:1,minWidth:100,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Facturé TTC</div>
          <div style={{fontSize:13.5,fontWeight:700,color:T.success}}>{money(partner.total_ttc_bills_signed)}</div>
        </div>:null}
      </div>}
      <Card>
        {fields.map((f,i,arr)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'11px 16px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          {f.link?<a href={f.link} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{safeStr(f.value)}</a>
          :<span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{safeStr(f.value)}</span>}
        </div>)}
      </Card>
    </div>
  </div>;
}

function Prestataires({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState(null);

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/partner-companies',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[])));setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(selected) return <PartnerDetail partner={selected} session={session} onBack={()=>setSelected(null)}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].filter(p=>p.active!==false).sort((a,b)=>(Number(b.total_ttc_quotes_signed)||0)-(Number(a.total_ttc_quotes_signed)||0));
  const filtered=q?sorted.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.company_type||'').toLowerCase().includes(q)||(p.country||'').toLowerCase().includes(q)):sorted;

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom, type, pays…"/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} prestataire{filtered.length>1?'s':''}</div>
    {filtered.length===0?<Empty icon={Briefcase} msg="Aucun prestataire."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((p,i)=><Card key={p.id||i} onClick={()=>setSelected(p)} style={{padding:14}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:36,height:36,borderRadius:9,background:`${T.secondary}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Briefcase size={16} color={T.secondary}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name||'Sans nom'}</div>
              <div style={{display:'flex',gap:8,marginTop:3,flexWrap:'wrap'}}>
                {p.company_type&&<Badge label={p.company_type} color={T.secondary}/>}
                {p.country&&<span style={{fontSize:11.5,color:T.textMuted}}>{formatCountry(p.country)}</span>}
              </div>
              {(p.total_ttc_quotes_signed||p.total_ttc_bills_signed)&&<div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap'}}>
                {p.total_ttc_quotes_signed&&<div style={{fontSize:12}}>
                  <span style={{color:T.textMuted}}>Devis signés : </span>
                  <span style={{fontWeight:600,color:T.brand}}>{money(p.total_ttc_quotes_signed)}</span>
                </div>}
                {p.total_ttc_bills_signed&&<div style={{fontSize:12}}>
                  <span style={{color:T.textMuted}}>Facturé : </span>
                  <span style={{fontWeight:600,color:T.success}}>{money(p.total_ttc_bills_signed)}</span>
                </div>}
              </div>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

// ─── Rentabilité ──────────────────────────────────────────────────
function Rentabilite({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [signedOnly,setSignedOnly]=useState(true);
  const [search,setSearch]=useState('');
  const [period,setPeriod]=useState('year');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[])));setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  // Filtre signé + période
  const isSignedDoc = r => /^sign[ée]/i.test((r.status||'').trim());
  const byPeriod=applyDateFilter(items||[],'event_date',period);
  const base=byPeriod.filter(r=>signedOnly?isSignedDoc(r):true);

  // Agréger par goods_section
  const bySection={};
  base.forEach(r=>{
    const sec=r.goods_section||'Autres';
    if(!bySection[sec]) bySection[sec]={section:sec,ca:0,margin:0,commission:0,count:0};
    bySection[sec].ca+=Number(r.sell_price)||0;
    bySection[sec].margin+=Number(r.margin)||0;
    bySection[sec].commission+=Number(r.commission)||0;
    bySection[sec].count++;
  });

  const q=search.toLowerCase();
  const sections=Object.values(bySection)
    .filter(s=>!q||(s.section||'').toLowerCase().includes(q))
    .sort((a,b)=>b.ca-a.ca);

  const totalCA=sections.reduce((s,r)=>s+r.ca,0);
  const totalMargin=sections.reduce((s,r)=>s+r.margin,0);
  const totalComm=sections.reduce((s,r)=>s+r.commission,0);
  const totalRate=totalCA>0?((totalMargin/totalCA)*100).toFixed(1):0;

  return <div style={{padding:16}}>
    {/* Filtre période */}
    <div style={{display:'flex',gap:5,marginBottom:10,flexWrap:'wrap'}}>
      {[{k:'month',label:'Ce mois'},{k:'quarter',label:'Ce trimestre'},{k:'year',label:'Cette année'},{k:'12m',label:'12 mois'},{k:'',label:'2 ans'}].map(o=><button key={o.k||'all'} onClick={()=>setPeriod(o.k)} style={{flex:1,padding:'6px 4px',borderRadius:8,border:`1.5px solid ${period===o.k?T.brand:T.border}`,background:period===o.k?T.brandTint:'none',color:period===o.k?T.brand:T.textMuted,fontSize:11,fontWeight:period===o.k?600:400,cursor:'pointer'}}>{o.label}</button>)}
    </div>
    {/* Filtre signé */}
    <div style={{display:'flex',gap:6,marginBottom:12}}>
      {[{k:true,label:'Signés uniquement'},{k:false,label:'Tous les documents'}].map(o=><button key={String(o.k)} onClick={()=>setSignedOnly(o.k)} style={{flex:1,padding:'7px 8px',borderRadius:8,border:`1.5px solid ${signedOnly===o.k?T.brand:T.border}`,background:signedOnly===o.k?T.brandTint:'none',color:signedOnly===o.k?T.brand:T.textMuted,fontSize:12,fontWeight:signedOnly===o.k?600:400,cursor:'pointer'}}>{o.label}</button>)}
    </div>

    {/* KPIs globaux */}
    <div style={{display:'flex',gap:8,marginBottom:16}}>
      {[
        {label:'CA vendu',value:money(totalCA),accent:T.brand},
        {label:'Marge',value:money(totalMargin),accent:T.success},
        {label:'Commission',value:money(totalComm),accent:T.info},
        {label:'Taux marge',value:`${totalRate}%`,accent:totalRate>=30?T.success:totalRate>=15?T.warning:T.danger},
      ].map((k,i)=><div key={i} style={{flex:1,minWidth:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'8px 6px',textAlign:'center'}}>
        <div style={{fontSize:10,color:T.textMuted,marginBottom:2}}>{k.label}</div>
        <div style={{fontSize:12,fontWeight:700,color:k.accent}}>{k.value}</div>
      </div>)}
    </div>

    <SearchBar value={search} onChange={setSearch} placeholder="Nom de section…"/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{sections.length} section{sections.length>1?'s':''} · {base.length} ligne{base.length>1?'s':''}</div>

    {sections.length===0?<Empty icon={TrendingUp} msg="Aucune donnée."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sections.map((s,i)=>{
          const rate=s.ca>0?((s.margin/s.ca)*100).toFixed(0):0;
          const rateColor=rate>=30?T.success:rate>=15?T.warning:T.danger;
          return <Card key={i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.section}</div>
                <div style={{fontSize:11.5,color:T.textMuted,marginTop:2}}>{s.count} ligne{s.count>1?'s':''}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(s.ca)}</div>
                <div style={{fontSize:12,color:T.success}}>{money(s.margin)}</div>
              </div>
            </div>
            {/* Barre de taux */}
            <div style={{marginTop:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:11,color:T.textMuted}}>Taux de marge</span>
                <span style={{fontSize:11,fontWeight:700,color:rateColor}}>{rate}%</span>
              </div>
              <div style={{height:4,background:T.border,borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${Math.min(Number(rate),100)}%`,background:rateColor,borderRadius:4,transition:'width 0.3s'}}/>
              </div>
            </div>
          </Card>;
        })}
      </div>}
  </div>;
}

// ─── Analytics produits ───────────────────────────────────────────
function AnalyticsLight({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filterSection,setFilterSection]=useState('');
  const [sortBy,setSortBy]=useState('ca');
  const [period,setPeriod]=useState('year');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[])));setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const allRaw=items||[];
  const all=applyDateFilter(allRaw,'date_from',period);

  // Agréger par good_name
  const byArticle={};
  all.forEach(a=>{
    const name=a.good_name||a.product_name||'—';
    const section=a.product_name||'—';
    if(!byArticle[name]) byArticle[name]={name,section,ca:0,count:0,puTotal:0,puCount:0};
    byArticle[name].ca+=Number(a.sell_price)||0;
    byArticle[name].count++;
    if(Number(a.price)>0){byArticle[name].puTotal+=Number(a.price);byArticle[name].puCount++;}
  });

  // Sections uniques pour le filtre
  const sections=[...new Set(all.map(a=>a.product_name).filter(Boolean))].sort();

  const q=search.toLowerCase();
  const articles=Object.values(byArticle)
    .filter(a=>{
      const mQ=!q||a.name.toLowerCase().includes(q)||a.section.toLowerCase().includes(q);
      const mS=!filterSection||a.section===filterSection;
      return mQ&&mS;
    })
    .sort((a,b)=>sortBy==='ca'?b.ca-a.ca:b.count-a.count);

  const totalCA=articles.reduce((s,a)=>s+a.ca,0);
  const maxCA=articles[0]?.ca||1;

  return <div style={{padding:16}}>
    {/* Filtre période */}
    <div style={{display:'flex',gap:5,marginBottom:10,flexWrap:'wrap'}}>
      {[{k:'month',label:'Ce mois'},{k:'quarter',label:'Ce trim.'},{k:'year',label:'Cette année'},{k:'12m',label:'12 mois'},{k:'',label:'2 ans'}].map(o=><button key={o.k||'all'} onClick={()=>setPeriod(o.k)} style={{flex:1,padding:'5px 4px',borderRadius:8,border:`1.5px solid ${period===o.k?T.brand:T.border}`,background:period===o.k?T.brandTint:'none',color:period===o.k?T.brand:T.textMuted,fontSize:11,fontWeight:period===o.k?600:400,cursor:'pointer'}}>{o.label}</button>)}
    </div>
    {/* Filtre section — liste déroulante */}
    {sections.length>0&&<select value={filterSection} onChange={e=>setFilterSection(e.target.value)} style={{width:'100%',minHeight:40,padding:'0 12px',marginBottom:10,border:`1.5px solid ${T.border}`,borderRadius:8,fontSize:13.5,color:T.ink,background:T.surface,outline:'none',boxSizing:'border-box'}}>
      <option value="">Toutes les sections ({sections.length})</option>
      {sections.map(s=><option key={s} value={s}>{s}</option>)}
    </select>}

    <SearchBar value={search} onChange={setSearch} placeholder="Nom d'article ou section…"/>

    {/* Tri + total */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <span style={{fontSize:12,color:T.textMuted}}>{articles.length} article{articles.length>1?'s':''} · Total {money(totalCA)}</span>
      <div style={{display:'flex',gap:4}}>
        {[{k:'ca',label:'CA ↓'},{k:'count',label:'Volume ↓'}].map(o=><button key={o.k} onClick={()=>setSortBy(o.k)} style={{padding:'3px 8px',borderRadius:6,border:`1px solid ${sortBy===o.k?T.brand:T.border}`,background:sortBy===o.k?T.brandTint:'none',color:sortBy===o.k?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:sortBy===o.k?600:400}}>{o.label}</button>)}
      </div>
    </div>

    {articles.length===0?<Empty icon={TrendingUp} msg="Aucun article."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {articles.map((a,i)=>{
          const pct=(a.ca/maxCA)*100;
          const puMoy=a.puCount>0?a.puTotal/a.puCount:0;
          return <Card key={i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name}</div>
                <div style={{fontSize:11.5,color:T.textMuted,marginTop:2,display:'flex',gap:8,alignItems:'center'}}>
                  {a.section&&a.section!==a.name&&<span>{a.section}</span>}
                  <span style={{color:T.brand}}>{a.count}×</span>
                  {puMoy>0&&<span>PU moy : {money(puMoy)}</span>}
                </div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{fontSize:14,fontWeight:700,color:T.ink}}>{money(a.ca)}</div>
              </div>
            </div>
            {/* Barre proportionnelle au CA */}
            <div style={{height:3,background:T.border,borderRadius:4,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${pct}%`,background:T.brand,borderRadius:4}}/>
            </div>
          </Card>;
        })}
      </div>}
  </div>;
}

// ─── Scheduler / Réservations ─────────────────────────────────────
function SchedulerView({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');

  const today=new Date();
  const end=new Date(); end.setDate(end.getDate()+60);
  const fmt=d=>d.toISOString().split('T')[0];

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{
      // La réponse a la forme {resourceTimeRanges,resources,assignments,project,timeRanges,events:[...]}
      // Les réservations utiles sont dans le tableau "events". Pas de cache ici : données temps réel,
      // et le cache partagé par path (sans le body) posait des soucis de fraîcheur sur cet endpoint.
      const d=await api(session.subdomain,session.token,'/v3/scheduler',{method:'POST',body:{startDate:fmt(today),endDate:fmt(end)}});
      setItems(Array.isArray(d?.events)?d.events:[]);
    }catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const flatRaw=items||[];
  const q=search.toLowerCase();
  const filtered=q?flatRaw.filter(r=>(r.eventName||r.event?.name||r.name||'').toLowerCase().includes(q)||(r.product_name||r.hall_name||'').toLowerCase().includes(q)):flatRaw;

  return <div style={{padding:16}}>
    <div style={{background:`${T.info}0d`,border:`1px solid ${T.info}22`,borderRadius:8,padding:'10px 12px',marginBottom:10,fontSize:12,color:T.info,lineHeight:1.5}}>
      📅 Réservations actives du {fmt(today)} au {fmt(end)}. Ces données viennent du scheduler Lab-event en temps réel.
    </div>
    <SearchBar value={search} onChange={setSearch} placeholder="Événement, salle…"/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>
      {filtered.length} réservation{filtered.length!==1?'s':''}
    </div>
    {filtered.length===0?<Empty icon={Calendar} msg={`Aucune réservation${q?' trouvée':' sur cette période'}.`}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((r,i)=><Card key={r.id||i} style={{padding:14}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:36,height:36,borderRadius:9,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Calendar size={16} color={T.brand}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{safeStr(r.eventName||r.event?.name||r.name||'Réservation')}</div>
              {(r.product_name||r.hall_name)&&<div style={{fontSize:12,color:T.textMuted,display:'flex',alignItems:'center',gap:4}}><MapPin size={11}/>{safeStr(r.product_name||r.hall_name)}</div>}
              {r.client?.company&&<div style={{fontSize:12,color:T.brand,fontWeight:500,marginTop:1}}>{safeStr(r.client.company)}</div>}
              <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                {r.date_from&&<span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{date(r.date_from)}</span>}
                {(r.time_from||r.time_to)&&<span>{r.time_from||''}{r.time_to?` → ${r.time_to}`:''}</span>}
                {r.number_of_persons?<span style={{display:'flex',alignItems:'center',gap:3}}><Users size={11}/>{r.number_of_persons}</span>:null}
              </div>
            </div>
            {r.status?.name&&<Badge label={safeStr(r.status.name)} color={r.status.color||T.brand}/>}
          </div>
        </Card>)}
      </div>}
  </div>;
}

// ─── Articles / Goods ─────────────────────────────────────────────

// ─── ArticleDetail ────────────────────────────────────────────────
function ArticleDetail({article: a, onBack}) {
  const fields = [
    {label:'Section', value:a.section},
    {label:'Référence', value:a.reference||a.code},
    {label:'Prix unitaire HT', value:money(a.price)},
    {label:'Prix de vente HT', value:money(a.sell_price)},
    {label:'Unité', value:a.unit},
    {label:'TVA', value:a.vat_rate!=null?`${a.vat_rate}%`:null},
    {label:'Taux marge', value:a.margin_rate!=null?`${a.margin_rate}%`:null},
    {label:'Commission', value:a.commission_rate!=null?`${a.commission_rate}%`:null},
    {label:'Actif', value:a.active===false?'Non':'Oui'},
    {label:'Sans prix', value:a.without_price?'Oui':null},
  ].filter(f=>f.value&&f.value!=='null');

  return <div>
    <BackHeader title={a.name||'Article'} subtitle={a.section} onBack={onBack}/>
    <div style={{padding:'20px 16px 32px'}}>
      {/* Prix cards */}
      {(a.price||a.sell_price)&&<div style={{display:'flex',gap:8,marginBottom:16}}>
        {a.sell_price&&<div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Prix de vente HT</div>
          <div style={{fontSize:14,fontWeight:700,color:T.brand}}>{money(a.sell_price)}</div>
        </div>}
        {a.margin_rate&&<div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>Taux marge</div>
          <div style={{fontSize:14,fontWeight:700,color:T.success}}>{a.margin_rate}%</div>
        </div>}
        {a.vat_rate&&<div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted}}>TVA</div>
          <div style={{fontSize:14,fontWeight:700,color:T.info}}>{a.vat_rate}%</div>
        </div>}
      </div>}
      <Card>
        {fields.map((f,i,arr)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'11px 16px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          <span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>
        </div>)}
      </Card>
    </div>
  </div>;
}

function Articles({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filterSection,setFilterSection]=useState('');
  const [selected,setSelected]=useState(null);

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/goods',{method:'POST',body:{}},d=>setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[])));setItems(Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]));}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(selected) return <ArticleDetail article={selected} onBack={()=>setSelected(null)}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const all=(items||[]).filter(a=>a.active!==false);
  const sections=[...new Set(all.map(a=>a.section).filter(Boolean))].sort();
  const q=search.toLowerCase();

  const filtered=all.filter(a=>{
    const matchQ=!q||(a.name||'').toLowerCase().includes(q)||(a.section||'').toLowerCase().includes(q);
    const matchS=!filterSection||a.section===filterSection;
    return matchQ&&matchS;
  }).sort((a,b)=>(a.section||'').localeCompare(b.section||'')||(a.name||'').localeCompare(b.name||''));

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom, section…"/>
    {sections.length>0&&<div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
      <button onClick={()=>setFilterSection('')} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${!filterSection?T.brand:T.border}`,background:!filterSection?T.brandTint:'none',color:!filterSection?T.brand:T.textMuted,fontSize:11.5,cursor:'pointer',fontWeight:!filterSection?600:400}}>Tous</button>
      {sections.map(s=><button key={s} onClick={()=>setFilterSection(s===filterSection?'':s)} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${filterSection===s?T.brand:T.border}`,background:filterSection===s?T.brandTint:'none',color:filterSection===s?T.brand:T.textMuted,fontSize:11.5,cursor:'pointer',fontWeight:filterSection===s?600:400}}>{s}</button>)}
    </div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} article{filtered.length>1?'s':''}</div>
    {filtered.length===0?<Empty icon={FileText} msg="Aucun article."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((a,i)=><Card key={a.id||i} onClick={()=>setSelected(a)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.name||'Article'}</div>
              <div style={{display:'flex',gap:6,marginTop:4,flexWrap:'wrap',alignItems:'center'}}>
                {a.section&&<Badge label={a.section} color={T.secondary}/>}
                {a.unit&&<span style={{fontSize:11.5,color:T.textMuted}}>/ {a.unit}</span>}
                {a.vat_rate&&<span style={{fontSize:11.5,color:T.textMuted}}>TVA {a.vat_rate}%</span>}
              </div>
              {(a.margin_rate||a.commission_rate)&&<div style={{display:'flex',gap:12,marginTop:6,fontSize:11.5}}>
                {a.margin_rate&&<span style={{color:T.success}}>Marge {a.margin_rate}%</span>}
                {a.commission_rate&&<span style={{color:T.info}}>Comm. {a.commission_rate}%</span>}
              </div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {a.sell_price&&<div style={{fontSize:14,fontWeight:700,color:T.brand}}>{money(a.sell_price)}</div>}
              {a.price&&a.price!==a.sell_price&&<div style={{fontSize:11.5,color:T.textMuted}}>PU {money(a.price)}</div>}
              {!a.sell_price&&!a.price&&a.without_price&&<span style={{fontSize:11.5,color:T.textMuted}}>Sur devis</span>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

// ─── Planning par jour ────────────────────────────────────────────
function PlanningByDay({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [truncated,setTruncated]=useState(false);

  // L'API /v3/analytics/events/vue-planning-by-day ne documente aucun paramètre de date :
  // elle renvoie ses lignes triées par date croissante depuis le tout début de l'historique,
  // plafonnées à 2000 par page. On paginate (convention page/per_page utilisée ailleurs dans
  // cette API) jusqu'à atteindre des jours proches d'aujourd'hui, avec un garde-fou de pages.
  const load=useCallback(async()=>{
    setLoading(true);setErr('');setTruncated(false);
    try{
      const threshold=new Date(); threshold.setDate(threshold.getDate()-3); threshold.setHours(0,0,0,0);
      const MAX_PAGES=25;
      let all=[]; let page=1; let reachedRecent=false; let lastBatchSize=0;
      while(page<=MAX_PAGES){
        const batch=await api(session.subdomain,session.token,'/v3/analytics/events/vue-planning-by-day',{method:'POST',body:{page}});
        const arr=Array.isArray(batch)?batch:(batch?.data||[]);
        lastBatchSize=arr.length;
        if(arr.length===0) break;
        all=all.concat(arr);
        reachedRecent=arr.some(r=>r.day_date&&new Date(r.day_date)>=threshold);
        if(reachedRecent||arr.length<2000) break; // dernière page atteinte, ou on a rejoint le présent
        page++;
      }
      if(!reachedRecent&&lastBatchSize>=2000) setTruncated(true); // on a stoppé sans avoir rejoint aujourd'hui
      setItems(all);
    }
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const threshold=new Date(); threshold.setDate(threshold.getDate()-3); threshold.setHours(0,0,0,0);
  // On ne garde que les jours proches d'aujourd'hui ou futurs (vue prospective, pas rétrospective)
  const future=(items||[]).filter(r=>r.day_date&&new Date(r.day_date)>=threshold);
  const sorted=[...future].sort((a,b)=>new Date(a.day_date||0)-new Date(b.day_date||0));
  const filtered=q?sorted.filter(r=>
    (r.event_name||'').toLowerCase().includes(q)||
    (r.room_name||r.place_name||'').toLowerCase().includes(q)||
    (safeStr(r.day_date)).toLowerCase().includes(q)
  ):sorted;

  // Grouper par date
  const byDate={};
  filtered.forEach(r=>{
    const k=r.day_date||'Sans date';
    if(!byDate[k]) byDate[k]=[];
    byDate[k].push(r);
  });

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Événement, salle, lieu…"/>
    {truncated&&<div style={{background:`${T.warning}12`,border:`1.5px solid ${T.warning}66`,borderRadius:8,padding:'8px 12px',marginBottom:10,fontSize:12,color:T.warning,lineHeight:1.5}}>
      ⚠ L'historique est trop volumineux : la limite de pages a été atteinte avant de rejoindre les jours récents. Certains jours proches d'aujourd'hui peuvent manquer — réessayer ou contacter le support si le problème persiste.
    </div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>{filtered.length} jour{filtered.length>1?'s':''} de planning</div>
    {Object.keys(byDate).length===0?<Empty icon={Calendar} msg="Aucune donnée de planning à venir."/>:
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {Object.entries(byDate).map(([d,rows])=><div key={d}>
          <div style={{fontSize:12,fontWeight:700,color:T.textMuted,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6,paddingLeft:4}}>{date(d)}</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {rows.map((r,i)=>{
              const room=r.room_name||r.product_real_name;
              return <Card key={r.composite_id||i} style={{padding:12}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{r.event_name||'Événement'}</div>
              {room&&<div style={{display:'inline-flex',alignItems:'center',gap:5,marginTop:3,marginBottom:5,padding:'3px 9px 3px 7px',borderRadius:7,background:T.brandTint,maxWidth:'100%'}}><MapPin size={13} color={T.brandStrong} style={{flexShrink:0}}/><span style={{fontSize:13.5,fontWeight:700,color:T.brandStrong,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{room}</span></div>}
              <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:room?0:4}}>
                {r.assembly_date_start_client&&<div style={{fontSize:11.5,color:T.textMuted,display:'flex',gap:6}}>
                  <span style={{color:T.info,fontWeight:500}}>Montage client</span>
                  <span>{date(r.assembly_date_start_client)}{r.assembly_date_end_client&&r.assembly_date_end_client!==r.assembly_date_start_client?` → ${date(r.assembly_date_end_client)}`:''}</span>
                </div>}
                {r.assembly_date_start_intern&&<div style={{fontSize:11.5,color:T.textMuted,display:'flex',gap:6}}>
                  <span style={{color:T.secondary,fontWeight:500}}>Montage interne</span>
                  <span>{date(r.assembly_date_start_intern)}{r.assembly_date_end_intern&&r.assembly_date_end_intern!==r.assembly_date_start_intern?` → ${date(r.assembly_date_end_intern)}`:''}</span>
                </div>}
                {r.disassembly_date_start_client&&<div style={{fontSize:11.5,color:T.textMuted,display:'flex',gap:6}}>
                  <span style={{color:T.warning,fontWeight:500}}>Démontage client</span>
                  <span>{date(r.disassembly_date_start_client)}{r.disassembly_date_end_client&&r.disassembly_date_end_client!==r.disassembly_date_start_client?` → ${date(r.disassembly_date_end_client)}`:''}</span>
                </div>}
                {r.assembly_comment_client&&<div style={{fontSize:11.5,color:T.textMuted,borderLeft:`2px solid ${T.border}`,paddingLeft:6,marginTop:2}}>{strip(r.assembly_comment_client).slice(0,100)}</div>}
              </div>
              {r.day_number&&<div style={{fontSize:11,color:T.textSubtle,marginTop:4}}>Jour {r.day_number}</div>}
            </Card>;})}
          </div>
        </div>)}
      </div>}
  </div>;
}

// ─── ContactDetail ───────────────────────────────────────────────
function ContactDetail({contact: c, session, onBack, onCompanyClick}) {
  const [tab,setTab]=useState('infos');
  const coName=(c.company?.name||'').toLowerCase();
  const cName=[c.name,c.last_name].filter(Boolean).join(' ').toLowerCase();

  const relEvents=()=>{try{const k=Object.keys(localStorage).find(k=>k.includes('analytics_events')&&!k.includes('vue'));return k?cacheArr(k).filter(e=>(e.contact_name||'').toLowerCase().includes(cName)||(e.company_name||'').toLowerCase()===coName).sort((a,b)=>new Date(b.events_date_from||0)-new Date(a.events_date_from||0)):[];}catch{return [];}};
  const relQuotes=()=>{try{const k=Object.keys(localStorage).find(k=>k.includes('quotes'));return k?cacheArr(k).filter(q=>(q.customer||'').toLowerCase()===coName).sort((a,b)=>new Date(b.date_of_quote||0)-new Date(a.date_of_quote||0)):[];}catch{return [];}};
  const relActivities=()=>{try{const k=Object.keys(localStorage).find(k=>k.includes('activity'));return k?cacheArr(k).filter(a=>(a.client_contact_name||'').toLowerCase().includes(cName)||(a.corporation_client_name||'').toLowerCase()===coName).sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)):[];}catch{return [];}};

  const evts=relEvents(); const quotes=relQuotes(); const acts=relActivities();

  const civLabel=c.civility==='1'?'Mme':c.civility==='2'?'M.':c.civility||'';
  const fullName=[civLabel,c.name,c.last_name].filter(Boolean).join(' ');

  const tabs=[{k:'infos',label:'Infos'},{k:'events',label:`Événements (${evts.length})`},{k:'docs',label:`Devis (${quotes.length})`},{k:'activities',label:`Activités (${acts.length})`}];

  return <div>
    <BackHeader title={fullName||'Contact'} subtitle={c.position||c.company?.name} onBack={onBack}/>
    <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,background:T.surface,display:'flex',position:'sticky',top:52,zIndex:7}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setTab(t.k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 4px',fontSize:11,fontWeight:tab===t.k?600:400,color:tab===t.k?T.brand:T.textMuted,borderBottom:tab===t.k?`2px solid ${T.brand}`:'2px solid transparent'}}>{t.label}</button>)}
    </div>
    <div style={{padding:'12px 16px 32px'}}>
      {tab==='infos'&&<>
        <Card style={{marginBottom:12}}>
          {[
            {label:'Email',value:c.email,link:`mailto:${c.email}`},
            {label:'Mobile',value:c.mobile,link:`tel:${c.mobile}`},
            {label:'Téléphone',value:c.phone,link:`tel:${c.phone}`},
            {label:'Poste',value:c.position},
            {label:'Société',value:c.company?.name,onClick:()=>{if(c.company&&onCompanyClick)onCompanyClick(c.company);}},
            {label:'Standard',value:c.standard},
          ].filter(f=>f.value&&f.value!=='null').map((f,i,arr)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 16px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',gap:12}}>
            <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
            {f.link?<a href={f.link} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{f.value}</a>
            :f.onClick?<button onClick={f.onClick} style={{background:'none',border:'none',cursor:'pointer',fontSize:13,fontWeight:500,color:T.brand,padding:0}}>{f.value}</button>
            :<span style={{fontSize:13,fontWeight:500,color:T.ink}}>{f.value}</span>}
          </div>)}
        </Card>
      </>}
      {tab==='events'&&(evts.length===0?<Empty icon={Calendar} msg="Aucun événement lié."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {evts.map((ev,i)=><Card key={i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ev.event_name}</div>
                <div style={{fontSize:12,color:T.textMuted}}>{date(ev.events_date_from)} · {ev.number_of_persons||'—'} pers.</div>
              </div>
              <div style={{textAlign:'right'}}>
                {ev.quotes_sell_price_sign&&<div style={{fontSize:13,fontWeight:700,color:T.success}}>{money(ev.quotes_sell_price_sign)}</div>}
                {ev.win_lost&&<Badge label={ev.win_lost} color={ev.win_lost==='Gagné'?T.success:ev.win_lost==='Perdu'?T.danger:T.warning}/>}
              </div>
            </div>
          </Card>)}
        </div>)}
      {tab==='docs'&&(quotes.length===0?<Empty icon={FileText} msg="Aucun devis lié."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {quotes.map((q,i)=><Card key={i} style={{padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{q.title||q.event||q.nb}</div>
                <div style={{fontSize:11.5,color:T.textMuted}}>{q.nb} · {date(q.date_of_quote)}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:13,fontWeight:700}}>{money(q.total_ht||q.ttc)} <span style={{fontSize:10,color:T.textMuted}}>HT</span></div>
                {q.status&&<Badge label={q.status} color={/sign/i.test(q.status)?T.success:/rejet|annul/i.test(q.status)?T.danger:T.warning}/>}
              </div>
            </div>
          </Card>)}
        </div>)}
      {tab==='activities'&&(acts.length===0?<Empty icon={Activity} msg="Aucune activité liée."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {acts.map((a,i)=><Card key={i} style={{padding:12}}>
            <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{a.type||'Activité'} {a.category?`· ${a.category}`:''}</div>
            {a.event_name&&<div style={{fontSize:12,color:T.textMuted,display:'flex',alignItems:'center',gap:4}}><Calendar size={11}/>{a.event_name}</div>}
            {a.comment&&<div style={{fontSize:12,color:T.textMuted,marginTop:4,borderLeft:`2px solid ${T.border}`,paddingLeft:6}}>{strip(a.comment).slice(0,100)}</div>}
            <div style={{fontSize:11,color:T.textSubtle,marginTop:4,display:'flex',gap:8}}>
              {a.date&&<span><Clock size={10}/> {date(a.date)}</span>}
              {a.deadline&&<span style={{color:a.deadline_is_expired?T.danger:T.textSubtle}}>Échéance: {date(a.deadline)}</span>}
            </div>
          </Card>)}
        </div>)}
    </div>
  </div>;
}

// ─── Support ──────────────────────────────────────────────────────
const SUPPORT_CONTENT = [
  {
    section: 'Aperçu',
    icon: '📊',
    items: [
      { label: 'À venir', desc: 'Nombre d\'événements dont la date de début est dans le futur (données sur 2 ans).' },
      { label: 'Devis en cours', desc: 'Devis actifs : ni signés, ni annulés, ni rejetés. Tous les devis "vivants".' },
      { label: 'CA signé total', desc: 'Somme TTC des devis signés par le client, sur tous les événements des 2 dernières années.' },
      { label: 'CA ce mois', desc: 'CA TTC des devis signés dont la date d\'émission est dans les 30 derniers jours.' },
      { label: 'Pipeline En cours / Gagnés / Perdus', desc: 'Comptage des événements par résultat commercial (champ "win_lost" de chaque événement).' },
      { label: 'Prochains événements', desc: 'Les 5 prochains événements futurs, triés par date de début.' },
    ]
  },
  {
    section: 'Événements',
    icon: '📅',
    items: [
      { label: 'Liste', desc: 'Tous les événements des 2 dernières années, triés du plus récent au plus ancien.' },
      { label: 'Filtres pipeline', desc: 'Filtrer par résultat : Tous / En Cours / Gagné / Perdu.' },
      { label: 'Filtres date', desc: 'Fenêtres glissantes : 30j / 90j / 6 mois / 1 an / 2 ans à partir d\'aujourd\'hui.' },
      { label: 'Fiche événement', desc: 'CA signé, CA total, marge. Onglets : Devis, Factures, Paiements, Activités, Planning (réservations de salles).' },
      { label: 'Société cliquable', desc: 'Cliquer sur le nom de la société ouvre la fiche société.' },
    ]
  },
  {
    section: 'Finances',
    icon: '💶',
    items: [
      { label: 'Devis / Factures / Paiements', desc: 'Données des 2 dernières années par défaut. Filtres par fenêtre glissante (30j, 90j, 6m, 1an, 2ans).' },
      { label: 'Clé de tri', desc: 'Devis triés par date d\'émission. Factures par date de facture. Paiements par date de virement.' },
      { label: 'Lignes de devis/facture', desc: 'Les articles proviennent de vue-analytics-light. Ils apparaissent 2-3 secondes après ouverture (chargement à la demande).' },
      { label: 'TVA', desc: 'Affichée sous forme "10% : 87 € · 20% : 47 €" (taux : montant HT).' },
    ]
  },
  {
    section: 'Activités',
    icon: '✅',
    items: [
      { label: 'Filtres', desc: 'Toutes / En retard (deadline_is_expired) / Bientôt (deadline_is_soon_expired mais pas encore expiré).' },
      { label: 'Voir événement / Voir client', desc: 'Navigue directement vers la fiche événement ou société dans l\'app.' },
      { label: 'Données', desc: 'Activités sur 2 ans, triées par date décroissante.' },
    ]
  },
  {
    section: 'Contacts',
    icon: '👥',
    items: [
      { label: 'Sociétés', desc: 'Toutes les sociétés clientes. Cliquer ouvre la fiche avec contacts liés, événements, devis, factures, activités.' },
      { label: 'Contacts', desc: 'Tous les contacts. Cliquer ouvre la fiche avec ses activités, événements, devis.' },
      { label: 'Recherche', desc: 'Filtre en temps réel sur le nom, la ville (sociétés) ou le nom, email, poste (contacts).' },
      { label: 'Données fraîches', desc: 'Sociétés et contacts sont chargés en pagination complète (toutes les pages).' },
    ]
  },
  {
    section: 'Rentabilité',
    icon: '📈',
    items: [
      { label: 'Données', desc: 'Agrégation de toutes les lignes de devis/factures par section (Hébergement, Restauration, Animation…).' },
      { label: 'Filtre Signés uniquement', desc: 'Filtre sur les statuts commençant par "Signé" (Signé par le client, Signé électroniquement…).' },
      { label: 'Filtre période', desc: 'Fenêtres glissantes : 30j / 90j / 6m / 1an / 2ans sur la date de l\'événement.' },
      { label: 'Taux de marge', desc: 'Marge / CA vendu × 100. Vert ≥ 30%, Orange ≥ 15%, Rouge < 15%.' },
    ]
  },
  {
    section: 'Analytics produits',
    icon: '🛍️',
    items: [
      { label: 'Données', desc: 'Agrégation des lignes de devis/factures par article (good_name). Total CA = somme de tous les sell_price.' },
      { label: 'Filtre section', desc: 'Liste déroulante pour filtrer par section (product_name).' },
      { label: 'Tri', desc: 'Par CA décroissant ou par volume (nombre de fois vendu).' },
      { label: '× vendu', desc: 'Nombre d\'occurrences de l\'article dans les documents de la période.' },
    ]
  },
  {
    section: 'Cache & données',
    icon: '⚡',
    items: [
      { label: 'Rafraîchissement', desc: 'Données affichées instantanément depuis le cache. Rafraîchissement silencieux en arrière-plan après 30 min. Forçage du re-fetch après 2h.' },
      { label: 'Prefetch au login', desc: 'Toutes les sections sont chargées en arrière-plan dès la connexion pour une navigation fluide.' },
      { label: 'Factures/devis récents', desc: 'Si un document vient d\'être créé dans Lab-event, patienter 2h maximum ou recharger la page pour qu\'il apparaisse.' },
    ]
  },
];


// ─── Support / Aide ───────────────────────────────────────────────
function Support({onBack}) {
  const [open,setOpen]=useState(null);
  const sections=[
    {
      id:'glossaire', title:'Les mots clés à connaître', icon:'📖',
      items:[
        {q:'C\'est quoi un Devis ?', a:'Un devis, c\'est une proposition de prix que tu envoies à ton client avant la vente. Il dit : "voilà ce qu\'on propose, voilà combien ça coûte". Le client peut accepter (signer) ou refuser. Tant qu\'il n\'est pas signé, c\'est juste une proposition.'},
        {q:'C\'est quoi une Facture ?', a:'La facture vient après le devis signé. C\'est le document officiel qui dit "tu nous dois cet argent". C\'est la facture que le client doit payer. On peut en envoyer plusieurs pour un même événement (acompte, solde...).'},
        {q:'C\'est quoi HT vs TTC ?', a:'HT = Hors Taxe = le prix SANS TVA. C\'est ton chiffre d\'affaires réel avant impôts.\n\nTTC = Toutes Taxes Comprises = le prix AVEC TVA = ce que le client paye vraiment.\n\nExemple : 1 000 € HT avec 20% de TVA = 1 200 € TTC.\n\n👉 Dans l\'app, les montants des devis et factures sont en HT. Les paiements encaissés sont en TTC.'},
        {q:'C\'est quoi le CA ?', a:'CA = Chiffre d\'Affaires. C\'est le total de ce que tu vends (ou as vendu). Ce n\'est pas ton bénéfice — c\'est le total des ventes avant de retirer tes coûts.'},
        {q:'C\'est quoi la Marge ?', a:'La marge, c\'est ce qu\'il te reste une fois que tu as payé tes prestataires et fournisseurs. Si tu vends un événement 10 000 € et que tes coûts sont 6 000 €, ta marge est 4 000 €.\n\nLe taux de marge, c\'est ce reste exprimé en % du CA. 40% de marge = tu gardes 40% de ce que tu factures.'},
        {q:'C\'est quoi Gagné / Perdu / En cours ?', a:'"Gagné" = l\'événement a eu lieu et a été vendu avec succès.\n"Perdu" = le client est parti chez un concurrent ou a annulé.\n"En cours" = on travaille encore dessus, c\'est dans le pipeline commercial.\n\nCes statuts sont saisis manuellement dans Lab-event.'},
        {q:'C\'est quoi le Pipeline commercial ?', a:'Le pipeline, c\'est la liste de tes opportunités en cours. Imagine un entonnoir : en haut il y a plein de demandes, et à la fin il n\'en reste qu\'un certain nombre de signées. L\'app te montre combien tu en as à chaque étape.'},
      ]
    },
    {
      id:'apercu', title:'Écran Aperçu — le tableau de bord', icon:'📊',
      items:[
        {q:'À venir — c\'est quoi ?', a:'C\'est le nombre de tes événements qui ont une date DANS LE FUTUR (à partir d\'aujourd\'hui). Si tu cliques dessus, tu vois la liste de ces événements. Exemple : tu as 13 événements planifiés dans les semaines/mois qui viennent.'},
        {q:'Devis en cours — c\'est quoi ?', a:'C\'est le nombre de devis que tu as envoyés et qui sont ni signés, ni annulés, ni refusés. En gros : les propositions qui "attendent" une réponse de tes clients. Si tu cliques, tu vois ces devis.'},
        {q:'CA HT signé 12 mois — comment c\'est calculé ?', a:'C\'est la somme (en euros HT) de tous les devis que tes clients ont signés et dont l\'événement tombe dans les 12 derniers mois. ⚠️ Attention : on utilise la date de l\'événement, pas la date à laquelle le client a signé — parce que Lab-event ne donne pas cette info directement.'},
        {q:'CA HT signé ce mois — comment c\'est calculé ?', a:'C\'est la somme (en euros HT) des devis signés ce mois-ci. On utilise la date du devis comme référence (pas la date de signature exacte — voir point précédent). Si tu cliques, tu vois ces devis.'},
        {q:'Prochains événements — pourquoi je n\'en vois que 5 ?', a:'Pour garder l\'écran clair et rapide, on affiche les 5 prochains événements. Si tu en as plus (ex: 13), tu verras un bouton "Voir les 13 →" qui t\'emmène vers la liste complète. Le chiffre sur la card "À venir" indique TOUJOURS le vrai total.'},
        {q:'En cours / Gagnés / Perdus — c\'est quoi ?', a:'Ce sont les compteurs de ton pipeline. "Gagnés" et "Perdus" sont définis manuellement dans Lab-event sur chaque fiche événement. "En cours" = tous les événements qui n\'ont pas encore de résultat final.'},
      ]
    },
    {
      id:'events', title:'Écran Événements', icon:'📅',
      items:[
        {q:'Pourquoi je vois seulement 2 ans d\'événements ?', a:'L\'app charge les données des 2 dernières années. C\'est un choix technique pour que l\'app reste rapide. Si tu as besoin de voir des événements plus anciens, utilise Lab-event directement.'},
        {q:'C\'est quoi les filtres en haut ?', a:'Les filtres de date (30j, 90j, 6 mois, 1 an, 2 ans) montrent les événements dont la DATE DE DÉBUT tombe dans cette fenêtre glissante.\n\nLes filtres pipeline (Tous, En cours, Gagné, Perdu) filtrent selon le résultat de l\'événement.'},
        {q:'Qu\'est-ce que je vois dans le détail d\'un événement ?', a:'- Les informations générales (dates, client, commercial...)\n- Les Devis liés à cet événement\n- Les Factures liées\n- Les Paiements reçus\n- Les Activités (tâches, rappels...)\n- Le Planning des salles réservées\n\nTout ça est automatiquement filtré pour ne montrer que ce qui concerne CET événement.'},
        {q:'Pourquoi le CA HT de l\'événement est différent du total du devis (TTC) ?', a:'Normal ! Le CA de l\'événement est en HT (sans TVA). Le montant du devis en TTC inclut la TVA. Exemple : CA HT 31 900 € × 1,20 (TVA 20%) = 38 280 € TTC. Les deux chiffres sont corrects, ils mesurent la même chose différemment.'},
      ]
    },
    {
      id:'finances', title:'Écran Finances', icon:'💶',
      items:[
        {q:'Devis — qu\'est-ce que je vois ?', a:'La liste de tous tes devis sur les 2 dernières années. Les montants sont en HT (sans TVA). Tu peux filtrer par période (30j, 90j...) et chercher par nom, numéro ou client. En cliquant sur un devis, tu vois toutes ses lignes de produits.'},
        {q:'Factures — qu\'est-ce que je vois ?', a:'La liste de toutes tes factures. Comme les devis, les montants sont en HT. La facture peut avoir différents statuts : Brouillon (pas encore envoyée), Finalisée (envoyée), Payée (tout est réglé).'},
        {q:'Paiements — qu\'est-ce que je vois ?', a:'Ici tu vois les acomptes et règlements que tes clients ont versés. Ces montants sont en TTC (avec TVA), parce que c\'est ce que le client a réellement payé. Tu vois aussi le "reste à percevoir" = ce qu\'il reste à encaisser.'},
        {q:'Pourquoi les montants HT et TTC sont différents ?', a:'La TVA ! En France, la TVA standard est à 20%. Donc :\n- 1 000 € HT + 20% TVA = 1 200 € TTC\nLe client paie 1 200 €, mais ton CA est de 1 000 € (tu reverses 200 € à l\'État).'},
        {q:'C\'est quoi les lignes dans le détail d\'un devis ?', a:'Ce sont les articles et prestations qui composent le devis : hébergement, restauration, animation, etc. Chaque ligne a un nom, une section (catégorie) et un montant. Ces informations viennent directement de Lab-event.'},
      ]
    },
    {
      id:'rentabilite', title:'Écran Rentabilité', icon:'📈',
      items:[
        {q:'À quoi ça sert ?', a:'La rentabilité, ça répond à la question : "Sur quels types de prestations je gagne le plus d\'argent ?" Tu vois par exemple que tu as 51% de marge sur la Restauration mais 92% sur la Privatisation. Ça t\'aide à savoir où concentrer tes efforts.'},
        {q:'"Signés uniquement" vs "Tous les documents" — quelle différence ?', a:'"Signés uniquement" = seulement les devis que tes clients ont acceptés. C\'est TON VRAI CA, ce que tu as vraiment vendu.\n\n"Tous les documents" inclut aussi les devis en attente, brouillons, proformas. C\'est le CA POTENTIEL si tout se concrétise. Commence par "Signés uniquement" pour voir la réalité.'},
        {q:'Le taux de marge — comment le lire ?', a:'C\'est le % de ce que tu gardes. 40% de marge = sur 100 € que tu factures, 40 € restent dans ta poche (après avoir payé tes prestataires).\n\nCode couleur :\n🟢 ≥ 30% = bonne marge\n🟠 Entre 15% et 30% = à surveiller\n🔴 < 15% = marge faible, attention'},
        {q:'Pourquoi certaines sections s\'appellent "N/A" ?', a:'"N/A" = les lignes de devis sans catégorie de prestation renseignée dans Lab-event. Pour avoir des données plus propres, il faut s\'assurer que chaque ligne de devis a bien une section (Hébergement, Restauration...) dans Lab-event.'},
      ]
    },
    {
      id:'analytics', title:'Analytics produits', icon:'🏷️',
      items:[
        {q:'À quoi ça sert ?', a:'C\'est pour savoir quels sont tes produits/services les plus vendus. Par exemple : "Location salon" apparaît 162 fois pour 5,9M€ de CA. Ça t\'aide à identifier tes best-sellers et à comprendre ce que tes clients achètent le plus.'},
        {q:'CA — c\'est le chiffre de toute la période ?', a:'Oui ! Le CA d\'un article, c\'est la somme de toutes ses occurrences sur la période choisie. Si "Cocktails" apparaît dans 50 devis à 200€ chaque fois, le CA affiché est 10 000 €.'},
        {q:'× vendus — c\'est quoi exactement ?', a:'C\'est le nombre de fois où cet article apparaît dans un devis ou une facture. Ce n\'est pas le nombre d\'unités vendues, c\'est le nombre de documents qui contiennent cet article.'},
        {q:'PU moyen — c\'est quoi ?', a:'PU = Prix Unitaire. C\'est le prix moyen de cet article calculé sur toutes ses ventes. Utile pour vérifier si tes prix sont cohérents et si tu vends toujours au même tarif.'},
      ]
    },
    {
      id:'contacts', title:'Clients & Contacts', icon:'👥',
      items:[
        {q:'Quelle différence entre Société et Contact ?', a:'Une Société, c\'est l\'entreprise (ex: "ADEZ", "Decathlon"). Un Contact, c\'est une personne physique dans cette entreprise (ex: "Marine Sahnoune, Directrice commerciale"). Une société peut avoir plusieurs contacts.'},
        {q:'Qu\'est-ce que je vois dans la fiche d\'une société ?', a:'- Ses contacts (personnes)\n- Ses événements passés et futurs\n- Ses devis et factures\n- Ses activités (tâches en cours)\n\nTout ça te permet de voir en un coup d\'œil tout l\'historique avec ce client.'},
        {q:'Je peux appeler ou écrire directement depuis l\'app ?', a:'Oui ! Si l\'email ou le téléphone d\'un contact est renseigné, il apparaît en bleu cliquable. Appuie dessus pour appeler ou envoyer un email directement.'},
      ]
    },
    {
      id:'activites', title:'Activités', icon:'✅',
      items:[
        {q:'C\'est quoi une Activité ?', a:'Une activité, c\'est une tâche ou un suivi commercial. Par exemple : "Appeler le client pour valider le menu", "Envoyer la facture d\'acompte", "Relancer pour signature du devis". Chaque activité a une date limite (échéance).'},
        {q:'C\'est quoi "En retard" ?', a:'Une activité "En retard" = son échéance est passée et elle n\'a pas été faite. C\'est urgent ! Par exemple : "Faire la facture - échéance 01 juil. 2026" et on est le 5 juillet → c\'est en retard.'},
        {q:'C\'est quoi "Bientôt" ?', a:'"Bientôt" = l\'échéance arrive dans les prochains jours. Ce ne sont PAS des activités en retard, juste des activités à faire rapidement pour éviter qu\'elles deviennent en retard.'},
        {q:'Je peux naviguer vers l\'événement depuis une activité ?', a:'Oui ! Sur chaque activité, tu as des boutons "Voir événement" et "Voir client" qui t\'emmènent directement vers la fiche correspondante dans l\'app.'},
      ]
    },
    {
      id:'planning', title:'Planning & Salles', icon:'🏨',
      items:[
        {q:'Planning salles — c\'est quoi ?', a:'C\'est la liste de toutes les réservations de salles sur les 2 dernières années. Tu vois quelle salle est réservée pour quel événement, à quelles heures.'},
        {q:'Planning dans une fiche événement — c\'est différent ?', a:'Oui ! Dans le détail d\'un événement, l\'onglet Planning montre UNIQUEMENT les salles réservées pour CET événement spécifique. C\'est beaucoup plus ciblé.'},
      ]
    },
    {
      id:'tri', title:'Dans quel ordre s\'affichent les données ?', icon:'🔢',
      items:[
        {q:'Les événements — comment sont-ils classés ?', a:'Les événements à venir apparaissent EN PREMIER, du plus proche au plus lointain.\n\nEnsuite viennent les événements passés, du plus récent au plus ancien.\n\nExemple : si tu as un event demain, un dans 3 semaines, et deux de l\'année dernière → tu verras :\n1. Demain\n2. Dans 3 semaines\n3. Il y a 1 mois\n4. Il y a 6 mois'},
        {q:'Les devis — comment sont-ils classés ?', a:'Par date d\'émission, du plus récent en premier. Le dernier devis que tu as créé apparaît en haut de la liste. Logique : c\'est le plus "chaud", celui sur lequel tu travailles probablement en ce moment.'},
        {q:'Les factures — comment sont-elles classées ?', a:'Par date de facture, de la plus récente en premier. Même logique que les devis.'},
        {q:'Les paiements — comment sont-ils classés ?', a:'Par date de paiement, du plus récent en premier. Tu vois en premier les derniers encaissements.'},
        {q:'Les sociétés — comment sont-elles classées ?', a:'Par ordre alphabétique (A → Z) sur le nom de la société. Comme un annuaire. Tu peux utiliser la recherche pour trouver directement ce que tu cherches.'},
        {q:'Les contacts — comment sont-ils classés ?', a:'Par ordre alphabétique (A → Z) sur le prénom + nom. Comme un répertoire téléphonique.'},
        {q:'Les activités — comment sont-elles classées ?', a:'Par urgence d\'abord ! Les activités en retard (échéance dépassée) remontent tout en haut. Ensuite les autres, par ordre d\'échéance croissante (celle qui arrive le plus vite en premier).\n\nLe but : tu vois immédiatement ce qui est urgent sans chercher.'},
        {q:'La rentabilité et les articles — comment sont-ils classés ?', a:'Par chiffre d\'affaires décroissant. La catégorie ou l\'article qui génère le plus de CA apparaît en premier. Ça te permet de voir immédiatement tes meilleurs produits et tes meilleures sections.'},
      ]
    },
    {
      id:'refresh', title:'Données & Mises à jour', icon:'🔄',
      items:[
        {q:'Les données sont-elles en temps réel ?', a:'Presque ! L\'app garde une copie locale de tes données pour être rapide. Elles se mettent à jour automatiquement toutes les 30 minutes en arrière-plan. Après 2 heures sans activité, un rechargement complet se fait automatiquement.'},
        {q:'J\'ai créé un événement dans Lab-event, pourquoi il n\'apparaît pas ?', a:'Il apparaîtra au prochain rafraîchissement automatique (maximum 2 heures). Si tu veux voir tes données immédiatement, déconnecte-toi et reconnecte-toi — ça force un rechargement complet.'},
        {q:'L\'app couvre quelle période ?', a:'Par défaut, toutes les sections montrent les 2 dernières années. Tu peux réduire la fenêtre avec les filtres (30j, 90j, 6 mois, 1 an). Mais tu ne peux pas voir au-delà de 2 ans dans l\'app mobile — utilise Lab-event pour ça.'},
        {q:'Je ne trouve pas ce que je cherche dans l\'app ?', a:'L\'app mobile est conçue pour les consultations rapides et les actions simples (créer un événement, voir un devis, appeler un client). Pour tout ce qui est édition complexe, configuration, ou données historiques, utilise directement Lab-event sur ton navigateur.'},
      ]
    },
  ];

  return <div>
    <BackHeader title="Support & Aide" onBack={onBack}/>
    <div style={{padding:'16px 16px 32px'}}>
      <div style={{background:T.brandSubtle,border:`1px solid ${T.brandTint}`,borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:13,color:T.brandStrong,lineHeight:1.6}}>
        💡 Tu ne comprends pas un chiffre ou un écran ? La réponse est ici. On a écrit ces explications pour que tout le monde comprenne, même sans formation technique.
      </div>
      {sections.map(s=><div key={s.id} style={{marginBottom:10}}>
        <button onClick={()=>setOpen(open===s.id?null:s.id)} style={{width:'100%',background:T.surface,border:`1px solid ${open===s.id?T.brand:T.border}`,borderRadius:open===s.id?'10px 10px 0 0':10,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer',textAlign:'left'}}>
          <span style={{fontSize:14,fontWeight:600,color:T.ink}}>{s.icon} {s.title}</span>
          <span style={{fontSize:16,color:open===s.id?T.brand:T.textMuted,transform:open===s.id?'rotate(180deg)':'none',transition:'transform 0.2s'}}>▾</span>
        </button>
        {open===s.id&&<div style={{border:`1px solid ${T.brand}`,borderTop:'none',borderRadius:'0 0 10px 10px',overflow:'hidden'}}>
          {s.items.map((item,i)=><div key={i} style={{padding:'14px 16px',borderBottom:i<s.items.length-1?`1px solid ${T.border}`:'none',background:i%2===0?T.surface:'#f9fafb'}}>
            <div style={{fontSize:13,fontWeight:700,color:T.ink,marginBottom:6}}>❓ {item.q}</div>
            <div style={{fontSize:13,color:T.text,lineHeight:1.7,whiteSpace:'pre-line'}}>{item.a}</div>
          </div>)}
        </div>}
      </div>)}
    </div>
  </div>;
}
