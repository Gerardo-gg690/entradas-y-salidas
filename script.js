const $=s=>document.querySelector(s);
const ADMIN_UID='tFUODWGOkXeCm18fSO1bKZCm3ms2';
// Centro fijo de Bon House: comprobar coordenadas antes de usar en producción.
const WORKPLACE=Object.freeze({latitude:13.9871804,longitude:-89.5491599,radiusMeters:50});
const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const defaults={salary:408,halfSalary:204,paidDays:30,normalHours:8,extraRate:3};
let state={employees:[],attendance:[],config:{...defaults}},selectedDate=todayKey(),currentUser=null,profile=null,unsubs=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=t=>t?new Date(t).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit'}):'—';
const prettyDate=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-SV',{weekday:'long',day:'numeric',month:'long',year:'numeric'})};
const uname=s=>s.trim().toLowerCase();
const loginEmail=s=>s.includes('@')?s.trim():`${uname(s)}@timecore.invalid`;
const errorText=e=>({'auth/invalid-credential':'Usuario o contraseña incorrectos.','auth/email-already-in-use':'Este usuario ya existe.','auth/weak-password':'La contraseña debe tener al menos 6 caracteres.','permission-denied':'No tienes permisos. Comprueba las reglas de Firestore.','unavailable':'Sin conexión. Intenta nuevamente.'}[e.code]||e.message||'Ocurrió un error.');
function showError(message){$('#syncStatus').textContent=message}
function clock(){$('#clock').textContent=new Date().toLocaleString('es-SV',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'})}clock();setInterval(clock,1000);
function clearListeners(){unsubs.forEach(f=>f());unsubs=[]}
function record(id,date){return state.attendance.find(r=>r.employeeId===id&&r.date===date)}
function permissionHours(r, endTime){
 const end=new Date(endTime||r?.clock_out||Date.now()).getTime();
 return (r?.permissionBreaks||[]).reduce((sum,b)=>{
   const from=new Date(b.start).getTime(),to=b.end?new Date(b.end).getTime():end;
   return sum+(Number.isFinite(from)&&Number.isFinite(to)?Math.max(0,to-from):0);
 },0)/36e5;
}
function calc(r){
 if(!r?.clock_in||!r?.clock_out)return{h:0,extra:0,base:0,extraPay:0,total:0};
 const elapsed=Math.max(0,(new Date(r.clock_out)-new Date(r.clock_in))/36e5);
 const h=Math.max(0,elapsed-permissionHours(r)),extra=Math.max(0,h-state.config.normalHours);
 const normal=Math.min(h,state.config.normalHours),base=normal/state.config.normalHours*(state.config.salary/state.config.paidDays);
 const extraPay=extra*state.config.extraRate;
 return{h,extra,base,extraPay,total:base+extraPay};
}
function isOnPermission(r){const b=r?.permissionBreaks||[];return b.length>0&&!b[b.length-1].end}
function fortnightRange(date){const[y,m,d]=date.split('-').map(Number);const a=d<=15?1:16,b=d<=15?15:new Date(y,m,0).getDate();return[`${y}-${String(m).padStart(2,'0')}-${String(a).padStart(2,'0')}`,`${y}-${String(m).padStart(2,'0')}-${String(b).padStart(2,'0')}`]}
function renderEmployees(){const grid=$('#employeeGrid');grid.innerHTML='';$('#emptyIntro').style.display='none';if(!currentUser){$('#emptyIntro').style.display='flex';$('#emptyIntro').innerHTML='<strong>Inicia sesión para registrar tu asistencia.</strong><span>Usa el usuario y contraseña que te asignó la jefa.</span>';return}if(currentUser.uid===ADMIN_UID){
  $('#emptyIntro').style.display='flex';
  $('#emptyIntro').innerHTML='<strong>Personal registrado en Bon House</strong><span>Vista de administración: consulta el personal aquí. Para ver asistencias, pagos o registrar una salida pendiente, abre el Panel de la jefa.</span>';
  if(!state.employees.length){const msg=document.createElement('p');msg.className='muted';msg.textContent='No hay empleados activos registrados todavía.';grid.append(msg);}
  state.employees.forEach(e=>{const r=record(e.id,todayKey());const status=r?.clock_out?'Turno finalizado':r?.clock_in?'Salida pendiente':'Sin entrada registrada';const card=document.createElement('article');card.className='employee';card.innerHTML=`<div class="avatar">${esc(e.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><h3>${esc(e.name)}</h3><p>${esc(e.dept||'Sin departamento')} · @${esc(e.username||'')}</p><span class="status">${status}</span><button type="button">Ver en panel de la jefa</button>`;card.querySelector('button').onclick=openAdmin;grid.append(card)});
  return;
}const e=profile;if(!e)return;
 const r=record(e.id,todayKey()),done=!!r?.clock_out,started=!!r?.clock_in,paused=isOnPermission(r);
 const card=document.createElement('article');card.className='employee';
 card.innerHTML=`<div class="avatar">${esc(e.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase())}</div><h3>${esc(e.name)}</h3><p>${esc(e.dept||'Sin departamento')}</p><span class="status ${done?'done':started?'working':''}">${done?'Turno finalizado':paused?'Fuera con permiso · tiempo pausado':started?'Jornada activa':'Sin entrada registrada'}</span><div class="tc-actions"></div>`;
 const actions=card.querySelector('.tc-actions');
 const normal=document.createElement('button');normal.type='button';normal.textContent=done?'Turno completado':!started?'Marcar entrada':paused?'Salida normal no disponible durante el permiso':'Marcar salida';normal.disabled=done||paused;normal.onclick=markAttendance;actions.append(normal);
 if(started&&!done){const permission=document.createElement('button');permission.type='button';permission.textContent=paused?'Entrada con permiso':'Salida con permiso';permission.style.marginTop='8px';permission.style.background=paused?'#117d68':'#a65b24';permission.onclick=()=>markPermission(paused?'return':'leave');actions.append(permission)}
 const info=document.createElement('p');info.textContent='Marcaciones dentro de 50 m de Bon House. Los permisos son sin goce de sueldo.';info.style.fontSize='12px';info.style.opacity='.75';card.append(info);grid.append(card)}

function metersBetween(aLat,aLon,bLat,bLon){const rad=Math.PI/180,R=6371000;const dLat=(bLat-aLat)*rad,dLon=(bLon-aLon)*rad;const h=Math.sin(dLat/2)**2+Math.cos(aLat*rad)*Math.cos(bLat*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)))}
async function verifyWorkplace(){
  if(!navigator.geolocation)throw new Error('Este dispositivo no permite obtener la ubicación.');
  if(!window.isSecureContext)throw new Error('Abre TimeCore desde su enlace HTTPS para usar la ubicación.');
  showError('Comprobando ubicación respecto a Bon House (radio 50 m)…');
  // Pedir varias mediciones frescas: la primera suele ser una posición aproximada.
  // Una lectura solo es suficiente cuando su margen de error queda dentro del radio.
  const deadline=Date.now()+45000;
  let best=null,lastError=null;
  for(let attempt=0;attempt<4 && Date.now()<deadline;attempt++){
    showError(`Buscando ubicación precisa… intento ${attempt+1} de 4`);
    try{
      const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:Math.min(12000,Math.max(1000,deadline-Date.now())),maximumAge:0}));
      const {latitude,longitude,accuracy}=pos.coords;
      if(![latitude,longitude,accuracy].every(Number.isFinite))continue;
      const distance=metersBetween(latitude,longitude,WORKPLACE.latitude,WORKPLACE.longitude);
      const candidate={distance,accuracy};
      if(!best || accuracy<best.accuracy)best=candidate;
      if(distance+accuracy<=WORKPLACE.radiusMeters)return candidate;
      // Rechazo inequívoco cuando incluso el margen inferior queda fuera del radio.
      if(distance-accuracy>WORKPLACE.radiusMeters)throw new Error(`Estás fuera del radio de ${WORKPLACE.radiusMeters} m de Bon House (distancia estimada: ${Math.round(distance)} m).`);
    }catch(e){
      if(e.message?.startsWith('Estás fuera'))throw e;
      lastError=e;
      if(e.code===1)throw new Error('Permite la ubicación precisa para TimeCore en los ajustes del teléfono.');
    }
  }
  if(best)throw new Error(`No se pudo confirmar que estás dentro de ${WORKPLACE.radiusMeters} m de Bon House. Distancia estimada: ${Math.round(best.distance)} m; precisión: ±${Math.round(best.accuracy)} m. Activa ubicación precisa, Wi-Fi y vuelve a intentar cerca de una ventana o al aire libre.`);
  throw new Error('No se pudo obtener tu ubicación. Activa ubicación precisa y vuelve a intentar. '+(lastError?.message||''));
}
async function markAttendance(){
 if(!currentUser||!profile||currentUser.uid===ADMIN_UID)return;
 const btn=$('#employeeGrid button');if(btn)btn.disabled=true;
 try{
  const locationCheck=await verifyWorkplace(),date=todayKey(),ref=TC.doc(TC.db,'attendance',`${currentUser.uid}_${date}`);
  await TC.runTransaction(TC.db,async tx=>{
   const snap=await tx.get(ref),now=new Date().toISOString();
   if(!snap.exists())tx.set(ref,{employeeId:currentUser.uid,date,clock_in:now,clock_out:null,createdAt:TC.serverTimestamp()});
   else if(!snap.data().clock_out){if(isOnPermission(snap.data()))throw new Error('Primero marca Entrada con permiso para reanudar tu jornada.');tx.update(ref,{clock_out:now})}
   else throw new Error('El turno ya está completo.');
  });
  showError(`✓ Marcación guardada en Firebase · A ${Math.round(locationCheck.distance)} m de Bon House`);
 }catch(e){showError(errorText(e))}finally{if(btn)btn.disabled=false}
}
async function markPermission(action){
 if(!currentUser||!profile||currentUser.uid===ADMIN_UID)return;
 const buttons=[...document.querySelectorAll('#employeeGrid button')];buttons.forEach(b=>b.disabled=true);
 try{
  const loc=await verifyWorkplace(),date=todayKey(),ref=TC.doc(TC.db,'attendance',`${currentUser.uid}_${date}`);
  await TC.runTransaction(TC.db,async tx=>{
   const snap=await tx.get(ref);if(!snap.exists()||!snap.data().clock_in||snap.data().clock_out)throw new Error('No hay una jornada activa.');
   const data=snap.data(),breaks=[...(data.permissionBreaks||[])].map(b=>({...b})),paused=isOnPermission(data),now=new Date().toISOString();
   if(action==='leave'){
    if(paused)throw new Error('Ya tienes un permiso abierto.');
    breaks.push({start:now,end:null});
   }else{
    if(!paused)throw new Error('No tienes una salida con permiso pendiente.');
    breaks[breaks.length-1].end=now;
   }
   tx.update(ref,{permissionBreaks:breaks});
  });
  showError(`✓ ${action==='leave'?'Salida con permiso: horas pausadas':'Entrada con permiso: horas reanudadas'} · A ${Math.round(loc.distance)} m`);
 }catch(e){showError(errorText(e))}finally{buttons.forEach(b=>b.disabled=false)}
}
function openAdmin(){if(currentUser?.uid!==ADMIN_UID){alert('Solo la administradora puede abrir este panel.');return}$('#employeeView').classList.remove('active');$('#adminView').classList.add('active');renderAdmin()}
async function adminCloseShift(e,r){
 if(currentUser?.uid!==ADMIN_UID||!r?.clock_in||r.clock_out)return;
 const entered=prompt(`Salida real de ${e.name} (fecha y hora local, formato AAAA-MM-DD HH:MM):`,`${r.date} 17:00`);
 if(entered===null)return;
 const match=entered.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
 if(!match)return alert('Escribe fecha y hora así: 2026-10-09 17:00');
 const when=new Date(`${match[1]}T${match[2]}:${match[3]}:00`);
 if(!Number.isFinite(when.getTime())||when.getFullYear()!==Number(match[1].slice(0,4))||when.getMonth()+1!==Number(match[1].slice(5,7))||when.getDate()!==Number(match[1].slice(8,10))||when.getHours()!==Number(match[2])||when.getMinutes()!==Number(match[3]))return alert('La fecha u hora no es válida.');
 if(when<=new Date(r.clock_in)||when>new Date())return alert('La salida debe ser posterior a la entrada y no puede estar en el futuro.');
 const reason=prompt('Motivo de la salida manual (obligatorio):','Empleado olvidó marcar salida');
 if(reason===null)return;
 if(reason.trim().length<5)return alert('Escribe un motivo de al menos 5 caracteres.');
 if(!confirm(`¿Registrar salida de ${e.name} a las ${when.toLocaleString('es-SV')}? Esta acción quedará identificada como administrativa.`))return;
 try{
  const ref=TC.doc(TC.db,'attendance',`${e.id}_${r.date}`);
  await TC.runTransaction(TC.db,async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists()||snap.data().clock_out)throw new Error('Este turno ya tiene salida o no existe.');
   if(snap.data().employeeId!==e.id)throw new Error('Empleado incorrecto.');
   if(when<=new Date(snap.data().clock_in))throw new Error('La salida es anterior a la entrada.');
   tx.update(ref,{clock_out:when.toISOString(),exitSource:'admin',exitEditedBy:currentUser.uid,exitEditedAt:TC.serverTimestamp(),exitReason:reason.trim().slice(0,250)});
  });
  showError('✓ Salida administrativa registrada. Horas y pago recalculados.');
 }catch(err){alert('No se pudo registrar la salida: '+errorText(err))}
}
function renderAdmin(){if(currentUser?.uid!==ADMIN_UID)return;const c=state.config;for(const id of Object.keys(defaults))$('#'+id).value=c[id];$('#selectedDateLabel').textContent=prettyDate(selectedDate);$('#todayBadge').textContent=selectedDate===todayKey()?'HOY':'';$('#nextDay').disabled=selectedDate>=todayKey();let present=0,extra=0,money=0;const body=$('#payrollBody');body.innerHTML='';state.employees.forEach(e=>{const r=record(e.id,selectedDate),p=calc(r),perm=permissionHours(r,r?.clock_out||new Date().toISOString());if(selectedDate===todayKey()&&r?.clock_in&&!r.clock_out)present++;extra+=p.extra;money+=p.total;const tr=document.createElement('tr');tr.innerHTML=`<td><div class="namePdfCell"><div><b>${esc(e.name)}</b><br><small>${esc(e.dept||'—')}</small></div><button class="miniPdf">PDF quincenal</button></div></td><td>${fmt(r?.clock_in)}</td><td>${fmt(r?.clock_out)}${r?.exitSource==='admin'?'<br><small>Salida por jefa</small>':''}${isOnPermission(r)?'<br><small>Fuera con permiso</small>':''}${r?.clock_in&&!r?.clock_out?'<br><button class="manualExit">Registrar salida</button>':''}</td><td>${p.h.toFixed(2)} h${perm>0?`<br><small>Permiso no pagado: ${perm.toFixed(2)} h</small>`:''}</td><td>${p.extra.toFixed(2)} h</td><td>$${p.base.toFixed(2)}</td><td>$${p.extraPay.toFixed(2)}</td><td><b>$${p.total.toFixed(2)}</b></td>`;tr.querySelector('.miniPdf').onclick=()=>exportFortnight(e);const exitBtn=tr.querySelector('.manualExit');if(exitBtn)exitBtn.onclick=()=>adminCloseShift(e,r);body.append(tr)});$('#presentCount').textContent=present;$('#extraToday').textContent=extra.toFixed(2)+' h';$('#moneyToday').textContent=$('#dailyGrandTotal').textContent='$'+money.toFixed(2);$('#formulaInfo').textContent=`Valor diario: $${(c.salary/c.paidDays).toFixed(2)} · Hora extra: $${c.extraRate.toFixed(2)}.`;$('#activity').innerHTML=state.employees.map(e=>{const r=record(e.id,selectedDate);return r?.clock_in?`<div>${esc(e.name)} · Entrada ${fmt(r.clock_in)} · Salida ${fmt(r.clock_out)}</div>`:''}).join('')||'<p>No hay marcaciones en esta fecha.</p>';const list=$('#adminEmployees');list.innerHTML='';state.employees.forEach(e=>{const div=document.createElement('div');div.className='adminEmp';div.innerHTML=`<div><b>${esc(e.name)}</b><small>${esc(e.dept)} · @${esc(e.username||'')}</small></div><button>Desactivar</button>`;div.querySelector('button').onclick=async()=>{if(!confirm('¿Desactivar a este empleado? Su historial permanecerá guardado.'))return;try{await TC.setDoc(TC.doc(TC.db,'employees',e.id),{active:false},{merge:true});showError('Empleado desactivado')}catch(err){alert(errorText(err))}};list.append(div)});const[a,b]=fortnightRange(selectedDate);$('#fortnight').textContent='$'+state.attendance.filter(r=>r.date>=a&&r.date<=b).reduce((s,r)=>s+calc(r).total,0).toFixed(2)}
function exportFortnight(e){const[a,b]=fortnightRange(selectedDate),rows=state.attendance.filter(r=>r.employeeId===e.id&&r.date>=a&&r.date<=b).sort((x,y)=>x.date.localeCompare(y.date));let total=0;const trs=rows.map(r=>{const p=calc(r),perm=permissionHours(r,r.clock_out||new Date().toISOString());total+=p.total;return `<tr><td>${r.date}</td><td>${fmt(r.clock_in)}</td><td>${fmt(r.clock_out)}</td><td>${p.h.toFixed(2)} (permiso: ${perm.toFixed(2)} h)</td><td>${p.extra.toFixed(2)}</td><td>$${p.total.toFixed(2)}</td></tr>`}).join('');const w=window.open('','_blank');if(!w)return alert('Permite ventanas emergentes para imprimir.');w.document.write(`<html><head><title>Boleta quincenal</title><style>body{font-family:Arial;padding:30px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}.sign{display:flex;justify-content:space-between;margin-top:70px}</style></head><body><h1>BOLETA DE PAGO QUINCENAL</h1><p>Empleado: ${esc(e.name)} · ${esc(e.dept)}</p><p>Período: ${a} al ${b}</p><table><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th>Horas</th><th>Extra</th><th>Total</th></tr>${trs}</table><h2>Total calculado: $${total.toFixed(2)}</h2><p>Estimación según configuración del sistema; verificar con planilla oficial.</p><div class="sign"><span>___________________<br>Empleado</span><span>___________________<br>Responsable</span></div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close()}
async function addEmployee(){if(currentUser?.uid!==ADMIN_UID)return;const name=$('#newName').value.trim(),dept=$('#newDept').value.trim(),username=uname($('#newUsername').value),password=$('#newPin').value;if(!name||!/^[a-z0-9._-]{3,32}$/.test(username)||password.length<6)return alert('Nombre, usuario (3-32 letras/números) y contraseña de al menos 6 caracteres.');const btn=$('#addEmployee');btn.disabled=true;let secondary=null;try{secondary=TC.initializeApp(window.TIMECORE_FIREBASE_CONFIG,'employee-create-'+Date.now());const secondaryAuth=TC.getAuth(secondary);const cred=await TC.createUserWithEmailAndPassword(secondaryAuth,loginEmail(username),password);await TC.setDoc(TC.doc(TC.db,'employees',cred.user.uid),{name,dept,username,active:true,createdAt:TC.serverTimestamp()});$('#newName').value=$('#newDept').value=$('#newUsername').value=$('#newPin').value='';showError(`Empleado ${name} creado. Comparte su usuario y contraseña de forma privada.`)}catch(e){alert('No se pudo completar el alta: '+errorText(e)+'. Si la cuenta se creó en Authentication pero no en Firestore, revisa antes de reintentar.')}finally{if(secondary)await TC.deleteApp(secondary).catch(()=>{});btn.disabled=false}}
async function loadSession(user){clearListeners();currentUser=user;profile=null;state.employees=[];state.attendance=[];$('#adminView').classList.remove('active');$('#employeeView').classList.add('active');$('#loginScreen').classList.toggle('hidden',!!user);$('#mainApp').classList.toggle('hidden',!user);if(!user){showError('Inicia sesión para sincronizar');renderEmployees();return}showError('Conectado a Firebase');if(user.uid===ADMIN_UID){unsubs.push(TC.onSnapshot(TC.collection(TC.db,'employees'),snap=>{state.employees=snap.docs.map(d=>({id:d.id,...d.data()})).filter(e=>e.active!==false);renderAdmin();renderEmployees()},e=>showError(errorText(e))));unsubs.push(TC.onSnapshot(TC.collection(TC.db,'attendance'),snap=>{state.attendance=snap.docs.map(d=>d.data());renderAdmin();renderEmployees()},e=>showError(errorText(e))));unsubs.push(TC.onSnapshot(TC.doc(TC.db,'settings','payroll'),snap=>{state.config={...defaults,...(snap.data()||{})};renderAdmin()},e=>showError(errorText(e))));openAdmin()}else{const snap=await TC.getDoc(TC.doc(TC.db,'employees',user.uid));if(!snap.exists()||snap.data().active===false){showError('Cuenta sin perfil activo. Contacta a la jefa.');await TC.signOut(TC.auth);return}profile={id:user.uid,...snap.data()};unsubs.push(TC.onSnapshot(TC.doc(TC.db,'attendance',`${user.uid}_${todayKey()}`),snap=>{state.attendance=snap.exists()?[snap.data()]:[];renderEmployees()},e=>showError(errorText(e))));renderEmployees()}}
function shift(n){const d=new Date(selectedDate+'T12:00:00');d.setDate(d.getDate()+n);selectedDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(selectedDate>todayKey())selectedDate=todayKey();renderAdmin()}
$('#prevDay').onclick=()=>shift(-1);$('#nextDay').onclick=()=>shift(1);$('#addEmployee').onclick=addEmployee;$('#applyConfig').onclick=async()=>{const next={};for(const id of Object.keys(defaults)){const n=Number($('#'+id).value);if(!Number.isFinite(n)||n<0||(id==='paidDays'||id==='normalHours')&&n===0)return alert('Revisa los valores de pago.');next[id]=n}try{await TC.setDoc(TC.doc(TC.db,'settings','payroll'),next);showError('Configuración guardada')}catch(e){alert(errorText(e))}};$('#exportPdf').onclick=()=>window.print();$('#closeFortnight').onclick=()=>alert('El cierre definitivo de quincena no está disponible.');$('#back').onclick=()=>{$('#adminView').classList.remove('active');$('#employeeView').classList.add('active');renderEmployees()};$('#openAdmin').onclick=openAdmin;$('#logout').onclick=()=>TC.signOut(TC.auth);$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';const user=$('#loginUser').value.trim(),pass=$('#loginPass').value;try{await TC.signInWithEmailAndPassword(TC.auth,loginEmail(user),pass)}catch(err){$('#loginError').textContent=errorText(err)}};
window.addEventListener('tc-ready',()=>TC.onAuthStateChanged(TC.auth,u=>loadSession(u).catch(e=>showError(errorText(e)))));
