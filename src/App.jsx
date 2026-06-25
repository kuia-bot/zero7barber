import React, { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue, off } from "firebase/database";
import { Scissors, Calendar, Lock, X, Check, Plus, Eye, EyeOff, Phone, User, Clock, AlertCircle, LogOut } from "lucide-react";

// ─── Firebase config ─────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSy8j4TnInnENiUaW8gEwtYDtzQaxKGPTSxE",
  authDomain: "zero7barber.firebaseapp.com",
  databaseURL: "https://zero7barber-default-rtdb.firebaseio.com",
  projectId: "zero7barber",
  storageBucket: "zero7barber.firebasestorage.app",
  messagingSenderId: "526208231564",
  appId: "1:526208231564:web:873c1ba05eb871c86db3a9"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ─── DB helpers ───────────────────────────────────────────────
async function dbGet(path) {
  try {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  } catch { return null; }
}
async function dbSet(path, value) {
  try { await set(ref(db, path), value); } catch (e) { console.error(e); }
}
function dbListen(path, cb) {
  const r = ref(db, path);
  onValue(r, snap => cb(snap.exists() ? snap.val() : null));
  return () => off(r);
}

// ─── Configuração ─────────────────────────────────────────────
const HORA_ABERTURA = 8;
const HORA_FECHAMENTO = 18;
const DURACAO_MIN = 60;
const SENHA_PADRAO = "zero7";
const DIAS_AGENDA = 30;

const SERVICOS = [
  { id: "sobrancelha", nome: "Sobrancelha" },
];

function calcularPreco(extras) { return extras.length === 0 ? 25 : 35; }

function gerarSlotsPadrao() {
  const slots = [];
  let min = HORA_ABERTURA * 60;
  while (min < HORA_FECHAMENTO * 60) {
    const h = Math.floor(min / 60), m = min % 60;
    slots.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    min += DURACAO_MIN;
  }
  return slots;
}
const SLOTS_PADRAO = gerarSlotsPadrao();

const SLOTS_BLOQUEADOS_FIXOS = new Set(["12:00"]);
function fmtISO(d) { return d.toISOString().slice(0,10); }
function fmtBR(iso) { const [,m,d] = iso.split("-"); return `${d}/${m}`; }
function nomeDia(d) { return ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][d.getDay()]; }
function diaFechado(d) { return d.getDay() === 0; }

