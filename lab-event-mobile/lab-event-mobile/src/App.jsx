import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, FileText, LayoutDashboard, LogOut, ChevronRight, AlertCircle, Loader2, TrendingUp, Clock, Euro, Users, MapPin, RefreshCw } from 'lucide-react';

// ---------- Design tokens (Lab-event Design System) ----------
const T = {
  brand: '#00b3b5',
  brandStrong: '#00aeb1',
  brandPressed: '#009da0',
  brandLight: '#26c0c3',
  brandTint: '#e6f7f7',
  brandSubtle: '#f3fbfb',
  success: '#0abb87',
  info: '#5578eb',
  warning: '#ffb822',
  danger: '#f44336',
  secondary: '#607d8b',
  ink: '#1b283f',
  text: '#464e5f',
  textMuted: '#80808f',
  textSubtle: '#b5b5c3',
  surface: '#ffffff',
  surfaceMuted: '#f9fafb',
  border: '#ecf0f3',
  borderStrong: '#e5eaee',
};

// ---------- API layer ----------
const PROXY_BASE_URL = 'https://lab-event-proxy.vercel.app';

function buildBaseUrl(subdomain) {
  const clean = subdomain.trim().replace(/^https?:\/\//, '').replace(/\.lab-event\.com.*$/, '').replace(/\/$/, '');
  return clean;
}

async function apiCall(subdomain, token, path, { method = 'GET', body } = {}) {
  const url = `${PROXY_BASE_URL}/api/proxy?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Subdomain': subdomain,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error || data?.message || `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return data;
}

// ---------- Helpers ----------
function formatMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
function formatDate(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d));
  } catch { return d; }
}
function statusBadgeStyle(color) {
  return {
    backgroundColor: color ? `${color}1a` : T.brandTint,
    color: color || T.brand,
    border: `1px solid ${color ? `${color}33` : T.brandLight}`,
  };
}

