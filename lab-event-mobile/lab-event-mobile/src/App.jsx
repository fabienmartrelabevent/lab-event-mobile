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
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes avant rafraîchissement silencieux
const CACHE_MAX = 30 * 60 * 1000; // 30 minutes max (force refresh)

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
const BIG_PATHS = ['analytics_events','vue_analytics_light','rentability','planning_by_day','partner_companies'];
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
  const key = cacheKey(subdomain, path + JSON.stringify(opts.body||''));
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
function Dashboard({session,onEventClick}) {
  const [events,setEvents]=useState(null);
  const [quotes,setQuotes]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);

  const load = useCallback(async()=>{
    setLoading(true);setErr('');
    try {
      const [e,q]=await Promise.all([
        api(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{events_date_from:dateJ2Ans()}}),
        api(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{date_from:dateJ2Ans()}}),
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
  const upcoming=(events||[]).filter(e=>e.events_date_from&&new Date(e.events_date_from)>=now).sort((a,b)=>new Date(a.events_date_from)-new Date(b.events_date_from));
  const pending=(quotes||[]).filter(q=>!/sign|annul|rejet/i.test(q.status||''));
  const totalSigned=(events||[]).reduce((s,e)=>s+(Number(e.quotes_sell_price_sign)||0),0);
  const won=(events||[]).filter(e=>e.win_lost==='Gagné').length;
  const lost=(events||[]).filter(e=>e.win_lost==='Perdu').length;
  const inProgress=(events||[]).filter(e=>!e.win_lost||e.win_lost==='En cours').length;
  const signedThisMonth=(quotes||[]).filter(q=>q.date_of_quote&&new Date(q.date_of_quote)>=thisMonth&&/sign/i.test(q.status||''));
  const caThisMonth=signedThisMonth.reduce((s,q)=>s+(Number(q.ttc)||0),0);

  return <div style={{padding:16}}>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
      <StatCard icon={Calendar} label="À venir" value={upcoming.length} accent={T.brand}/>
      <StatCard icon={FileText} label="Devis en cours" value={pending.length} accent={T.warning}/>
      <StatCard icon={Euro} label="CA signé total" value={money(totalSigned)} accent={T.success}/>
      <StatCard icon={Euro} label="CA ce mois" value={money(caThisMonth)} accent={T.info}/>
    </div>
    {/* Pipeline */}
    <div style={{display:'flex',gap:8,marginBottom:16}}>
      {[{label:'En cours',val:inProgress,color:T.info},{label:'Gagnés',val:won,color:T.success},{label:'Perdus',val:lost,color:T.danger}].map(p=><div key={p.label} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 8px',textAlign:'center'}}>
        <div style={{fontSize:18,fontWeight:700,color:p.color}}>{p.val}</div>
        <div style={{fontSize:11,color:T.textMuted}}>{p.label}</div>
      </div>)}
    </div>
    <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:'16px 0 10px'}}>Prochains événements</h2>
    {upcoming.length===0?<Empty icon={Calendar} msg="Aucun événement à venir."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {upcoming.slice(0,5).map((ev,i)=><EventRow key={ev.event_id||i} event={ev} onClick={()=>onEventClick(ev)}/>)}
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
        <span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{date(event.events_date_from)}</span>
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
  return <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'0 16px',position:'sticky',top:60,zIndex:8,display:'flex',alignItems:'center',gap:10,minHeight:52,boxShadow:'0 2px 8px rgba(16,24,40,0.04)'}}>
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
function EventDetail({event,onBack}) {
  const wl=event.win_lost;
  const wlColor=wl==='Gagné'?T.success:wl==='Perdu'?T.danger:T.warning;
  const fields=[
    {label:'Date début',value:date(event.events_date_from)},
    {label:'Date fin',value:date(event.events_date_to)},
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
  ].filter(f=>f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value));

  return <div>
    <BackHeader title={event.event_name||'Événement'} subtitle={event.company_name||event.customer} onBack={onBack} badge={wl?<Badge label={wl} color={wlColor}/>:null}/>
    <div style={{padding:'20px 16px 24px'}}>
      {event.status_name&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>
        <Badge label={event.status_name} color={T.brand}/>
      </div>}
      {/* CA Cards */}
      {[money(event.quotes_sell_price_sign),money(event.quotes_sell_price),money(event.total_marge)].some(v=>v!=='—')&&<div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[
          {label:'CA signé TTC',value:money(event.quotes_sell_price_sign),accent:T.success},
          {label:'CA total TTC',value:money(event.quotes_sell_price),accent:T.brand},
          {label:'Marge',value:money(event.total_marge),accent:T.info},
        ].filter(f=>f.value!=='—').map((f,i)=><div key={i} style={{flex:1,minWidth:90,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'9px 12px',textAlign:'center'}}>
          <div style={{fontSize:10.5,color:T.textMuted,marginBottom:2}}>{f.label}</div>
          <div style={{fontSize:13.5,fontWeight:700,color:f.accent}}>{f.value}</div>
        </div>)}
      </div>}
      <Card>
        {fields.map((f,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'11px 16px',borderBottom:i<fields.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          {(f.label==='Email'&&f.value&&f.value!=='null')?<a href={`mailto:${f.value}`} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{f.value}</a>
          :(f.label==='Téléphone'&&f.value&&f.value!=='null')?<a href={`tel:${f.value}`} style={{fontSize:13,fontWeight:500,color:T.brand,textDecoration:'none'}}>{f.value}</a>
          :<span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{safeStr(f.value)}</span>}
        </div>)}
      </Card>
    </div>
  </div>;
}

