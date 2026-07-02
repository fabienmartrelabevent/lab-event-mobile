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

function buildSubdomain(s) {
  return s.trim().replace(/^https?:\/\//,'').replace(/\.lab-event\.com.*$/,'').replace(/\/$/,'');
}

async function api(subdomain, token, path, { method='GET', body }={}) {
  const url = `${PROXY}/api/proxy?path=${encodeURIComponent(path)}`;
  // Inject per_page for POST analytics calls to bypass default pagination limit
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

// ─── Helpers ─────────────────────────────────────────────────────
const money = n => n==null||isNaN(n)?'—':new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
const date  = d => { if(!d) return '—'; try { return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(d)); } catch{return d;} };
const strip = h => h ? h.replace(/<[^>]*>/g,'').trim() : '';

// ─── Shared Components ───────────────────────────────────────────
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
        api(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{}}),
        api(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{}}),
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
  const upcoming=(events||[]).filter(e=>e.events_date_from&&new Date(e.events_date_from)>=now);
  const pending=(quotes||[]).filter(q=>!/sign|annul|rejet/i.test(q.status||''));
  const totalSigned=(events||[]).reduce((s,e)=>s+(Number(e.quotes_sell_price_sign)||0),0);
  const won=(events||[]).filter(e=>e.win_lost==='Gagné').length;

  return <div style={{padding:16}}>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
      <StatCard icon={Calendar} label="Événements à venir" value={upcoming.length} accent={T.brand}/>
      <StatCard icon={FileText} label="Devis en attente" value={pending.length} accent={T.warning}/>
      <StatCard icon={Euro} label="CA signé" value={money(totalSigned)} accent={T.success}/>
      <StatCard icon={TrendingUp} label="Gagnés" value={won} accent={T.info}/>
    </div>
    <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:'20px 0 10px'}}>Prochains événements</h2>
    {upcoming.length===0?<Empty icon={Calendar} msg="Aucun événement à venir."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {upcoming.slice(0,5).map((ev,i)=><EventRow key={ev.event_id||i} event={ev} onClick={()=>onEventClick(ev)}/>)}
      </div>}
  </div>;
}

function EventRow({event,onClick}) {
  return <Card onClick={onClick} style={{padding:14,display:'flex',alignItems:'center',gap:12}}>
    <div style={{width:40,height:40,borderRadius:10,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
      <Calendar size={18} color={T.brand} strokeWidth={2.2}/>
    </div>
    <div style={{flex:1,minWidth:0}}>
      <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{event.event_name||'Événement sans nom'}</div>
      <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:'flex',gap:10,flexWrap:'wrap'}}>
        <span style={{display:'flex',alignItems:'center',gap:4}}><Clock size={11}/>{date(event.events_date_from)}</span>
        {event.number_of_persons?<span style={{display:'flex',alignItems:'center',gap:4}}><Users size={11}/>{event.number_of_persons}</span>:null}
        {event.win_lost?<Badge label={event.win_lost} color={event.win_lost==='Gagné'?T.success:event.win_lost==='Perdu'?T.danger:T.warning}/>:null}
      </div>
    </div>
    <ChevronRight size={16} color={T.textSubtle}/>
  </Card>;
}