// ---------- Login screen ----------
function LoginScreen({ onLogin }) {
  const [subdomain, setSubdomain] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!subdomain.trim() || !token.trim()) {
      setError('Merci de renseigner le sous-domaine et le token.');
      return;
    }
    setLoading(true);
    const cleanSubdomain = buildBaseUrl(subdomain);
    try {
      // Lightweight validation call, routed through the CORS proxy
      await apiCall(cleanSubdomain, token.trim(), '/v3/countries');
      onLogin({ subdomain: cleanSubdomain, token: token.trim() });
    } catch (err) {
      const isNetworkError = err.message === 'Failed to fetch' || err.name === 'TypeError';
      const diagnostic = isNetworkError
        ? `Le proxy n'a pas pu être joint. Vérifie que PROXY_BASE_URL est bien configuré dans le code (URL Vercel).`
        : err.message;
      setError(diagnostic);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(160deg, ${T.brandSubtle} 0%, ${T.surface} 60%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: "'Roboto', 'Helvetica Neue', Arial, sans-serif",
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: `linear-gradient(135deg, ${T.brand}, ${T.brandLight})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 12px 32px rgba(0,179,181,0.25)',
          }}>
            <Calendar color="#fff" size={28} strokeWidth={2.2} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.ink, margin: 0, letterSpacing: 0.2 }}>
            Lab-event
          </h1>
          <p style={{ fontSize: 13, color: T.textMuted, margin: '4px 0 0' }}>
            Espace client — événements & devis
          </p>
        </div>

        <div onKeyDown={handleKeyDown} style={{
          background: T.surface,
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 4px 16px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.05)',
          border: `1px solid ${T.border}`,
        }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>
            Sous-domaine
          </label>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
            <input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              placeholder="mon-entreprise"
              style={{
                flex: 1, minHeight: 44, padding: '0 12px',
                border: `1px solid ${T.border}`, borderRadius: '8px 0 0 8px',
                fontSize: 14, color: T.ink, outline: 'none',
              }}
              onFocus={(e) => e.target.style.boxShadow = `0 0 0 4px rgba(0,179,181,0.15)`}
              onBlur={(e) => e.target.style.boxShadow = 'none'}
            />
            <span style={{
              minHeight: 44, display: 'flex', alignItems: 'center',
              padding: '0 12px', background: T.surfaceMuted,
              border: `1px solid ${T.border}`, borderLeft: 'none',
              borderRadius: '0 8px 8px 0', fontSize: 13, color: T.textMuted,
            }}>
              .lab-event.com
            </span>
          </div>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>
            Token API
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="••••••••••••••••"
            style={{
              width: '100%', minHeight: 44, padding: '0 12px', marginBottom: 20,
              border: `1px solid ${T.border}`, borderRadius: 8,
              fontSize: 14, color: T.ink, outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={(e) => e.target.style.boxShadow = `0 0 0 4px rgba(0,179,181,0.15)`}
            onBlur={(e) => e.target.style.boxShadow = 'none'}
          />

          {error && (
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              background: `${T.danger}0d`, border: `1px solid ${T.danger}33`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 16,
              fontSize: 12.5, color: T.danger, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%', minHeight: 44, borderRadius: 8, border: 'none',
              background: loading ? T.brandPressed : T.brand,
              color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background 0.18s ease',
              boxShadow: '0 4px 16px rgba(0,179,181,0.2)',
            }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11.5, color: T.textSubtle, marginTop: 16, lineHeight: 1.5 }}>
          Ces identifiants restent stockés uniquement sur cet appareil.
        </p>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---------- Shared UI bits ----------
function Card({ children, style }) {
  return (
    <div style={{
      background: T.surface,
      borderRadius: 12,
      border: `1px solid ${T.border}`,
      boxShadow: '0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04)',
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <Card style={{ padding: 16, flex: 1, minWidth: 140 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `${accent}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 10,
      }}>
        <Icon size={16} color={accent} strokeWidth={2.2} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: T.ink, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{label}</div>
    </Card>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: T.textMuted }}>
      <Icon size={32} color={T.textSubtle} style={{ marginBottom: 12 }} />
      <p style={{ fontSize: 13.5, margin: 0 }}>{message}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      background: `${T.danger}0d`, border: `1px solid ${T.danger}33`,
      borderRadius: 8, padding: '10px 14px', margin: '0 16px 16px', fontSize: 12.5, color: T.danger,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ lineHeight: 1.5 }}>{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{
          background: 'none', border: 'none', color: T.danger, cursor: 'pointer',
          display: 'flex', alignItems: 'center', flexShrink: 0,
        }}>
          <RefreshCw size={14} />
        </button>
      )}
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ session }) {
  const [events, setEvents] = useState(null);
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eventsData, quotesData] = await Promise.all([
        apiCall(session.subdomain, session.token, '/v3/analytics/events', { method: 'POST', body: {} }),
        apiCall(session.subdomain, session.token, '/v3/analytics/finance-documents/quotes', { method: 'POST', body: {} }),
      ]);
      setEvents(Array.isArray(eventsData) ? eventsData : []);
      setQuotes(Array.isArray(quotesData) ? quotesData : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  const now = new Date();
  const upcoming = (events || []).filter(e => e.events_date_from && new Date(e.events_date_from) >= now);
  const pendingQuotes = (quotes || []).filter(q => !/sign|annul|rejet/i.test(q.status || ''));
  const totalSigned = (events || []).reduce((sum, e) => sum + (Number(e.quotes_sell_price_sign) || 0), 0);
  const totalWon = (events || []).filter(e => e.win_lost === 'Gagné').length;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard icon={Calendar} label="Événements à venir" value={upcoming.length} accent={T.brand} />
        <StatCard icon={FileText} label="Devis en attente" value={pendingQuotes.length} accent={T.warning} />
        <StatCard icon={Euro} label="CA signé" value={formatMoney(totalSigned)} accent={T.success} />
        <StatCard icon={TrendingUp} label="Événements gagnés" value={totalWon} accent={T.info} />
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: '20px 0 10px' }}>
        Prochains événements
      </h2>
      {upcoming.length === 0 ? (
        <EmptyState icon={Calendar} message="Aucun événement à venir pour le moment." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upcoming.slice(0, 5).map((ev, i) => (
            <EventRow key={ev.event_id || i} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }) {
  return (
    <Card style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: T.brandTint,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Calendar size={18} color={T.brand} strokeWidth={2.2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {event.event_name || 'Événement sans nom'}
        </div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={11} /> {formatDate(event.events_date_from)}
          </span>
          {event.number_of_persons ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Users size={11} /> {event.number_of_persons}
            </span>
          ) : null}
        </div>
      </div>
      <ChevronRight size={16} color={T.textSubtle} />
    </Card>
  );
}

// ---------- Planning ----------
function Planning({ session }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiCall(session.subdomain, session.token, '/v3/analytics/events/vue-planning', { method: 'POST', body: {} });
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  const sorted = [...(items || [])].sort((a, b) => new Date(a.start_at || 0) - new Date(b.start_at || 0));

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: '0 0 12px' }}>
        Planning des salles
      </h2>
      {sorted.length === 0 ? (
        <EmptyState icon={Calendar} message="Aucune réservation planifiée." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((item, i) => (
            <Card key={item.schedule_id || i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>
                    {item.event_name || 'Sans nom'}
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} /> {formatDate(item.start_at)}
                    </span>
                    {item.room_name ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={11} /> {item.room_name}
                      </span>
                    ) : null}
                  </div>
                </div>
                {item.status_name ? (
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                    whiteSpace: 'nowrap',
                    ...statusBadgeStyle(item.status_color),
                  }}>
                    {item.status_name}
                  </span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Quotes ----------
function Quotes({ session }) {
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiCall(session.subdomain, session.token, '/v3/analytics/finance-documents/quotes', { method: 'POST', body: {} });
      setQuotes(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;

  const sorted = [...(quotes || [])].sort((a, b) => new Date(b.date_of_quote || 0) - new Date(a.date_of_quote || 0));

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: '0 0 12px' }}>
        Devis
      </h2>
      {sorted.length === 0 ? (
        <EmptyState icon={FileText} message="Aucun devis pour le moment." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map((q, i) => (
            <Card key={q.quote_id || i} style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {q.title || q.event || 'Devis'}
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>
                    {q.nb} · {formatDate(q.date_of_quote)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>
                    {formatMoney(q.ttc)}
                  </div>
                  {q.status ? (
                    <span style={{
                      fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                      display: 'inline-block', marginTop: 4,
                      ...statusBadgeStyle(/sign/i.test(q.status) ? T.success : /rejet|annul/i.test(q.status) ? T.danger : T.warning),
                    }}>
                      {q.status}
                    </span>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <Loader2 size={24} color={T.brand} style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ---------- App shell ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState('dashboard');

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  const tabs = [
    { key: 'dashboard', label: 'Aperçu', icon: LayoutDashboard },
    { key: 'planning', label: 'Planning', icon: Calendar },
    { key: 'quotes', label: 'Devis', icon: FileText },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      background: T.surfaceMuted,
      fontFamily: "'Roboto', 'Helvetica Neue', Arial, sans-serif",
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Lab-event</div>
          <div style={{ fontSize: 11.5, color: T.textMuted }}>{session.subdomain}</div>
        </div>
        <button
          onClick={() => setSession(null)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: T.textMuted, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5,
          }}
        >
          <LogOut size={15} /> Déconnexion
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 72 }}>
        {tab === 'dashboard' && <Dashboard session={session} />}
        {tab === 'planning' && <Planning session={session} />}
        {tab === 'quotes' && <Quotes session={session} />}
      </div>

      {/* Bottom nav */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: T.surface, borderTop: `1px solid ${T.border}`,
        display: 'flex', boxShadow: '0 -4px 16px rgba(16,24,40,0.06)',
      }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 0 12px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4,
              color: tab === key ? T.brand : T.textMuted,
              transition: 'color 0.18s ease',
            }}
          >
            <Icon size={19} strokeWidth={tab === key ? 2.4 : 2.2} />
            <span style={{ fontSize: 10.5, fontWeight: tab === key ? 600 : 400 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