// ─── Events list ─────────────────────────────────────────────────
function Events({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState(null);
  const [search,setSearch]=useState('');
  const [pipeline,setPipeline]=useState(''); // ← doit être avant tout return conditionnel

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{events_date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(selected) return <EventDetail event={selected} onBack={()=>setSelected(null)}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.events_date_from||0)-new Date(a.events_date_from||0));
  const pipelines=[...new Set(sorted.map(e=>e.win_lost).filter(Boolean))];
  const filtered=sorted.filter(e=>{
    const mQ=!q||(e.event_name||'').toLowerCase().includes(q)||(e.customer||'').toLowerCase().includes(q)||(e.company_name||'').toLowerCase().includes(q)||(e.contact_name||'').toLowerCase().includes(q)||(e.status_name||'').toLowerCase().includes(q)||(e.place||'').toLowerCase().includes(q);
    const mP=!pipeline||e.win_lost===pipeline;
    return mQ&&mP;
  });

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom événement, client, lieu…"/>
    {pipelines.length>0&&<div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
      <button onClick={()=>setPipeline('')} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${!pipeline?T.brand:T.border}`,background:!pipeline?T.brandTint:'none',color:!pipeline?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:!pipeline?600:400}}>Tous</button>
      {pipelines.map(p=><button key={p} onClick={()=>setPipeline(p===pipeline?'':p)} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${pipeline===p?T.brand:T.border}`,background:pipeline===p?T.brandTint:'none',color:pipeline===p?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:pipeline===p?600:400}}>{p}</button>)}
    </div>}
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} événement{filtered.length>1?'s':''}{(q||pipeline)?` sur ${sorted.length}`:''}</div>
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

  const [search,setSearch]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/events/vue-planning',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(a.start_at||0)-new Date(b.start_at||0));
  const filtered=q?sorted.filter(i=>
    (i.event_name||'').toLowerCase().includes(q)||
    (i.room_name||'').toLowerCase().includes(q)||
    (i.status_name||'').toLowerCase().includes(q)
  ):sorted;

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom événement, salle…"/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} réservation{filtered.length>1?'s':''}{q?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={Calendar} msg={q?"Aucun résultat.":"Aucune réservation planifiée."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((item,i)=>{
          const room=item.product_real_name||item.room_name||item.name;
          const client=[item.customer_name,item.customer_last_name].filter(Boolean).join(' ')||item.company_name;
          const timeStr=item.start_at&&item.end_at?`${dateTime(item.start_at).split(' ').slice(1).join(' ')} → ${dateTime(item.end_at).split(' ').slice(1).join(' ')}`:date(item.start_at);
          return <Card key={item.schedule_id||i} style={{padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.event_name||'Sans nom'}</div>
                {client&&<div style={{fontSize:12,color:T.brand,fontWeight:500,marginTop:1}}>{client}</div>}
                <div style={{fontSize:12,color:T.textMuted,marginTop:3,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  {date(item.event_date_from||item.start_at)&&<span style={{display:'flex',alignItems:'center',gap:3}}><Calendar size={11}/>{date(item.event_date_from||item.start_at)}</span>}
                  {item.start_at&&<span style={{display:'flex',alignItems:'center',gap:3}}><Clock size={11}/>{item.start_at.substring(11,16)} → {(item.end_at||'').substring(11,16)}</span>}
                  {room&&<span style={{display:'flex',alignItems:'center',gap:3}}><MapPin size={11}/>{room}</span>}
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
    {k:'', label:'2 ans'},
    {k:'year', label:'Cette année'},
    {k:'month', label:'Ce mois'},
    {k:'quarter', label:'Ce trimestre'},
  ];
  return <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
    {opts.map(o=><button key={o.k} onClick={()=>onChange(o.k)} style={{padding:'4px 10px',borderRadius:999,border:`1px solid ${value===o.k?T.brand:T.border}`,background:value===o.k?T.brandTint:'none',color:value===o.k?T.brand:T.textMuted,fontSize:11,cursor:'pointer',fontWeight:value===o.k?600:400}}>{o.label}</button>)}
  </div>;
}
function applyDateFilter(items, dateField, period) {
  if (!period) return items;
  const now = new Date();
  let from;
  if (period==='month') from=new Date(now.getFullYear(),now.getMonth(),1);
  else if (period==='quarter') from=new Date(now.getFullYear(),Math.floor(now.getMonth()/3)*3,1);
  else if (period==='year') from=new Date(now.getFullYear(),0,1);
  return items.filter(i=>i[dateField]&&new Date(i[dateField])>=from);
}

// ─── Finances ────────────────────────────────────────────────────
function Finances({session}) {
  const [sub,setSub]=useState('quotes');
  const tabs=[{k:'quotes',label:'Devis'},{k:'bills',label:'Factures'},{k:'payments',label:'Paiements'}];
  return <div>
    <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,background:T.surface,position:'sticky',top:60,zIndex:5}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setSub(t.k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'12px 8px',fontSize:13,fontWeight:sub===t.k?600:400,color:sub===t.k?T.brand:T.textMuted,borderBottom:sub===t.k?`2px solid ${T.brand}`:'2px solid transparent',transition:'all 0.18s'}}>{t.label}</button>)}
    </div>
    {sub==='quotes'&&<Quotes session={session}/>}
    {sub==='bills'&&<Bills session={session}/>}
    {sub==='payments'&&<Payments session={session}/>}
  </div>;
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