function tocarBip() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880,0,0.55],[1320,0.22,0.75]].forEach(([freq,start,stop]) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + stop - 0.05);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + stop);
    });
  } catch {}
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
*{box-sizing:border-box;}body{margin:0;}
.fd{font-family:'Oswald',sans-serif;}
.fb{font-family:'Inter',sans-serif;}
.fm{font-family:'JetBrains Mono',monospace;}
.corner{clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);}
.scroll-x::-webkit-scrollbar{height:5px;}.scroll-x::-webkit-scrollbar-thumb{background:#333;border-radius:3px;}
@keyframes slideIn{from{transform:translateY(-16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
`;

export default function App() {
  const [tela, setTela] = useState("cliente");
  return (
    <div style={{minHeight:"100vh",background:"#16171A"}}>
      <style>{CSS}</style>
      {tela==="cliente" && <TelaCliente irLogin={()=>setTela("login")}/>}
      {tela==="login"   && <TelaLogin onEntrar={()=>setTela("painel")} onVoltar={()=>setTela("cliente")}/>}
      {tela==="painel"  && <TelaPainel onSair={()=>setTela("cliente")}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TELA CLIENTE
// ═══════════════════════════════════════════════════════════════
function TelaCliente({ irLogin }) {
  const hoje = new Date();
  const [dataSel, setDataSel] = useState(fmtISO(hoje));
  const [extras,  setExtras]  = useState([]);
  const [horaSel, setHoraSel] = useState(null);
  const [nome,    setNome]    = useState("");
  const [fone,    setFone]    = useState("");
  const [loading, setLoading] = useState(true);
  const [enviando,setEnviando]= useState(false);
  const [confirmado,setConf]  = useState(null);
  const [erro,    setErro]    = useState("");
  const [agends,  setAgends]  = useState({});
  const [ovr,     setOvr]     = useState({bloqueados:[],slotsExtras:[]});

  useEffect(() => {
    setLoading(true);
    const unsub1 = dbListen(`agend/${dataSel}`, val => {
      setAgends(val || {});
      setLoading(false);
    });
    const unsub2 = dbListen(`ovr/${dataSel}`, val => {
      setOvr(val || {bloqueados:[],slotsExtras:[]});
    });
    setHoraSel(null);
    return () => { unsub1(); unsub2(); };
  }, [dataSel]);

  function proximosDias() {
    const dias=[], cur=new Date(hoje); cur.setHours(0,0,0,0);
    while(dias.length < DIAS_AGENDA) {
      if(!diaFechado(cur)) dias.push(new Date(cur));
      cur.setDate(cur.getDate()+1);
    }
    return dias;
  }

  function slots() {
    const agora = new Date();
    const hojeISO = fmtISO(agora);
    const minAgora = agora.getHours()*60 + agora.getMinutes();
    const base = Array.from(new Set([...SLOTS_PADRAO,...(ovr.slotsExtras||[])])).sort();
    const bloq  = new Set(ovr.bloqueados||[]);
    const ocup  = new Set(Object.values(agends).map(a=>a.hora));
    return base.map(h => {
      const [hh,mm] = h.split(":").map(Number);
      const passou = dataSel===hojeISO && (hh*60+mm) <= minAgora;
      return { hora:h, disponivel:!bloq.has(h)&&!ocup.has(h)&&!passou&&!SLOTS_BLOQUEADOS_FIXOS.has(h) };
    });
  }

  async function agendar() {
    setErro("");
    if(!nome.trim())  { setErro("Digite seu nome."); return; }
    if(!fone.trim())  { setErro("Digite seu telefone."); return; }
    if(!horaSel)      { setErro("Escolha um horário."); return; }
    setEnviando(true);
    // verifica conflito em tempo real
    const atual = await dbGet(`agend/${dataSel}`);
    const ocupados = atual ? Object.values(atual).map(a=>a.hora) : [];
    if(ocupados.includes(horaSel)) {
      setErro("Esse horário acabou de ser ocupado. Escolha outro.");
      setHoraSel(null); setEnviando(false); return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    const novo = {
      id, nome:nome.trim(), fone:fone.trim(),
      hora:horaSel, data:dataSel,
      extras, preco:calcularPreco(extras), ts:Date.now(),
    };
    await dbSet(`agend/${dataSel}/${id}`, novo);
    // notificação pro barbeiro
    await dbSet(`notif/${id}`, { ...novo, lido: false });
    setConf(novo); setEnviando(false);
  }

  function resetar() { setConf(null); setExtras([]); setHoraSel(null); setNome(""); setFone(""); }

  const preco = calcularPreco(extras);
  const slotsList = slots();

  return (
    <div style={{maxWidth:640,margin:"0 auto",paddingBottom:60}}>
      <header style={{
        position:"relative",padding:"36px 24px 28px",
        background:"linear-gradient(135deg,#1c1d20 0%,#16171A 55%,#1a1611 100%)",
        borderBottom:"3px solid #B5512C",overflow:"hidden",
      }}>
        <div style={{position:"absolute",inset:0,pointerEvents:"none",backgroundImage:"repeating-linear-gradient(135deg,rgba(255,255,255,.022) 0px,rgba(255,255,255,.022) 1px,transparent 1px,transparent 14px)"}}/>
        <div style={{position:"relative",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h1 className="fd" style={{color:"#EDEAE3",fontSize:42,fontWeight:700,letterSpacing:1,lineHeight:1,margin:0,textTransform:"uppercase"}}>
            Zero<span style={{color:"#B5512C"}}>7</span>Barber
          </h1>
          <Scissors size={26} color="#5b5d62"/>
        </div>
      </header>

      <div style={{padding:"22px 18px 0"}}>
        {confirmado ? <Confirmacao ag={confirmado} onNovo={resetar}/> : (<>
          <Secao titulo="Serviço" ic={<Scissors size={15} color="#B5512C"/>}>
            <div className="corner" style={{background:"#1f2023",border:"1px solid #2c2d31",padding:18}}>
              <LinhaServico nome="Corte de cabelo" sub="Sempre incluso" fixo/>
              {SERVICOS.map(s=>(
                <LinhaServico key={s.id} nome={s.nome} sub="Adicionar ao corte"
                  marcado={extras.includes(s.id)}
                  onToggle={()=>setExtras(p=>p.includes(s.id)?p.filter(e=>e!==s.id):[...p,s.id])}
                />
              ))}
              <div style={{marginTop:12,paddingTop:12,borderTop:"1px dashed #34353a",display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <span className="fb" style={{color:"#9CA3A8",fontSize:13}}>Total do atendimento</span>
                <span className="fm" style={{color:"#D9A441",fontSize:24,fontWeight:600}}>R$ {preco}</span>
              </div>
            </div>
          </Secao>

          <Secao titulo="Dia" ic={<Calendar size={15} color="#B5512C"/>}>
            <div className="scroll-x" style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:6}}>
              {proximosDias().map(d=>{
                const iso=fmtISO(d),ativo=iso===dataSel;
                return (
                  <button key={iso} onClick={()=>setDataSel(iso)} className="fb"
                    style={{flexShrink:0,minWidth:60,padding:"9px 5px",borderRadius:8,textAlign:"center",cursor:"pointer",
                      border:ativo?"1px solid #B5512C":"1px solid #2c2d31",
                      background:ativo?"rgba(181,81,44,.18)":"#1f2023",
                      color:ativo?"#EDEAE3":"#9CA3A8"}}>
                    <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:.5}}>{nomeDia(d)}</div>
                    <div className="fm" style={{fontSize:16,fontWeight:600,marginTop:2}}>{String(d.getDate()).padStart(2,"0")}</div>
                  </button>
                );
              })}
            </div>
          </Secao>

          <Secao titulo="Horário" ic={<Clock size={15} color="#B5512C"/>}>
            {loading ? (
              <p className="fb" style={{color:"#5b5d62",fontSize:13,margin:0}}>Carregando horários…</p>
            ) : slotsList.filter(s=>s.disponivel).length === 0 ? (
              <div className="corner fb" style={{background:"#1f2023",border:"1px dashed #2c2d31",padding:"18px 14px",color:"#5b5d62",fontSize:13,textAlign:"center"}}>
                Nenhum horário disponível nesse dia.
              </div>
            ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                {slotsList.map(({hora,disponivel})=>{
                  const ativo=hora===horaSel;
                  return (
                    <button key={hora} disabled={!disponivel} onClick={()=>setHoraSel(hora)}
                      className="fm corner"
                      style={{padding:"10px 4px",fontSize:14,fontWeight:600,cursor:disponivel?"pointer":"not-allowed",
                        border:ativo?"1px solid #D9A441":disponivel?"1px solid #2c2d31":"1px solid #1f2023",
                        background:!disponivel?"#18191b":ativo?"rgba(217,164,65,.16)":"#1f2023",
                        color:!disponivel?"#363739":ativo?"#D9A441":"#EDEAE3",
                        textDecoration:!disponivel?"line-through":"none"}}>
                      {hora}
                    </button>
                  );
                })}
              </div>
            )}
          </Secao>

          <Secao titulo="Seus dados" ic={<User size={15} color="#B5512C"/>}>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              <Campo placeholder="Seu nome" val={nome} set={setNome} ic={<User size={14} color="#5b5d62"/>}/>
              <Campo placeholder="WhatsApp / telefone" val={fone} set={setFone} ic={<Phone size={14} color="#5b5d62"/>} tipo="tel"/>
            </div>
          </Secao>

          {erro && (
            <div className="fb" style={{display:"flex",alignItems:"center",gap:8,color:"#e0a55c",background:"rgba(217,164,65,.1)",border:"1px solid rgba(217,164,65,.3)",borderRadius:8,padding:"9px 12px",fontSize:13,marginTop:4}}>
              <AlertCircle size={14}/> {erro}
            </div>
          )}

          <button onClick={agendar} disabled={enviando} className="fd"
            style={{marginTop:18,width:"100%",padding:"15px",background:enviando?"#5b3b27":"#B5512C",color:"#EDEAE3",border:"none",borderRadius:8,fontSize:17,fontWeight:600,letterSpacing:.5,textTransform:"uppercase",cursor:enviando?"default":"pointer"}}>
            {enviando?"Agendando…":"Agendar horário"}
          </button>
        </>)}
      </div>

      <footer style={{textAlign:"center",marginTop:32}}>
        <button onClick={irLogin} className="fb"
          style={{background:"none",border:"none",color:"#3a3b3f",fontSize:12,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
          <Lock size={11}/> Sou o barbeiro
        </button>
      </footer>
    </div>
  );
}

function Secao({titulo,ic,children}) {
  return (
    <div style={{marginBottom:20}}>
      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
        {ic}
        <span className="fd" style={{color:"#9CA3A8",fontSize:12,letterSpacing:1.8,textTransform:"uppercase"}}>{titulo}</span>
      </div>
      {children}
    </div>
  );
}
function LinhaServico({nome,sub,fixo,marcado,onToggle}) {
  return (
    <div onClick={fixo?undefined:onToggle} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 4px",cursor:fixo?"default":"pointer",opacity:fixo?.7:1}}>
      <div style={{width:17,height:17,borderRadius:4,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
        border:(fixo||marcado)?"1px solid #D9A441":"1px solid #46474b",
        background:(fixo||marcado)?"#D9A441":"transparent"}}>
        {(fixo||marcado) && <Check size={11} color="#16171A" strokeWidth={3}/>}
      </div>
      <div>
        <div className="fb" style={{color:"#EDEAE3",fontSize:14,fontWeight:500}}>{nome}</div>
        <div className="fb" style={{color:"#5b5d62",fontSize:11.5}}>{sub}</div>
      </div>
    </div>
  );
}
function Campo({placeholder,val,set,ic,tipo="text"}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:9,background:"#1f2023",border:"1px solid #2c2d31",borderRadius:8,padding:"11px 13px"}}>
      {ic}
      <input type={tipo} value={val} onChange={e=>set(e.target.value)} placeholder={placeholder} className="fb"
        style={{background:"none",border:"none",outline:"none",color:"#EDEAE3",fontSize:14,width:"100%"}}/>
    </div>
  );
}
function Confirmacao({ag,onNovo}) {
  const nomesExtras = ag.extras.map(id=>SERVICOS.find(s=>s.id===id)?.nome).filter(Boolean);
  return (
    <div className="corner" style={{background:"#1f2023",border:"1px solid #D9A441",padding:26,textAlign:"center"}}>
      <div style={{width:48,height:48,borderRadius:"50%",background:"rgba(217,164,65,.15)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
        <Check size={24} color="#D9A441" strokeWidth={3}/>
      </div>
      <h2 className="fd" style={{color:"#EDEAE3",fontSize:22,margin:"0 0 6px",textTransform:"uppercase"}}>Horário agendado!</h2>
      <p className="fb" style={{color:"#9CA3A8",fontSize:14,margin:"0 0 18px"}}>O barbeiro já está vendo seu agendamento.</p>
      <div style={{background:"#16171A",borderRadius:8,padding:15,textAlign:"left"}}>
        {[["Nome",ag.nome],["Dia",fmtBR(ag.data)],["Horário",ag.hora],["Serviço",nomesExtras.length?`Corte + ${nomesExtras.join(" + ")}`:"Corte de cabelo"],["Valor",`R$ ${ag.preco}`]].map(([l,v])=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
            <span className="fb" style={{color:"#5b5d62",fontSize:12.5}}>{l}</span>
            <span className={l==="Valor"?"fm":"fb"} style={{color:l==="Valor"?"#D9A441":"#EDEAE3",fontSize:l==="Valor"?16:13,fontWeight:l==="Valor"?600:500}}>{v}</span>
          </div>
        ))}
      </div>
      <button onClick={onNovo} className="fb" style={{marginTop:16,background:"none",border:"1px solid #46474b",color:"#9CA3A8",borderRadius:8,padding:"9px 16px",fontSize:13,cursor:"pointer"}}>
        Agendar outro horário
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TELA LOGIN
// ═══════════════════════════════════════════════════════════════
function TelaLogin({ onEntrar, onVoltar }) {
  const [senha,   setSenha]   = useState("");
  const [ver,     setVer]     = useState(false);
  const [erro,    setErro]    = useState(false);
  const [loading, setLoading] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    if(!senha.trim()) return;
    setLoading(true); setErro(false);
    const salva = await dbGet("config/senha");
    const correta = salva !== null ? salva : SENHA_PADRAO;
    setLoading(false);
    if(senha === correta) onEntrar();
    else setErro(true);
  }

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <Scissors size={32} color="#B5512C" style={{marginBottom:18}}/>
      <h1 className="fd" style={{color:"#EDEAE3",fontSize:26,textTransform:"uppercase",margin:"0 0 4px"}}>Painel do barbeiro</h1>
      <p className="fb" style={{color:"#5b5d62",fontSize:13,margin:"0 0 26px"}}>Zero7Barber</p>
      <form onSubmit={entrar} style={{width:"100%",maxWidth:320}}>
        <div style={{display:"flex",alignItems:"center",gap:10,background:"#1f2023",border:erro?"1px solid #c0594a":"1px solid #2c2d31",borderRadius:8,padding:"12px 14px"}}>
          <Lock size={15} color="#5b5d62"/>
          <input type={ver?"text":"password"} value={senha} autoFocus
            onChange={e=>{setSenha(e.target.value);setErro(false);}}
            placeholder="Senha" className="fb"
            style={{background:"none",border:"none",outline:"none",color:"#EDEAE3",fontSize:14,width:"100%"}}/>
          <button type="button" onClick={()=>setVer(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",display:"flex"}}>
            {ver?<EyeOff size={15} color="#5b5d62"/>:<Eye size={15} color="#5b5d62"/>}
          </button>
        </div>
        {erro && <p className="fb" style={{color:"#c0594a",fontSize:12.5,marginTop:8}}>Senha incorreta.</p>}
        <button type="submit" disabled={loading} className="fd"
          style={{marginTop:14,width:"100%",padding:"14px",background:"#B5512C",color:"#EDEAE3",border:"none",borderRadius:8,fontSize:15,fontWeight:600,letterSpacing:.5,textTransform:"uppercase",cursor:loading?"default":"pointer"}}>
          {loading?"Verificando…":"Entrar"}
        </button>
      </form>
      <button onClick={onVoltar} className="fb" style={{marginTop:18,background:"none",border:"none",color:"#46474b",fontSize:12.5,cursor:"pointer"}}>
        ← Voltar para o site
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAINEL DO BARBEIRO
// ═══════════════════════════════════════════════════════════════
function TelaPainel({ onSair }) {
  const hoje = new Date();
  const [dataSel,  setDataSel]  = useState(fmtISO(hoje));
  const [agends,   setAgends]   = useState({});
  const [ovr,      setOvr]      = useState({bloqueados:[],slotsExtras:[]});
  const [loading,  setLoading]  = useState(true);
  const [modoEdit, setModoEdit] = useState(false);
  const [hrExtra,  setHrExtra]  = useState("");
  const [toasts,   setToasts]   = useState([]);
  const [abaAtiva, setAbaAtiva] = useState("agenda");
  const [saAtual,  setSaAtual]  = useState("");
  const [saNova,   setSaNova]   = useState("");
  const [saConf,   setSaConf]   = useState("");
  const [erroSenha,setErroSenha]= useState("");
  const [okSenha,  setOkSenha]  = useState(false);
  const [verSa,    setVerSa]    = useState(false);
  const [verSn,    setVerSn]    = useState(false);
  const notifContRef = useRef(null);

  // Escuta agendamentos e overrides do dia em tempo real
  useEffect(() => {
    setLoading(true);
    const u1 = dbListen(`agend/${dataSel}`, val => { setAgends(val||{}); setLoading(false); });
    const u2 = dbListen(`ovr/${dataSel}`, val => { setOvr(val||{bloqueados:[],slotsExtras:[]}); });
    return () => { u1(); u2(); };
  }, [dataSel]);

  // Escuta notificações em tempo real
  useEffect(() => {
    const unsub = dbListen("notif", val => {
      if(!val) return;
      const notifs = Object.values(val).filter(n=>!n.lido);
      if(notifContRef.current === null) {
        notifContRef.current = notifs.length;
        return;
      }
      if(notifs.length > notifContRef.current) {
        const novos = notifs.slice(notifContRef.current);
        tocarBip();
        novos.forEach(n => {
          const id = `${Date.now()}-${Math.random()}`;
          setToasts(p=>[...p,{id,n}]);
          setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)), 7000);
          // Marca como lido
          dbSet(`notif/${n.id}/lido`, true);
          // Notificação do navegador
          if(window.Notification?.permission==="granted") {
            new Notification("Zero7Barber — Novo agendamento", {
              body:`${n.nome} marcou às ${n.hora} (${fmtBR(n.data)})`,
            });
          }
        });
      }
      notifContRef.current = notifs.length;
    });
    if(window.Notification?.permission==="default") Notification.requestPermission();
    return unsub;
  }, []);

  async function cancelar(id) {
    await dbSet(`agend/${dataSel}/${id}`, null);
  }

  async function toggleBloqueio(hora) {
    const bl = new Set(ovr.bloqueados||[]);
    bl.has(hora) ? bl.delete(hora) : bl.add(hora);
    const novo = {...ovr, bloqueados:[...bl]};
    await dbSet(`ovr/${dataSel}`, novo);
  }

  async function addExtra() {
    if(!hrExtra) return;
    const ex = new Set(ovr.slotsExtras||[]);
    ex.add(hrExtra);
    await dbSet(`ovr/${dataSel}`, {...ovr, slotsExtras:[...ex].sort()});
    setHrExtra("");
  }

  async function remExtra(hora) {
    const ex = (ovr.slotsExtras||[]).filter(h=>h!==hora);
    await dbSet(`ovr/${dataSel}`, {...ovr, slotsExtras:ex});
  }

  async function trocarSenha() {
    setErroSenha(""); setOkSenha(false);
    const salva = await dbGet("config/senha");
    const atual = salva !== null ? salva : SENHA_PADRAO;
    if(saAtual !== atual) { setErroSenha("Senha atual incorreta."); return; }
    if(saNova.length < 4) { setErroSenha("Mínimo 4 caracteres."); return; }
    if(saNova !== saConf)  { setErroSenha("As senhas não coincidem."); return; }
    await dbSet("config/senha", saNova);
    setOkSenha(true); setSaAtual(""); setSaNova(""); setSaConf("");
    setTimeout(()=>setOkSenha(false), 3000);
  }

  function proximosDias() {
    const dias=[], cur=new Date(hoje); cur.setHours(0,0,0,0);
    while(dias.length<DIAS_AGENDA){ if(!diaFechado(cur)) dias.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
    return dias;
  }

  const agendsList = Object.values(agends).sort((a,b)=>a.hora.localeCompare(b.hora));
  const todosSlots = Array.from(new Set([...SLOTS_PADRAO,...(ovr.slotsExtras||[])])).sort();
  const ocupados   = new Set(agendsList.map(a=>a.hora));
  const bloqueados = new Set(ovr.bloqueados||[]);
  const extrasSet  = new Set((ovr.slotsExtras||[]).filter(h=>!SLOTS_PADRAO.includes(h)));
  const receita    = agendsList.reduce((s,a)=>s+a.preco,0);
  const diaObj     = new Date(dataSel+"T00:00:00");

  return (
    <div style={{maxWidth:740,margin:"0 auto",paddingBottom:60}}>
      {/* Toasts */}
      <div style={{position:"fixed",top:14,right:14,zIndex:99,display:"flex",flexDirection:"column",gap:8}}>
        {toasts.map(({id,n})=>(
          <div key={id} className="corner" style={{background:"#1f2023",border:"1px solid #D9A441",padding:"11px 15px",minWidth:230,animation:"slideIn .25s ease-out",boxShadow:"0 6px 22px rgba(0,0,0,.45)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:"#D9A441",animation:"pulse 1.4s infinite"}}/>
              <span className="fd" style={{color:"#D9A441",fontSize:11,textTransform:"uppercase",letterSpacing:1}}>Novo agendamento</span>
            </div>
            <p className="fb" style={{color:"#EDEAE3",fontSize:13.5,margin:0}}>
              <strong>{n.nome}</strong> marcou às {n.hora} ({fmtBR(n.data)})
            </p>
          </div>
        ))}
      </div>

      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 22px",borderBottom:"1px solid #2c2d31"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Scissors size={21} color="#B5512C"/>
          <span className="fd" style={{color:"#EDEAE3",fontSize:18,textTransform:"uppercase"}}>
            Zero<span style={{color:"#B5512C"}}>7</span>Barber
            <span className="fb" style={{color:"#5b5d62",fontWeight:400,fontSize:13,marginLeft:8}}>· painel</span>
          </span>
        </div>
        <button onClick={onSair} className="fb" style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"1px solid #2c2d31",color:"#9CA3A8",borderRadius:6,padding:"6px 12px",fontSize:12.5,cursor:"pointer"}}>
          <LogOut size={13}/> Sair
        </button>
      </header>

      <div style={{display:"flex",borderBottom:"1px solid #2c2d31",padding:"0 22px"}}>
        {[["agenda","Agenda"],["senha","Senha"]].map(([k,l])=>(
          <button key={k} onClick={()=>setAbaAtiva(k)} className="fd"
            style={{padding:"12px 16px",background:"none",border:"none",cursor:"pointer",fontSize:13,letterSpacing:1,textTransform:"uppercase",
              color:abaAtiva===k?"#EDEAE3":"#5b5d62",
              borderBottom:abaAtiva===k?"2px solid #B5512C":"2px solid transparent",marginBottom:-1}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{padding:"20px 20px 0"}}>
        {abaAtiva==="agenda" && (<>
          <div className="scroll-x" style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:12}}>
            {proximosDias().map(d=>{
              const iso=fmtISO(d),ativo=iso===dataSel;
              return (
                <button key={iso} onClick={()=>setDataSel(iso)} className="fb"
                  style={{flexShrink:0,minWidth:58,padding:"8px 5px",borderRadius:8,textAlign:"center",cursor:"pointer",
                    border:ativo?"1px solid #B5512C":"1px solid #2c2d31",
                    background:ativo?"rgba(181,81,44,.18)":"#1f2023",
                    color:ativo?"#EDEAE3":"#9CA3A8"}}>
                  <div style={{fontSize:10,textTransform:"uppercase"}}>{nomeDia(d)}</div>
                  <div className="fm" style={{fontSize:15,fontWeight:600,marginTop:2}}>{String(d.getDate()).padStart(2,"0")}</div>
                </button>
              );
            })}
          </div>

          <div style={{display:"flex",gap:10,marginBottom:20}}>
            {[["Agendamentos",agendsList.length],["Faturamento",`R$ ${receita}`],["Vagas livres",todosSlots.filter(h=>!ocupados.has(h)&&!bloqueados.has(h)).length]].map(([l,v])=>(
              <div key={l} className="corner" style={{flex:1,background:"#1f2023",border:"1px solid #2c2d31",padding:"11px 13px"}}>
                <div className="fb" style={{color:"#5b5d62",fontSize:10,textTransform:"uppercase",letterSpacing:.5}}>{l}</div>
                <div className="fm" style={{color:"#EDEAE3",fontSize:20,fontWeight:600,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>

          <div className="fd" style={{color:"#9CA3A8",fontSize:12,letterSpacing:1.8,textTransform:"uppercase",marginBottom:10}}>
            {nomeDia(diaObj)}feira, {fmtBR(dataSel)}
          </div>

          {loading ? (
            <p className="fb" style={{color:"#5b5d62",fontSize:13}}>Carregando…</p>
          ) : agendsList.length===0 ? (
            <div className="corner fb" style={{background:"#1f2023",border:"1px dashed #2c2d31",padding:22,textAlign:"center",color:"#5b5d62",fontSize:13,marginBottom:22}}>
              Nenhum agendamento nesse dia ainda.
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:22}}>
              {agendsList.map(a=>{
                const nex=(a.extras||[]).map(id=>SERVICOS.find(s=>s.id===id)?.nome).filter(Boolean);
                return (
                  <div key={a.id} className="corner" style={{background:"#1f2023",border:"1px solid #2c2d31",padding:"13px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                    <div style={{display:"flex",alignItems:"center",gap:13}}>
                      <div className="fm" style={{color:"#D9A441",fontSize:16,fontWeight:600,background:"rgba(217,164,65,.1)",borderRadius:6,padding:"5px 9px",minWidth:54,textAlign:"center"}}>{a.hora}</div>
                      <div>
                        <div className="fb" style={{color:"#EDEAE3",fontSize:14.5,fontWeight:600}}>{a.nome}</div>
                        <div className="fb" style={{color:"#5b5d62",fontSize:12}}>{nex.length?`Corte + ${nex.join(" + ")}`:"Corte de cabelo"} · R$ {a.preco}</div>
                        <a href={`https://wa.me/55${(a.fone||"").replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
                          className="fb" style={{color:"#5b8a6e",fontSize:12,textDecoration:"none",display:"inline-flex",alignItems:"center",gap:4,marginTop:2}}>
                          <Phone size={11}/> {a.fone}
                        </a>
                      </div>
                    </div>
                    <button onClick={()=>cancelar(a.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#5b5d62",padding:5}}>
                      <X size={16}/>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Gerenciar horários */}
          <div style={{background:"#1a1b1e",border:"1px solid #2c2d31",borderRadius:10,padding:18,marginBottom:24}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <span className="fd" style={{color:"#9CA3A8",fontSize:12,letterSpacing:1.8,textTransform:"uppercase"}}>Horários do dia</span>
              <button onClick={()=>setModoEdit(v=>!v)} className="fb"
                style={{background:"none",border:"1px solid #2c2d31",color:"#9CA3A8",borderRadius:6,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>
                {modoEdit?"Concluir":"Editar horários"}
              </button>
            </div>
            {modoEdit && <p className="fb" style={{color:"#5b5d62",fontSize:12.5,marginBottom:12,marginTop:0}}>Toque num horário para bloquear ou liberar.</p>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
              {todosSlots.map(hora=>{
                const ocup=ocupados.has(hora),bloq=bloqueados.has(hora),extra=extrasSet.has(hora);
                return (
                  <button key={hora} disabled={!modoEdit||ocup} onClick={()=>toggleBloqueio(hora)} className="fm"
                    style={{padding:"9px 4px",borderRadius:6,fontSize:12.5,fontWeight:600,cursor:modoEdit&&!ocup?"pointer":"default",
                      textDecoration:bloq?"line-through":"none",
                      border:ocup?"1px solid #2c2d31":bloq?"1px solid #c0594a":extra?"1px solid #5b8a6e":"1px solid #2c2d31",
                      background:ocup?"rgba(217,164,65,.08)":bloq?"rgba(192,89,74,.12)":extra?"rgba(91,138,110,.1)":"#16171A",
                      color:ocup?"#D9A441":bloq?"#c0594a":extra?"#5b8a6e":"#9CA3A8"}}>
                    {hora}
                    {ocup&&<span style={{display:"block",fontSize:8,marginTop:1,color:"#D9A441"}}>● cliente</span>}
                    {bloq&&!ocup&&<span style={{display:"block",fontSize:8,marginTop:1,color:"#c0594a"}}>bloqueado</span>}
                    {extra&&!bloq&&!ocup&&<span style={{display:"block",fontSize:8,marginTop:1,color:"#5b8a6e"}}>extra</span>}
                  </button>
                );
              })}
            </div>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:modoEdit?14:0}}>
              {[["#D9A441","com cliente"],["#c0594a","bloqueado"],["#5b8a6e","extra"],["#9CA3A8","livre"]].map(([c,l])=>(
                <span key={l} className="fb" style={{fontSize:11,color:c,display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:8,height:8,borderRadius:2,background:c,display:"inline-block"}}/>{l}
                </span>
              ))}
            </div>
            {modoEdit && (
              <div style={{borderTop:"1px dashed #2c2d31",paddingTop:14}}>
                <div className="fb" style={{color:"#5b5d62",fontSize:12.5,marginBottom:9}}>Adicionar horário fora do padrão:</div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <input type="time" value={hrExtra} onChange={e=>setHrExtra(e.target.value)} className="fm"
                    style={{background:"#16171A",border:"1px solid #2c2d31",borderRadius:6,color:"#EDEAE3",padding:"8px 10px",fontSize:13.5}}/>
                  <button onClick={addExtra} className="fb"
                    style={{display:"flex",alignItems:"center",gap:5,background:"#5b8a6e",border:"none",color:"#fff",borderRadius:6,padding:"8px 13px",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                    <Plus size={14}/> Adicionar
                  </button>
                </div>
                {extrasSet.size > 0 && (
                  <div style={{marginTop:12,display:"flex",flexWrap:"wrap",gap:6}}>
                    {[...extrasSet].sort().map(h=>(
                      <span key={h} className="fm" style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(91,138,110,.1)",border:"1px solid #5b8a6e",color:"#5b8a6e",borderRadius:6,padding:"4px 8px",fontSize:12}}>
                        {h}
                        {!ocupados.has(h)&&<button onClick={()=>remExtra(h)} style={{background:"none",border:"none",cursor:"pointer",color:"#5b8a6e",display:"flex",padding:0}}><X size={11}/></button>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>)}

        {abaAtiva==="senha" && (
          <div style={{maxWidth:380}}>
            <div className="fd" style={{color:"#9CA3A8",fontSize:12,letterSpacing:1.8,textTransform:"uppercase",marginBottom:16}}>Alterar senha</div>
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {[["Senha atual",saAtual,setSaAtual,verSa,setVerSa],["Nova senha",saNova,setSaNova,verSn,setVerSn],["Confirmar nova senha",saConf,setSaConf,false,null]].map(([ph,val,set,ver,setVer])=>(
                <div key={ph} style={{display:"flex",alignItems:"center",gap:10,background:"#1f2023",border:"1px solid #2c2d31",borderRadius:8,padding:"11px 13px"}}>
                  <Lock size={14} color="#5b5d62"/>
                  <input type={ver?"text":"password"} value={val} onChange={e=>set(e.target.value)} placeholder={ph} className="fb"
                    style={{background:"none",border:"none",outline:"none",color:"#EDEAE3",fontSize:14,width:"100%"}}/>
                  {setVer && <button type="button" onClick={()=>setVer(v=>!v)} style={{background:"none",border:"none",cursor:"pointer",display:"flex"}}>
                    {ver?<EyeOff size={14} color="#5b5d62"/>:<Eye size={14} color="#5b5d62"/>}
                  </button>}
                </div>
              ))}
            </div>
            {erroSenha && <div className="fb" style={{display:"flex",alignItems:"center",gap:7,color:"#c0594a",fontSize:12.5,marginTop:10}}><AlertCircle size={13}/> {erroSenha}</div>}
            {okSenha && <div className="fb" style={{display:"flex",alignItems:"center",gap:7,color:"#5b8a6e",fontSize:12.5,marginTop:10}}><Check size={13}/> Senha atualizada!</div>}
            <button onClick={trocarSenha} className="fd"
              style={{marginTop:14,width:"100%",padding:"13px",background:"#B5512C",color:"#EDEAE3",border:"none",borderRadius:8,fontSize:15,fontWeight:600,letterSpacing:.5,textTransform:"uppercase",cursor:"pointer"}}>
              Salvar nova senha
            </button>
            <p className="fb" style={{color:"#5b5d62",fontSize:12,marginTop:14}}>Senha padrão: <span className="fm" style={{color:"#9CA3A8"}}>zero7</span></p>
          </div>
        )}
      </div>
    </div>
  );
}