// ─── Event Detail ────────────────────────────────────────────────
function EventDetail({event,onBack}) {
  const fields=[
    {label:'Date début',value:date(event.events_date_from)},
    {label:'Date fin',value:date(event.events_date_to)},
    {label:'Personnes',value:event.number_of_persons||'—'},
    {label:'Client',value:event.customer||'—'},
    {label:'Commercial',value:event.member||'—'},
    {label:'Statut',value:event.status_name||'—'},
    {label:'CA signé (TTC)',value:money(event.quotes_sell_price_sign)},
    {label:'CA devis (TTC)',value:money(event.quotes_sell_price)},
    {label:'Résultat',value:event.win_lost||'—'},
    {label:'Lieu',value:event.place||'—'},
    {label:'Type',value:event.event_type||'—'},
  ];

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'16px 16px 8px'}}>
      <button onClick={onBack} style={{background:'none',border:'none',cursor:'pointer',color:T.brand,display:'flex',alignItems:'center',gap:4,fontSize:13,fontWeight:500}}>
        <ChevronLeft size={18}/> Retour
      </button>
    </div>
    <div style={{padding:'0 16px 16px'}}>
      <h1 style={{fontSize:18,fontWeight:700,color:T.ink,margin:'0 0 4px'}}>{event.event_name||'Événement'}</h1>
      {event.status_name&&<Badge label={event.status_name} color={T.brand}/>}
      <Card style={{marginTop:16}}>
        {fields.map((f,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderBottom:i<fields.length-1?`1px solid ${T.border}`:'none',gap:12}}>
          <span style={{fontSize:13,color:T.textMuted,flexShrink:0}}>{f.label}</span>
          <span style={{fontSize:13,fontWeight:500,color:T.ink,textAlign:'right'}}>{f.value}</span>
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

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await api(session.subdomain,session.token,'/v3/analytics/events',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(selected) return <EventDetail event={selected} onBack={()=>setSelected(null)}/>;
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const sorted=[...(items||[])].sort((a,b)=>new Date(b.events_date_from||0)-new Date(a.events_date_from||0));

  return <div style={{padding:16}}>
    <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:'0 0 12px'}}>Événements ({sorted.length})</h2>
    {sorted.length===0?<Empty icon={Calendar} msg="Aucun événement."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((ev,i)=><EventRow key={ev.event_id||i} event={ev} onClick={()=>setSelected(ev)}/>)}
      </div>}
  </div>;
}

// ─── Planning ────────────────────────────────────────────────────
function Planning({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{const d=await api(session.subdomain,session.token,'/v3/analytics/events/vue-planning',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}
    catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const sorted=[...(items||[])].sort((a,b)=>new Date(a.start_at||0)-new Date(b.start_at||0));

  return <div style={{padding:16}}>
    <h2 style={{fontSize:14,fontWeight:600,color:T.ink,margin:'0 0 12px'}}>Planning salles</h2>
    {sorted.length===0?<Empty icon={Calendar} msg="Aucune réservation planifiée."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((item,i)=><Card key={item.schedule_id||i} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{item.event_name||'Sans nom'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:4,display:'flex',gap:10,flexWrap:'wrap'}}>
                <span style={{display:'flex',alignItems:'center',gap:4}}><Clock size={11}/>{date(item.start_at)}</span>
                {item.room_name&&<span style={{display:'flex',alignItems:'center',gap:4}}><MapPin size={11}/>{item.room_name}</span>}
              </div>
            </div>
            {item.status_name&&<Badge label={item.status_name} color={item.status_color||T.brand}/>}
          </div>
        </Card>)}
      </div>}
  </div>;
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

function Quotes({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await api(session.subdomain,session.token,'/v3/analytics/finance-documents/quotes',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date_of_quote||0)-new Date(a.date_of_quote||0));
  return <div style={{padding:16}}>
    {sorted.length===0?<Empty icon={FileText} msg="Aucun devis."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((q,i)=><Card key={q.quote_id||i} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{q.title||q.event||'Devis'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{q.nb} · {date(q.date_of_quote)}</div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.ink}}>{money(q.ttc)}</div>
              {q.status&&<Badge label={q.status} color={/sign/i.test(q.status)?T.success:/rejet|annul/i.test(q.status)?T.danger:T.warning}/>}
            </div>
          </div>
        </Card>)}
      </div>}
  </div>;
}