function QuoteDetail({quote:q, session, onBack}) {
  const [lines,setLines]=useState(null);
  const [renta,setRenta]=useState(null);
  const [loadingLines,setLoadingLines]=useState(true);

  useEffect(()=>{
    // Load lines from vue-analytics-light filtered by document_id
    Promise.all([
      apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:dateJ2Ans()}}).catch(()=>null),
      apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:dateJ2Ans()}}).catch(()=>null),
    ]).then(([analytics,rentability])=>{
      const docId = q.id || q.quote_id;
      if(Array.isArray(analytics)) setLines(analytics.filter(l=>String(l.document_id)===String(docId)));
      if(Array.isArray(rentability)) setRenta(rentability.filter(r=>String(r.document_id)===String(docId)));
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
  ].filter(f=>f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value));

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
      {!loadingLines&&lines&&lines.length>0&&<div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
        {lines.map((l,i)=>{
          const rLine=renta?.find(r=>r.goods_section===l.good_name||r.goods_section===l.product_name);
          return <Card key={i} style={{padding:12}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{l.product_name||l.good_name||'—'}</div>
                {l.document_type&&<Badge label={l.document_type} color={T.info}/>}
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                {l.sell_price&&<div style={{fontSize:13,fontWeight:700,color:T.brand}}>{money(l.sell_price)}</div>}
                {l.price&&<div style={{fontSize:11.5,color:T.textMuted}}>PU : {money(l.price)}</div>}
                {rLine?.margin&&<div style={{fontSize:11.5,color:T.success}}>Marge : {money(rLine.margin)}</div>}
              </div>
            </div>
          </Card>;
        })}
      </div>}

      {/* Sections brutes si pas de lignes analytics */}
      {!loadingLines&&(!lines||lines.length===0)&&sections.length>0&&<div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
        {sections.filter(s=>s.sellPrice||s.price).map((s,i)=><Card key={i} style={{padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{fontSize:13,fontWeight:600,color:T.ink}}>
              {safeStr(s.name||s.title||s.goods_section||s.col_1||`Section ${i+1}`)}
              {s.col_2&&s.col_2!==s.col_1&&<span style={{fontSize:11.5,color:T.textMuted,fontWeight:400,marginLeft:6}}>{safeStr(s.col_2)}</span>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {s.sellPrice&&<div style={{fontSize:13.5,fontWeight:700,color:T.brand}}>{money(s.sellPrice)}</div>}
              {s.price&&Number(s.price)!==Number(s.sellPrice)&&<div style={{fontSize:11.5,color:T.textMuted}}>PU : {money(s.price)}</div>}
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
          <span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>
        </div>)}
      </Card>

      {q.info&&<Card style={{padding:14}}>
        <div style={{fontSize:12,fontWeight:600,color:T.textMuted,marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>Notes</div>
        <div style={{fontSize:13,color:T.text,lineHeight:1.6}}>{strip(safeStr(q.info))}</div>
      </Card>}
    </div>
  </div>;
}

function Quotes({session, onDetailChange=()=>{}}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState(null);
  const [datePeriod,setDatePeriod]=useState('');
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ onDetailChange(!!selected); },[selected]);
  if(selected) return <QuoteDetail quote={selected} session={session} onBack={()=>setSelected(null)}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date_of_quote||0)-new Date(a.date_of_quote||0));
  const byDate=applyDateFilter(sorted,'date_of_quote',datePeriod);
  const filtered=q?byDate.filter(d=>
    (d.title||'').toLowerCase().includes(q)||
    (d.event||'').toLowerCase().includes(q)||
    (d.nb||'').toLowerCase().includes(q)||
    (d.customer||'').toLowerCase().includes(q)||
    (d.status||'').toLowerCase().includes(q)
  ):byDate;
  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Nom, numéro, client, statut…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} devis{(q||datePeriod)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={FileText} msg={q?"Aucun résultat.":"Aucun devis."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((item,i)=><Card key={item.quote_id||i} onClick={()=>setSelected(item)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{item.title||item.event||'Devis'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{item.nb} · {date(item.date_of_quote)}</div>
              {item.customer&&<div style={{fontSize:12,color:T.textMuted}}>{item.customer}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(item.ttc)}</div>
              {item.status&&<Badge label={item.status} color={/sign/i.test(item.status)?T.success:/rejet|annul/i.test(item.status)?T.danger:T.warning}/>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

function BillDetail({bill:b, session, onBack}) {
  const [lines,setLines]=useState(null);
  const [renta,setRenta]=useState(null);
  const [loadingLines,setLoadingLines]=useState(true);

  useEffect(()=>{
    const docId = b.id || b.bill_id;
    Promise.all([
      apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:dateJ2Ans()}}).catch(()=>null),
      apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:dateJ2Ans()}}).catch(()=>null),
    ]).then(([analytics,rentability])=>{
      if(Array.isArray(analytics)) setLines(analytics.filter(l=>String(l.document_id)===String(docId)));
      if(Array.isArray(rentability)) setRenta(rentability.filter(r=>String(r.document_id)===String(docId)));
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
  ].filter(f=>f.value&&f.value!=='null'&&f.value!=='undefined'&&safeStr(f.value));

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
      {!loadingLines&&lines&&lines.length>0&&<div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
        {lines.map((l,i)=><Card key={i} style={{padding:12}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{l.product_name||l.good_name||'—'}</div>
              {l.document_type&&<Badge label={l.document_type} color={T.info}/>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {l.sell_price&&<div style={{fontSize:13,fontWeight:700,color:T.brand}}>{money(l.sell_price)}</div>}
              {l.price&&<div style={{fontSize:11.5,color:T.textMuted}}>PU : {money(l.price)}</div>}
            </div>
          </div>
        </Card>)}
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
          <span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>
        </div>)}
      </Card>
    </div>
  </div>;
}

function Bills({session, onDetailChange=()=>{}}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState(null);
  const [datePeriod,setDatePeriod]=useState('');
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/bills',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  useEffect(()=>{ onDetailChange(!!selected); },[selected]);
  if(selected) return <BillDetail bill={selected} session={session} onBack={()=>setSelected(null)}/>;
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
  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Événement, client, numéro…"/>
    <DateFilter value={datePeriod} onChange={setDatePeriod}/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} facture{filtered.length>1?'s':''}{(q||datePeriod)?` sur ${sorted.length}`:''}</div>
    {filtered.length===0?<Empty icon={Receipt} msg={q?"Aucun résultat.":"Aucune facture."}/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((b,i)=><Card key={b.bill_id||i} onClick={()=>setSelected(b)} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.event||b.customer||'Facture'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{b.nb} · {date(b.date)}</div>
              {b.contact_name&&<div style={{fontSize:12,color:T.textMuted}}>{b.contact_name}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0,display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(b.ttc)}</div>
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
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/bill-prepayments',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
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
        {filtered.map((p,i)=><Card key={p.id||i} style={{padding:14}}>
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
function Activites({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');

  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/activity',{method:'POST',body:{date_from:dateJ2Ans()}},d=>{setItems(Array.isArray(d)?d:[])});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const all=items||[];
  const expired=all.filter(a=>a.deadline_is_expired);
  const soon=all.filter(a=>!a.deadline_is_expired&&a.deadline_is_soon_expired);

  const q=search.toLowerCase();
  const bySorted=[...all].sort((a,b)=>new Date(b.date||b.deadline||0)-new Date(a.date||a.deadline||0));
  const expired2=bySorted.filter(a=>a.deadline_is_expired);
  const soon2=bySorted.filter(a=>!a.deadline_is_expired&&a.deadline_is_soon_expired);
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
          const isExp=a.deadline_is_expired;
          const isSoon=a.deadline_is_soon_expired;
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
                {(a.event_link||a.corporation_client_link)&&<div style={{display:'flex',gap:6,marginTop:6}}>
                  {a.event_link&&<a href={a.event_link} target="_blank" rel="noopener noreferrer" style={{fontSize:11.5,color:T.brand,textDecoration:'none',border:`1px solid ${T.brand}`,borderRadius:6,padding:'3px 8px'}}>Voir événement</a>}
                  {a.corporation_client_link&&<a href={a.corporation_client_link} target="_blank" rel="noopener noreferrer" style={{fontSize:11.5,color:T.secondary,textDecoration:'none',border:`1px solid ${T.secondary}`,borderRadius:6,padding:'3px 8px'}}>Voir client</a>}
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
function CompanyDetail({company, allCustomers, onBack}) {
  const linked = allCustomers.filter(c =>
    c.company?.id === company.id ||
    c.company?.name?.toLowerCase() === (company.name||'').toLowerCase()
  );

  return <div>
    <BackHeader title={company.name||'Société'} subtitle={company.city&&`${company.city}${company.country?', '+company.country:''}`} onBack={onBack}/>
    <div style={{padding:'20px 16px 24px'}}>

      <Card style={{marginBottom:16}}>
        {[
          {label:'Ville', value:company.city},
          {label:'Pays', value:company.country},
          {label:'Code postal', value:company.data?.postal_code},
          {label:'SIRET', value:company.data?.nb_siret},
          {label:'N° TVA', value:company.data?.tva_number},
          {label:'Service', value:company.data?.service},
        ].filter(f=>f.value).map((f,i,arr)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'11px 16px',borderBottom:i<arr.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted}}>{f.label}</span>
          <span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>
        </div>)}
      </Card>

      <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:'0 0 10px'}}>
        Contacts liés ({linked.length})
      </h2>
      {linked.length===0
        ? <Empty icon={UserRound} msg="Aucun contact lié à cette société."/>
        : <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {linked.map((c,i)=><Card key={c.id||i} style={{padding:14}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:`${T.info}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <UserRound size={16} color={T.info}/>
                </div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{[c.civility,c.name,c.last_name].filter(Boolean).join(' ')||'Sans nom'}</div>
                  {c.position&&<div style={{fontSize:12,color:T.textMuted}}>{c.position}</div>}
                  <div style={{display:'flex',gap:10,marginTop:4,flexWrap:'wrap'}}>
                    {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Mail size={11}/>{c.email}</a>}
                    {(c.mobile||c.phone)&&<a href={`tel:${c.mobile||c.phone}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Phone size={11}/>{c.mobile||c.phone}</a>}
                  </div>
                </div>
              </div>
            </Card>)}
          </div>}
    </div>
  </div>;
}

// ─── Contacts ────────────────────────────────────────────────────
function Contacts({session}) {
  const [companies,setCompanies]=useState(null);
  const [customers,setCustomers]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [sub,setSub]=useState('companies');
  const [search,setSearch]=useState('');
  const [selectedCompany,setSelectedCompany]=useState(null);

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

  if(selectedCompany) return <CompanyDetail company={selectedCompany} allCustomers={customers||[]} onBack={()=>setSelectedCompany(null)}/>;

  const q=search.toLowerCase();
  const allCo=companies||[];
  const allCu=customers||[];
  const filteredCo=q?allCo.filter(c=>(c.name||'').toLowerCase().includes(q)||(c.city||'').toLowerCase().includes(q)):allCo;
  const filteredCu=q?allCu.filter(c=>[c.name,c.last_name,c.email,c.position].filter(Boolean).join(' ').toLowerCase().includes(q)):allCu;

  const tabs=[{k:'companies',label:`Sociétés (${allCo.length})`},{k:'contacts',label:`Contacts (${allCu.length})`}];

  return <div>
    <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,position:'sticky',top:60,zIndex:5}}>
      <div style={{display:'flex'}}>
        {tabs.map(t=><button key={t.k} onClick={()=>{setSub(t.k);setSearch('');}} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'12px 8px',fontSize:13,fontWeight:sub===t.k?600:400,color:sub===t.k?T.brand:T.textMuted,borderBottom:sub===t.k?`2px solid ${T.brand}`:'2px solid transparent'}}>{t.label}</button>)}
      </div>
      <div style={{padding:'8px 16px 10px'}}>
        <SearchBar value={search} onChange={setSearch} placeholder={sub==='companies'?'Nom société, ville…':'Nom, email, poste…'}/>
      </div>
    </div>
    <div style={{padding:'8px 16px 16px'}}>
      {sub==='companies'&&<>
        <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filteredCo.length} société{filteredCo.length>1?'s':''}{q?` sur ${allCo.length}`:''}</div>
        {filteredCo.length===0?<Empty icon={Building2} msg={q?'Aucun résultat.':'Aucune société.'}/>:
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {filteredCo.map((c,i)=><Card key={c.id||i} onClick={()=>setSelectedCompany(c)} style={{padding:14}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Building2 size={16} color={T.brand}/></div>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name||'Sans nom'}</div>
                  {c.city&&<div style={{fontSize:12,color:T.textMuted}}>{c.city}{c.country?`, ${c.country}`:''}</div>}
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
            {filteredCu.map((c,i)=><Card key={c.id||i} style={{padding:14}}>
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
      return k ? (JSON.parse(localStorage.getItem(k))?.data || []) : [];
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
  const [drawerOpen,setDrawerOpen]=useState(false);

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
  const extraTabs=['prestataires','rentabilite','analytics','scheduler','planning','articles','planningbyday'];
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
      {k:'scheduler',label:'Réservations',icon:MapPin},
      {k:'planningbyday',label:'Planning par jour',icon:Calendar},
    ]},
    {section:'Catalogue',items:[
      {k:'articles',label:'Articles',icon:FileText},
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
      {tab==='dashboard'&&<Dashboard session={session} onEventClick={ev=>{setEventDetail(ev);setTab('events');}}/>}
      {tab==='events'&&(eventDetail?<EventDetail event={eventDetail} onBack={()=>setEventDetail(null)}/>:<Events session={session}/>)}
      {tab==='finances'&&<Finances session={session}/>}
      {tab==='activites'&&<Activites session={session}/>}
      {tab==='contacts'&&<Contacts session={session}/>}
      {tab==='planning'&&<Planning session={session}/>}
      {tab==='prestataires'&&<Prestataires session={session}/>}
      {tab==='rentabilite'&&<Rentabilite session={session}/>}
      {tab==='analytics'&&<AnalyticsLight session={session}/>}
      {tab==='scheduler'&&<SchedulerView session={session}/>}
      {tab==='articles'&&<Articles session={session}/>}
      {tab==='planningbyday'&&<PlanningByDay session={session}/>}
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
function Prestataires({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/partner-companies',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:[]));setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

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
        {filtered.map((p,i)=><Card key={p.id||i} style={{padding:14}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:36,height:36,borderRadius:9,background:`${T.secondary}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Briefcase size={16} color={T.secondary}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name||'Sans nom'}</div>
              <div style={{display:'flex',gap:8,marginTop:3,flexWrap:'wrap'}}>
                {p.company_type&&<Badge label={p.company_type} color={T.secondary}/>}
                {p.country&&<span style={{fontSize:11.5,color:T.textMuted}}>{p.country}</span>}
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
  const [search,setSearch]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/rentability',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:[]));setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.event_date||0)-new Date(a.event_date||0));
  const filtered=q?sorted.filter(r=>
    (r.member||'').toLowerCase().includes(q)||
    (r.goods_section||'').toLowerCase().includes(q)||
    (r.status||'').toLowerCase().includes(q)||
    (r.document_type||'').toLowerCase().includes(q)
  ):sorted;

  // Totaux
  const totalPrice=filtered.reduce((s,r)=>s+(Number(r.sell_price)||0),0);
  const totalMargin=filtered.reduce((s,r)=>s+(Number(r.margin)||0),0);
  const marginPct=totalPrice>0?((totalMargin/totalPrice)*100).toFixed(1):0;

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Section, commercial, statut…"/>
    <div style={{display:'flex',gap:8,marginBottom:12}}>
      <div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
        <div style={{fontSize:11,color:T.textMuted}}>CA vendu</div>
        <div style={{fontSize:14,fontWeight:700,color:T.brand}}>{money(totalPrice)}</div>
      </div>
      <div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
        <div style={{fontSize:11,color:T.textMuted}}>Marge</div>
        <div style={{fontSize:14,fontWeight:700,color:T.success}}>{money(totalMargin)}</div>
      </div>
      <div style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 12px',textAlign:'center'}}>
        <div style={{fontSize:11,color:T.textMuted}}>Taux</div>
        <div style={{fontSize:14,fontWeight:700,color:T.info}}>{marginPct}%</div>
      </div>
    </div>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>{filtered.length} ligne{filtered.length>1?'s':''}</div>
    {filtered.length===0?<Empty icon={TrendingUp} msg="Aucune donnée de rentabilité."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((r,i)=><Card key={i} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink}}>{r.goods_section||r.document_type||'—'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                {r.member&&<span>{r.member}</span>}
                {r.event_date&&<span>{date(r.event_date)}</span>}
              </div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(r.sell_price)}</div>
              <div style={{fontSize:11.5,color:Number(r.margin)>0?T.success:T.danger}}>
                {money(r.margin)} {r.sell_price&&Number(r.sell_price)>0?`(${((Number(r.margin)/Number(r.sell_price))*100).toFixed(0)}%)`:''}
              </div>
            </div>
          </div>
          {r.status&&<div style={{marginTop:6}}><Badge label={r.status} color={r.signed?T.success:T.warning}/></div>}
        </Card>)}
      </div>}
  </div>;
}

// ─── Analytics light ──────────────────────────────────────────────
function AnalyticsLight({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/finance-documents/vue-analytics-light',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:[]));setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date_from||0)-new Date(a.date_from||0));
  const filtered=q?sorted.filter(a=>
    (a.product_name||'').toLowerCase().includes(q)||
    (a.good_name||'').toLowerCase().includes(q)||
    (a.document_type||'').toLowerCase().includes(q)
  ):sorted;

  const totalSell=filtered.reduce((s,a)=>s+(Number(a.sell_price)||0),0);

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Produit, type de document…"/>
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:'10px 14px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <span style={{fontSize:12,color:T.textMuted}}>{filtered.length} ligne{filtered.length>1?'s':''}</span>
      <span style={{fontSize:14,fontWeight:700,color:T.brand}}>Total : {money(totalSell)}</span>
    </div>
    {filtered.length===0?<Empty icon={TrendingUp} msg="Aucune donnée analytics."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((a,i)=><Card key={i} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{a.product_name||a.good_name||'Produit'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
                {a.document_type&&<Badge label={a.document_type} color={T.info}/>}
                {a.date_from&&<span>{date(a.date_from)}</span>}
              </div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              {a.sell_price&&<div style={{fontSize:13,fontWeight:700,color:T.ink}}>{money(a.sell_price)}</div>}
              {a.price&&a.sell_price!==a.price&&<div style={{fontSize:11.5,color:T.textMuted}}>PU : {money(a.price)}</div>}
            </div>
          </div>
        </Card>)}
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
      const d=await apiCached(session.subdomain,session.token,'/v3/scheduler',{method:'POST',body:{startDate:fmt(today),endDate:fmt(end)}},d=>setItems(d?.data||[]));
      setItems(d?.data||d||[]);
    }catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const flat=Array.isArray(items)?items:Object.values(items||{}).flat();
  const q=search.toLowerCase();
  const filtered=q?flat.filter(r=>(r.event_name||r.name||r.title||'').toLowerCase().includes(q)||(r.room_name||r.room||'').toLowerCase().includes(q)):flat;

  return <div style={{padding:16}}>
    <SearchBar value={search} onChange={setSearch} placeholder="Événement, salle…"/>
    <div style={{fontSize:12,color:T.textMuted,marginBottom:10}}>
      Planning {fmt(today)} → {fmt(end)} · {filtered.length} réservation{filtered.length!==1?'s':''}
    </div>
    {filtered.length===0?<Empty icon={Calendar} msg="Aucune réservation sur cette période."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {filtered.map((r,i)=><Card key={i} style={{padding:14}}>
          <div style={{display:'flex',alignItems:'flex-start',gap:12}}>
            <div style={{width:36,height:36,borderRadius:9,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Calendar size={16} color={T.brand}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{safeStr(r.event_name||r.name||r.title||'Réservation')}</div>
              {(r.room_name||r.room)&&<div style={{fontSize:12,color:T.textMuted,display:'flex',alignItems:'center',gap:4}}><MapPin size={11}/>{safeStr(r.room_name||r.room)}</div>}
              <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:8}}>
                {r.start_at&&<span><Clock size={11}/> {date(r.start_at)}</span>}
                {r.end_at&&<span>→ {date(r.end_at)}</span>}
              </div>
            </div>
            {(r.status||r.status_name)&&<Badge label={safeStr(r.status||r.status_name)} color={T.brand}/>}
          </div>
        </Card>)}
      </div>}
  </div>;
}

// ─── Articles / Goods ─────────────────────────────────────────────
function Articles({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const [filterSection,setFilterSection]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/goods',{method:'POST',body:{}},d=>setItems(Array.isArray(d)?d:[]));setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

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
        {filtered.map((a,i)=><Card key={a.id||i} style={{padding:14}}>
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

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await apiCached(session.subdomain,session.token,'/v3/analytics/events/vue-planning-by-day',{method:'POST',body:{date_from:dateJ2Ans()}},d=>setItems(Array.isArray(d)?d:[]));setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const q=search.toLowerCase();
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.day_date||0)-new Date(a.day_date||0));
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
    <div style={{fontSize:12,color:T.textMuted,marginBottom:12}}>{filtered.length} jour{filtered.length>1?'s':''} de planning</div>
    {Object.keys(byDate).length===0?<Empty icon={Calendar} msg="Aucune donnée de planning."/>:
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {Object.entries(byDate).map(([d,rows])=><div key={d}>
          <div style={{fontSize:12,fontWeight:700,color:T.textMuted,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:6,paddingLeft:4}}>{date(d)}</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {rows.map((r,i)=><Card key={r.composite_id||i} style={{padding:12}}>
              <div style={{fontSize:13,fontWeight:600,color:T.ink,marginBottom:4}}>{r.event_name||'Événement'}</div>
              <div style={{display:'flex',flexDirection:'column',gap:3}}>
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
            </Card>)}
          </div>
        </div>)}
      </div>}
  </div>;
}