function Bills({session}) {
  const [items,setItems]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await api(session.subdomain,session.token,'/v3/analytics/finance-documents/bills',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.date||0)-new Date(a.date||0));
  return <div style={{padding:16}}>
    {sorted.length===0?<Empty icon={Receipt} msg="Aucune facture."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((b,i)=><Card key={b.bill_id||i} style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{b.event||b.customer||'Facture'}</div>
              <div style={{fontSize:12,color:T.textMuted,marginTop:2}}>{b.nb} · {date(b.date)}</div>
              {b.contact_name&&<div style={{fontSize:12,color:T.textMuted}}>{b.contact_name}</div>}
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
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
  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await api(session.subdomain,session.token,'/v3/analytics/bill-prepayments',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;
  const sorted=[...(items||[])].sort((a,b)=>new Date(b.prepayment_date||0)-new Date(a.prepayment_date||0));
  return <div style={{padding:16}}>
    {sorted.length===0?<Empty icon={CreditCard} msg="Aucun paiement."/>:
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map((p,i)=><Card key={p.id||i} style={{padding:14}}>
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

  const load=useCallback(async()=>{setLoading(true);setErr('');try{const d=await api(session.subdomain,session.token,'/v3/analytics/activity',{method:'POST',body:{}});setItems(Array.isArray(d)?d:[]);}catch(e){setErr(e.message);}finally{setLoading(false);}},  [session]);
  useEffect(()=>{load();},[load]);
  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const all=items||[];
  const expired=all.filter(a=>a.deadline_is_expired);
  const soon=all.filter(a=>!a.deadline_is_expired&&a.deadline_is_soon_expired);
  const normal=all.filter(a=>!a.deadline_is_expired&&!a.deadline_is_soon_expired);

  const filtered=filter==='expired'?expired:filter==='soon'?soon:all;
  const filters=[{k:'all',label:`Toutes (${all.length})`},{k:'expired',label:`En retard (${expired.length})`},{k:'soon',label:`Bientôt (${soon.length})`}];

  return <div style={{padding:16}}>
    {expired.length>0&&<div style={{display:'flex',alignItems:'center',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12.5,color:T.danger}}>
      <AlertTriangle size={15}/><span>{expired.length} activité{expired.length>1?'s':''} en retard</span>
    </div>}
    <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
      {filters.map(f=><button key={f.k} onClick={()=>setFilter(f.k)} style={{padding:'5px 12px',borderRadius:999,border:`1px solid ${filter===f.k?T.brand:T.border}`,background:filter===f.k?T.brandTint:'none',color:filter===f.k?T.brand:T.textMuted,fontSize:12,fontWeight:filter===f.k?600:400,cursor:'pointer'}}>{f.label}</button>)}
    </div>
    {filtered.length===0?<Empty icon={Activity} msg="Aucune activité."/>:
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

// ─── Contacts ────────────────────────────────────────────────────
function Contacts({session}) {
  const [companies,setCompanies]=useState(null);
  const [customers,setCustomers]=useState(null);
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(true);
  const [sub,setSub]=useState('companies');

  const load=useCallback(async()=>{
    setLoading(true);setErr('');
    try{
      const [co,cu]=await Promise.all([
        api(session.subdomain,session.token,'/v3/customer-company'),
        api(session.subdomain,session.token,'/v3/customers'),
      ]);
      setCompanies(Array.isArray(co)?co:co?.data||[]);
      setCustomers(Array.isArray(cu)?cu:cu?.data||[]);
    } catch(e){setErr(e.message);}finally{setLoading(false);}
  },[session]);
  useEffect(()=>{load();},[load]);

  if(loading) return <Spinner/>;
  if(err) return <ErrBanner msg={err} onRetry={load}/>;

  const tabs=[{k:'companies',label:`Sociétés (${(companies||[]).length})`},{k:'contacts',label:`Contacts (${(customers||[]).length})`}];

  return <div>
    <div style={{display:'flex',borderBottom:`1px solid ${T.border}`,background:T.surface,position:'sticky',top:60,zIndex:5}}>
      {tabs.map(t=><button key={t.k} onClick={()=>setSub(t.k)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'12px 8px',fontSize:13,fontWeight:sub===t.k?600:400,color:sub===t.k?T.brand:T.textMuted,borderBottom:sub===t.k?`2px solid ${T.brand}`:'2px solid transparent'}}>{t.label}</button>)}
    </div>
    <div style={{padding:16}}>
      {sub==='companies'&&((companies||[]).length===0?<Empty icon={Building2} msg="Aucune société."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {(companies||[]).map((c,i)=><Card key={c.id||i} style={{padding:14}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:9,background:T.brandTint,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Building2 size={16} color={T.brand}/></div>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name||'Sans nom'}</div>
                {c.city&&<div style={{fontSize:12,color:T.textMuted}}>{c.city}{c.country?`, ${c.country}`:''}</div>}
              </div>
            </div>
          </Card>)}
        </div>)}
      {sub==='contacts'&&((customers||[]).length===0?<Empty icon={UserRound} msg="Aucun contact."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {(customers||[]).map((c,i)=><Card key={c.id||i} style={{padding:14}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:9,background:`${T.info}1a`,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><UserRound size={16} color={T.info}/></div>
              <div style={{minWidth:0,flex:1}}>
                <div style={{fontSize:13.5,fontWeight:600,color:T.ink}}>{[c.civility,c.name,c.last_name].filter(Boolean).join(' ')||'Sans nom'}</div>
                {c.position&&<div style={{fontSize:12,color:T.textMuted}}>{c.position}</div>}
                <div style={{display:'flex',gap:12,marginTop:4,flexWrap:'wrap'}}>
                  {c.email&&<a href={`mailto:${c.email}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Mail size={11}/>{c.email}</a>}
                  {(c.mobile||c.phone)&&<a href={`tel:${c.mobile||c.phone}`} style={{fontSize:12,color:T.brand,display:'flex',alignItems:'center',gap:3,textDecoration:'none'}}><Phone size={11}/>{c.mobile||c.phone}</a>}
                </div>
              </div>
            </div>
          </Card>)}
        </div>)}
    </div>
  </div>;
}

// ─── Quick Create Event Modal ─────────────────────────────────────
function QuickCreateModal({session,onClose,onSuccess}) {
  const [name,setName]=useState('');
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [persons,setPersons]=useState('');
  const [notes,setNotes]=useState('');
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState('');
  const [done,setDone]=useState(false);

  const submit=async()=>{
    if(!name.trim()){setErr('Le nom de l\'événement est requis.');return;}
    setLoading(true);setErr('');
    try{
      await api(session.subdomain,session.token,'/v3/events/quick/create',{method:'POST',body:{
        event_name:name.trim(),
        date_from:dateFrom||undefined,
        date_to:dateTo||undefined,
        number_of_persons:persons?parseInt(persons):undefined,
        notes:notes||undefined,
      }});
      setDone(true);
    }catch(e){setErr(e.message);}finally{setLoading(false);}
  };

  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
    <div style={{background:T.surface,borderRadius:'20px 20px 0 0',width:'100%',maxWidth:500,padding:24,boxShadow:'0 -8px 32px rgba(0,0,0,0.15)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={{fontSize:16,fontWeight:700,color:T.ink,margin:0}}>Nouvel événement</h2>
        <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted}}><X size={20}/></button>
      </div>
      {done?<div style={{textAlign:'center',padding:'24px 0'}}>
        <CheckCircle2 size={40} color={T.success} style={{marginBottom:12}}/>
        <p style={{fontSize:14,color:T.text,margin:'0 0 20px'}}>Événement créé avec succès !</p>
        <button onClick={onSuccess} style={{padding:'10px 24px',borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer'}}>Fermer</button>
      </div>:<>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Nom de l'événement *</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Ex: Séminaire direction 2026" style={{width:'100%',minHeight:44,padding:'0 12px',marginBottom:16,border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box'}}/>
        <div style={{display:'flex',gap:12,marginBottom:16}}>
          <div style={{flex:1}}>
            <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Date début</label>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{width:'100%',minHeight:44,padding:'0 12px',border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box'}}/>
          </div>
          <div style={{flex:1}}>
            <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Date fin</label>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{width:'100%',minHeight:44,padding:'0 12px',border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box'}}/>
          </div>
        </div>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Nombre de personnes</label>
        <input type="number" value={persons} onChange={e=>setPersons(e.target.value)} placeholder="Ex: 50" style={{width:'100%',minHeight:44,padding:'0 12px',marginBottom:16,border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box'}}/>
        <label style={{display:'block',fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>Notes</label>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="Informations complémentaires…" style={{width:'100%',padding:'10px 12px',marginBottom:16,border:`1px solid ${T.border}`,borderRadius:8,fontSize:14,color:T.ink,outline:'none',boxSizing:'border-box',resize:'none',fontFamily:'inherit'}}/>
        {err&&<div style={{display:'flex',gap:8,background:`${T.danger}0d`,border:`1px solid ${T.danger}33`,borderRadius:8,padding:'10px 12px',marginBottom:16,fontSize:12.5,color:T.danger}}><AlertCircle size={16}/><span>{err}</span></div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',minHeight:44,borderRadius:8,border:'none',background:T.brand,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {loading&&<Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>}{loading?'Création…':'Créer l\'événement'}
        </button>
      </>}
    </div>
  </div>;
}

// ─── App Shell ───────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null);
  const [tab,setTab]=useState('dashboard');
  const [showCreate,setShowCreate]=useState(false);
  const [eventDetail,setEventDetail]=useState(null);

  if(!session) return <Login onLogin={setSession}/>;

  const tabs=[
    {k:'dashboard',label:'Aperçu',icon:LayoutDashboard},
    {k:'events',label:'Événements',icon:Calendar},
    {k:'finances',label:'Finances',icon:Euro},
    {k:'activites',label:'Activités',icon:Activity},
    {k:'contacts',label:'Contacts',icon:Users},
  ];

  return <div style={{minHeight:'100vh',background:T.surfaceMuted,fontFamily:"'Roboto','Helvetica Neue',Arial,sans-serif",display:'flex',flexDirection:'column'}}>
    <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,zIndex:10}}>
      <div>
        <div style={{fontSize:15,fontWeight:700,color:T.ink}}>Lab-event</div>
        <div style={{fontSize:11.5,color:T.textMuted}}>{session.subdomain}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <button onClick={()=>setShowCreate(true)} style={{width:34,height:34,borderRadius:9,background:T.brand,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 2px 8px rgba(0,179,181,0.3)'}}>
          <Plus size={18} color="#fff" strokeWidth={2.5}/>
        </button>
        <button onClick={()=>setSession(null)} style={{background:'none',border:'none',cursor:'pointer',color:T.textMuted,display:'flex',alignItems:'center',gap:4,fontSize:12}}>
          <LogOut size={15}/>
        </button>
      </div>
    </div>

    <div style={{flex:1,overflowY:'auto',paddingBottom:72}}>
      {tab==='dashboard'&&<Dashboard session={session} onEventClick={ev=>{setEventDetail(ev);setTab('events');}}/>}
      {tab==='events'&&(eventDetail?<EventDetail event={eventDetail} onBack={()=>setEventDetail(null)}/>:<Events session={session}/>)}
      {tab==='finances'&&<Finances session={session}/>}
      {tab==='activites'&&<Activites session={session}/>}
      {tab==='contacts'&&<Contacts session={session}/>}
    </div>

    <div style={{position:'fixed',bottom:0,left:0,right:0,background:T.surface,borderTop:`1px solid ${T.border}`,display:'flex',boxShadow:'0 -4px 16px rgba(16,24,40,0.06)'}}>
      {tabs.map(({k,label,icon:Icon})=><button key={k} onClick={()=>{setTab(k);if(k!=='events')setEventDetail(null);}} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 0 12px',display:'flex',flexDirection:'column',alignItems:'center',gap:4,color:tab===k?T.brand:T.textMuted,transition:'color 0.18s'}}>
        <Icon size={18} strokeWidth={tab===k?2.4:2.2}/>
        <span style={{fontSize:9.5,fontWeight:tab===k?600:400}}>{label}</span>
      </button>)}
    </div>

    {showCreate&&<QuickCreateModal session={session} onClose={()=>setShowCreate(false)} onSuccess={()=>{setShowCreate(false);setTab('events');}}/>}
    <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
  </div>;
}
