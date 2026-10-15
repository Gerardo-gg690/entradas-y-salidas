/* CONFIGURACIÓN Y UTILIDADES GENERALES */
const $ = s => document.querySelector(s);
const ADMIN_UID = 'tFUODWGOkXeCm18fSO1bKZCm3ms2';
// Centro fijo de Bon House: comprobar coordenadas antes de usar en producción.
const WORKPLACE = Object.freeze({ latitude: 13.9871804, longitude: -89.5491599, radiusMeters: 50 });
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const defaults = { salary: 408, halfSalary: 204, paidDays: 30, normalHours: 8, extraRate: 3 };
let state = { employees: [], attendance: [], closures: [], config: { ...defaults } }, selectedDate = todayKey(), currentUser = null, profile = null, unsubs = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => t ? new Date(t).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—';
const prettyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
const uname = s => s.trim().toLowerCase();
const loginEmail = s => s.includes('@') ? s.trim() : `${uname(s)}@timecore.invalid`;
const errorText = e => ({ 'auth/invalid-credential': 'Usuario o contraseña incorrectos.', 'auth/email-already-in-use': 'Este usuario ya existe.', 'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.', 'permission-denied': 'No tienes permisos. Comprueba las reglas de Firestore.', 'unavailable': 'Sin conexión. Intenta nuevamente.' }[e.code] || e.message || 'Ocurrió un error.');
function showError(message) {
    const status = $('#syncStatus');
    const text = String(message || '');
    const isLocationWarning = /fuera del radio|distancia estimada|ubicación precisa|no se pudo confirmar que estás dentro/i.test(text);
    if (isLocationWarning && window.TimeCoreLocationAlert) {
        status.textContent = '';
        window.TimeCoreLocationAlert.open(text);
        return;
    }
    status.textContent = text;
}
function clock() { $('#clock').textContent = new Date().toLocaleString('es-SV', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
clock();
setInterval(clock, 1000);
function clearListeners() { unsubs.forEach(f => f()); unsubs = []; }
function record(id, date) { return state.attendance.find(r => r.employeeId === id && r.date === date); }
function permissionHours(r, endTime) {
    const end = new Date(endTime || r?.clock_out || Date.now()).getTime();
    return (r?.permissionBreaks || []).reduce((sum, b) => {
        const from = new Date(b.start).getTime(), to = b.end ? new Date(b.end).getTime() : end;
        return sum + (Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from) : 0);
    }, 0) / 36e5;
}
function calc(r) {
    if (!r?.clock_in || !r?.clock_out)
        return { h: 0, extra: 0, base: 0, extraPay: 0, total: 0 };
    const elapsed = Math.max(0, (new Date(r.clock_out) - new Date(r.clock_in)) / 36e5);
    const h = Math.max(0, elapsed - permissionHours(r)), extra = Math.max(0, h - state.config.normalHours);
    const normal = Math.min(h, state.config.normalHours), base = normal / state.config.normalHours * (state.config.salary / state.config.paidDays);
    const extraPay = extra * state.config.extraRate;
    return { h, extra, base, extraPay, total: base + extraPay };
}
function isOnPermission(r) { const b = r?.permissionBreaks || []; return b.length > 0 && !b[b.length - 1].end; }
// El cierre de quincena usa una clave única YYYY-MM-DD_YYYY-MM-DD.
function closureId(start, end) { return `${start}_${end}`; }
function closureFor(start, end) { return state.closures.find(item => item.id === closureId(start, end)); }
function periodTotals(start, end) {
    const people = state.employees.map(employee => {
        const rows = state.attendance.filter(r => r.employeeId === employee.id && r.date >= start && r.date <= end);
        const base = rows.reduce((sum, r) => sum + calc(r).base, 0);
        const extra = rows.reduce((sum, r) => sum + calc(r).extraPay, 0);
        return { employeeId: employee.id, name: employee.name, dept: employee.dept || '', base: Number(base.toFixed(2)), overtime: Number(extra.toFixed(2)), total: Number((base + extra).toFixed(2)), days: rows.length };
    });
    return { people, total: Number(people.reduce((sum, e) => sum + e.total, 0).toFixed(2)) };
}
function renderClosures() {
    const host = $('#closureHistory');
    if (!host || currentUser?.uid !== ADMIN_UID) return;
    const [start, end] = fortnightRange(selectedDate);
    const closed = closureFor(start, end);
    const button = $('#closeFortnight');
    button.textContent = closed ? 'Quincena cerrada' : 'Cerrar quincena';
    button.disabled = !!closed;
    $('#closureCurrent').textContent = `Período seleccionado: ${start} al ${end} · ${closed ? 'CERRADO' : 'ABIERTO'}`;
    host.innerHTML = '';
    const list = [...state.closures].sort((a,b) => b.start.localeCompare(a.start));
    if (!list.length) { host.textContent = 'Todavía no hay quincenas cerradas.'; return; }
    for (const item of list) {
        const row = document.createElement('div');
        row.className = 'closure-row';
        const info = document.createElement('div');
        const status = item.paid ? 'PAGADA' : 'CERRADA · PENDIENTE DE PAGO';
        info.innerHTML = `<strong>${esc(item.start)} al ${esc(item.end)}</strong><br><small>${esc(status)} · Total: $${Number(item.total || 0).toFixed(2)} · ${Array.isArray(item.people) ? item.people.length : 0} empleados</small>`;
        const actions = document.createElement('div');
        const print = document.createElement('button');
        print.type = 'button'; print.textContent = 'Ver resumen';
        print.onclick = () => showClosureReceipt(item);
        actions.append(print);
        if (!item.paid) {
            const paid = document.createElement('button');
            paid.type = 'button'; paid.textContent = 'Marcar como pagada';
            paid.onclick = () => markClosurePaid(item);
            actions.append(paid);
        }
        row.append(info, actions); host.append(row);
    }
}
function showClosureReceipt(item) {
    const lines = (item.people || []).map(e => `${e.name}: $${Number(e.total).toFixed(2)}`).join('\n');
    alert(`BON HOUSE · CIERRE DE QUINCENA\n${item.start} al ${item.end}\nEstado: ${item.paid ? 'Pagada' : 'Pendiente de pago'}\n\n${lines}\n\nTOTAL: $${Number(item.total || 0).toFixed(2)}`);
}
async function closeFortnight() {
    if (currentUser?.uid !== ADMIN_UID) return;
    const [start, end] = fortnightRange(selectedDate);
    if (closureFor(start, end)) return alert('Esta quincena ya está cerrada.');
    if (end > todayKey()) return alert('Espera a que finalice la quincena antes de cerrarla.');
    const pending = state.attendance.filter(r => r.date >= start && r.date <= end && r.clock_in && !r.clock_out);
    if (pending.length) return alert(`Hay ${pending.length} jornada(s) con salida pendiente. Corrígelas antes del cierre.`);
    const { people, total } = periodTotals(start, end);
    if (!confirm(`¿Cerrar DEFINITIVAMENTE la quincena ${start} al ${end}?\n\nEmpleados: ${people.length}\nTotal estimado: $${total.toFixed(2)}\n\nSe guardará un resumen histórico y se bloquearán las marcaciones de ese período. Esto NO significa que ya se pagó.`)) return;
    try {
        const ref = TC.doc(TC.db, 'payrollClosures', closureId(start, end));
        await TC.runTransaction(TC.db, async tx => {
            const existing = await tx.get(ref);
            if (existing.exists()) throw new Error('La quincena ya fue cerrada desde otra sesión.');
            tx.set(ref, { start, end, people, total, paid: false, closedBy: currentUser.uid, closedAt: TC.serverTimestamp(), config: { ...state.config } });
        });
        alert('Quincena cerrada y guardada en Firebase. Ahora puedes marcarla como pagada cuando corresponda.');
    } catch(e) { alert('No se pudo cerrar: ' + errorText(e)); }
}
async function markClosurePaid(item) {
    if (currentUser?.uid !== ADMIN_UID || item.paid) return;
    if (!confirm(`¿Confirmas que la quincena ${item.start} al ${item.end} YA FUE PAGADA? Esta acción quedará registrada.`)) return;
    try {
        await TC.runTransaction(TC.db, async tx => {
            const ref = TC.doc(TC.db, 'payrollClosures', item.id);
            const snap = await tx.get(ref);
            if (!snap.exists() || snap.data().paid) throw new Error('La quincena ya fue pagada o no existe.');
            tx.update(ref, { paid: true, paidAt: TC.serverTimestamp(), paidBy: currentUser.uid });
        });
    } catch(e) { alert('No se pudo marcar como pagada: ' + errorText(e)); }
}
function fortnightRange(date) { const [y, m, d] = date.split('-').map(Number); const a = d <= 15 ? 1 : 16, b = d <= 15 ? 15 : new Date(y, m, 0).getDate(); return [`${y}-${String(m).padStart(2, '0')}-${String(a).padStart(2, '0')}`, `${y}-${String(m).padStart(2, '0')}-${String(b).padStart(2, '0')}`]; }
/* VISTA DE EMPLEADO: solo muestra su propia jornada. */
function renderEmployees() {
    const grid = $('#employeeGrid');
    grid.innerHTML = '';
    $('#emptyIntro').style.display = 'none';
    if (!currentUser) {
        $('#emptyIntro').style.display = 'flex';
        $('#emptyIntro').innerHTML = '<strong>Inicia sesión para registrar tu asistencia.</strong><span>Usa el usuario y contraseña que te asignó la jefa.</span>';
        return;
    }
    if (currentUser.uid === ADMIN_UID) {
        $('#emptyIntro').style.display = 'flex';
        $('#emptyIntro').innerHTML = '<strong>Personal registrado en Bon House</strong><span>Vista de administración: consulta el personal aquí. Para ver asistencias, pagos o registrar una salida pendiente, abre el Panel de la jefa.</span>';
        if (!state.employees.length) {
            const msg = document.createElement('p');
            msg.className = 'muted';
            msg.textContent = 'No hay empleados activos registrados todavía.';
            grid.append(msg);
        }
        state.employees.forEach(e => { const r = record(e.id, todayKey()); const status = r?.clock_out ? 'Turno finalizado' : r?.clock_in ? 'Salida pendiente' : 'Sin entrada registrada'; const card = document.createElement('article'); card.className = 'employee'; card.innerHTML = `<div class="avatar">${esc(e.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase())}</div><h3>${esc(e.name)}</h3><p>${esc(e.dept || 'Sin departamento')} · @${esc(e.username || '')}</p><span class="status">${status}</span><button type="button">Ver en panel de la jefa</button>`; card.querySelector('button').onclick = openAdmin; grid.append(card); });
        return;
    }
    const e = profile;
    if (!e)
        return;
    const r = record(e.id, todayKey()), done = !!r?.clock_out, started = !!r?.clock_in, paused = isOnPermission(r);
    const card = document.createElement('article');
    card.className = 'employee';
    card.innerHTML = `<div class="avatar">${esc(e.name.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase())}</div><h3>${esc(e.name)}</h3><p>${esc(e.dept || 'Sin departamento')}</p><span class="status ${done ? 'done' : started ? 'working' : ''}">${done ? 'Turno finalizado' : paused ? 'Fuera con permiso · tiempo pausado' : started ? 'Jornada activa' : 'Sin entrada registrada'}</span><div class="tc-actions"></div>`;
    const actions = card.querySelector('.tc-actions');
    const normal = document.createElement('button');
    normal.type = 'button';
    normal.textContent = done ? 'Turno completado' : !started ? 'Marcar entrada' : paused ? 'Salida normal no disponible durante el permiso' : 'Marcar salida';
    normal.disabled = done || paused;
    normal.onclick = markAttendance;
    actions.append(normal);
    if (started && !done) {
        const permission = document.createElement('button');
        permission.type = 'button';
        permission.textContent = paused ? 'Entrada con permiso' : 'Salida con permiso';
        permission.style.marginTop = '8px';
        permission.style.background = paused ? '#117d68' : '#a65b24';
        permission.onclick = () => markPermission(paused ? 'return' : 'leave');
        actions.append(permission);
    }
    const info = document.createElement('p');
    info.textContent = 'Marcaciones dentro de 50 m de Bon House. Los permisos son sin goce de sueldo.';
    info.style.fontSize = '12px';
    info.style.opacity = '.75';
    card.append(info);
    grid.append(card);
}
function metersBetween(aLat, aLon, bLat, bLon) { const rad = Math.PI / 180, R = 6371000; const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
/* GEOLOCALIZACIÓN: conserva el radio de 50 metros. */
async function verifyWorkplace() {
    if (!navigator.geolocation)
        throw new Error('Este dispositivo no permite obtener la ubicación.');
    if (!window.isSecureContext)
        throw new Error('Abre TimeCore desde su enlace HTTPS para usar la ubicación.');
    showError('Comprobando ubicación respecto a Bon House (radio 50 m)…');
    // Pedir varias mediciones frescas: la primera suele ser una posición aproximada.
    // Una lectura solo es suficiente cuando su margen de error queda dentro del radio.
    const deadline = Date.now() + 45000;
    let best = null, lastError = null;
    for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt++) {
        showError(`Buscando ubicación precisa… intento ${attempt + 1} de 4`);
        try {
            const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: Math.min(12000, Math.max(1000, deadline - Date.now())), maximumAge: 0 }));
            const { latitude, longitude, accuracy } = pos.coords;
            if (![latitude, longitude, accuracy].every(Number.isFinite))
                continue;
            const distance = metersBetween(latitude, longitude, WORKPLACE.latitude, WORKPLACE.longitude);
            const candidate = { distance, accuracy };
            if (!best || accuracy < best.accuracy)
                best = candidate;
            if (distance + accuracy <= WORKPLACE.radiusMeters)
                return candidate;
            // Rechazo inequívoco cuando incluso el margen inferior queda fuera del radio.
            if (distance - accuracy > WORKPLACE.radiusMeters)
                throw new Error(`Estás fuera del radio de ${WORKPLACE.radiusMeters} m de Bon House (distancia estimada: ${Math.round(distance)} m).`);
        }
        catch (e) {
            if (e.message?.startsWith('Estás fuera'))
                throw e;
            lastError = e;
            if (e.code === 1)
                throw new Error('Permite la ubicación precisa para TimeCore en los ajustes del teléfono.');
        }
    }
    if (best)
        throw new Error(`No se pudo confirmar que estás dentro de ${WORKPLACE.radiusMeters} m de Bon House. Distancia estimada: ${Math.round(best.distance)} m; precisión: ±${Math.round(best.accuracy)} m. Activa ubicación precisa, Wi-Fi y vuelve a intentar cerca de una ventana o al aire libre.`);
    throw new Error('No se pudo obtener tu ubicación. Activa ubicación precisa y vuelve a intentar. ' + (lastError?.message || ''));
}
async function markAttendance() {
    if (!currentUser || !profile || currentUser.uid === ADMIN_UID)
        return;
    const btn = $('#employeeGrid button');
    if (btn)
        btn.disabled = true;
    try {
        const locationCheck = await verifyWorkplace(), date = todayKey(), ref = TC.doc(TC.db, 'attendance', `${currentUser.uid}_${date}`);
        await TC.runTransaction(TC.db, async (tx) => {
            const snap = await tx.get(ref), now = new Date().toISOString();
            if (!snap.exists())
                tx.set(ref, { employeeId: currentUser.uid, date, clock_in: now, clock_out: null, createdAt: TC.serverTimestamp() });
            else if (!snap.data().clock_out) {
                if (isOnPermission(snap.data()))
                    throw new Error('Primero marca Entrada con permiso para reanudar tu jornada.');
                tx.update(ref, { clock_out: now });
            }
            else
                throw new Error('El turno ya está completo.');
        });
        showError(`✓ Marcación guardada en Firebase · A ${Math.round(locationCheck.distance)} m de Bon House`);
    }
    catch (e) {
        showError(errorText(e));
    }
    finally {
        if (btn)
            btn.disabled = false;
    }
}
async function markPermission(action) {
    if (!currentUser || !profile || currentUser.uid === ADMIN_UID)
        return;
    const buttons = [...document.querySelectorAll('#employeeGrid button')];
    buttons.forEach(b => b.disabled = true);
    try {
        const loc = await verifyWorkplace(), date = todayKey(), ref = TC.doc(TC.db, 'attendance', `${currentUser.uid}_${date}`);
        await TC.runTransaction(TC.db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists() || !snap.data().clock_in || snap.data().clock_out)
                throw new Error('No hay una jornada activa.');
            const data = snap.data(), breaks = [...(data.permissionBreaks || [])].map(b => ({ ...b })), paused = isOnPermission(data), now = new Date().toISOString();
            if (action === 'leave') {
                if (paused)
                    throw new Error('Ya tienes un permiso abierto.');
                breaks.push({ start: now, end: null });
            }
            else {
                if (!paused)
                    throw new Error('No tienes una salida con permiso pendiente.');
                breaks[breaks.length - 1].end = now;
            }
            tx.update(ref, { permissionBreaks: breaks });
        });
        showError(`✓ ${action === 'leave' ? 'Salida con permiso: horas pausadas' : 'Entrada con permiso: horas reanudadas'} · A ${Math.round(loc.distance)} m`);
    }
    catch (e) {
        showError(errorText(e));
    }
    finally {
        buttons.forEach(b => b.disabled = false);
    }
}
function openAdmin() { if (currentUser?.uid !== ADMIN_UID) {
    alert('Solo la administradora puede abrir este panel.');
    return;
} $('#employeeView').classList.remove('active'); $('#adminView').classList.add('active'); renderAdmin(); }
async function adminCloseShift(e, r) {
    if (currentUser?.uid !== ADMIN_UID || !r?.clock_in || r.clock_out)
        return;
    const entered = prompt(`Salida real de ${e.name} (fecha y hora local, formato AAAA-MM-DD HH:MM):`, `${r.date} 17:00`);
    if (entered === null)
        return;
    const match = entered.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
    if (!match)
        return alert('Escribe fecha y hora así: 2026-10-09 17:00');
    const when = new Date(`${match[1]}T${match[2]}:${match[3]}:00`);
    if (!Number.isFinite(when.getTime()) || when.getFullYear() !== Number(match[1].slice(0, 4)) || when.getMonth() + 1 !== Number(match[1].slice(5, 7)) || when.getDate() !== Number(match[1].slice(8, 10)) || when.getHours() !== Number(match[2]) || when.getMinutes() !== Number(match[3]))
        return alert('La fecha u hora no es válida.');
    if (when <= new Date(r.clock_in) || when > new Date())
        return alert('La salida debe ser posterior a la entrada y no puede estar en el futuro.');
    const reason = prompt('Motivo de la salida manual (obligatorio):', 'Empleado olvidó marcar salida');
    if (reason === null)
        return;
    if (reason.trim().length < 5)
        return alert('Escribe un motivo de al menos 5 caracteres.');
    if (!confirm(`¿Registrar salida de ${e.name} a las ${when.toLocaleString('es-SV')}? Esta acción quedará identificada como administrativa.`))
        return;
    try {
        const ref = TC.doc(TC.db, 'attendance', `${e.id}_${r.date}`);
        await TC.runTransaction(TC.db, async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists() || snap.data().clock_out)
                throw new Error('Este turno ya tiene salida o no existe.');
            if (snap.data().employeeId !== e.id)
                throw new Error('Empleado incorrecto.');
            if (when <= new Date(snap.data().clock_in))
                throw new Error('La salida es anterior a la entrada.');
            tx.update(ref, { clock_out: when.toISOString(), exitSource: 'admin', exitEditedBy: currentUser.uid, exitEditedAt: TC.serverTimestamp(), exitReason: reason.trim().slice(0, 250) });
        });
        showError('✓ Salida administrativa registrada. Horas y pago recalculados.');
    }
    catch (err) {
        alert('No se pudo registrar la salida: ' + errorText(err));
    }
}
/* PANEL ADMINISTRATIVO: métricas y registros del personal. */
function renderAdmin() { if (currentUser?.uid !== ADMIN_UID)
    return; renderPayslipOptions(); const c = state.config; for (const id of Object.keys(defaults))
    $('#' + id).value = c[id]; $('#selectedDateLabel').textContent = prettyDate(selectedDate); $('#todayBadge').textContent = selectedDate === todayKey() ? 'HOY' : ''; $('#nextDay').disabled = selectedDate >= todayKey(); let present = 0, extra = 0, money = 0; const body = $('#payrollBody'); body.innerHTML = ''; state.employees.forEach(e => { const r = record(e.id, selectedDate), p = calc(r), perm = permissionHours(r, r?.clock_out || new Date().toISOString()); if (selectedDate === todayKey() && r?.clock_in && !r.clock_out)
    present++; extra += p.extra; money += p.total; const tr = document.createElement('tr'); tr.innerHTML = `<td><div class="namePdfCell"><div><b>${esc(e.name)}</b><br><small>${esc(e.dept || '—')}</small></div><button class="miniPdf">PDF quincenal</button></div></td><td>${fmt(r?.clock_in)}</td><td>${fmt(r?.clock_out)}${r?.exitSource === 'admin' ? '<br><small>Salida por jefa</small>' : ''}${isOnPermission(r) ? '<br><small>Fuera con permiso</small>' : ''}${r?.clock_in && !r?.clock_out ? '<br><button class="manualExit">Registrar salida</button>' : ''}</td><td>${p.h.toFixed(2)} h${perm > 0 ? `<br><small>Permiso no pagado: ${perm.toFixed(2)} h</small>` : ''}</td><td>${p.extra.toFixed(2)} h</td><td>$${p.base.toFixed(2)}</td><td>$${p.extraPay.toFixed(2)}</td><td><b>$${p.total.toFixed(2)}</b></td>`; tr.querySelector('.miniPdf').onclick = () => exportFortnight(e); const exitBtn = tr.querySelector('.manualExit'); if (exitBtn)
    exitBtn.onclick = () => adminCloseShift(e, r); body.append(tr); }); $('#presentCount').textContent = present; $('#extraToday').textContent = extra.toFixed(2) + ' h'; $('#moneyToday').textContent = $('#dailyGrandTotal').textContent = '$' + money.toFixed(2); $('#formulaInfo').textContent = `Valor diario: $${(c.salary / c.paidDays).toFixed(2)} · Hora extra: $${c.extraRate.toFixed(2)}.`; $('#activity').innerHTML = state.employees.map(e => { const r = record(e.id, selectedDate); return r?.clock_in ? `<div>${esc(e.name)} · Entrada ${fmt(r.clock_in)} · Salida ${fmt(r.clock_out)}</div>` : ''; }).join('') || '<p>No hay marcaciones en esta fecha.</p>'; const list = $('#adminEmployees'); list.innerHTML = ''; state.employees.forEach(e => { const div = document.createElement('div'); div.className = 'adminEmp'; div.innerHTML = `<div><b>${esc(e.name)}</b><small>${esc(e.dept)} · @${esc(e.username || '')}</small></div><button>Desactivar</button>`; div.querySelector('button').onclick = async () => { if (!confirm('¿Desactivar a este empleado? Su historial permanecerá guardado.'))
    return; try {
    await TC.setDoc(TC.doc(TC.db, 'employees', e.id), { active: false }, { merge: true });
    showError('Empleado desactivado');
}
catch (err) {
    alert(errorText(err));
} }; list.append(div); }); const [a, b] = fortnightRange(selectedDate); $('#fortnight').textContent = '$' + state.attendance.filter(r => r.date >= a && r.date <= b).reduce((s, r) => s + calc(r).total, 0).toFixed(2); renderClosures(); }
/* ================================================================
 * BOLETAS DE PAGO QUINCENAL
 * - Datos de Firestore ya cargados en state.
 * - Solo el UID administrador puede generar boletas.
 * - Permisos no remunerados descontados por calc().
 * - Se imprime en ventana nueva, sin escribir en Firebase.
 * ================================================================ */
function renderPayslipOptions() {
    const selector = $('#payslipEmployee');
    if (!selector)
        return;
    const previous = selector.value;
    selector.innerHTML = '<option value="">Seleccionar empleado</option>';
    for (const employee of state.employees) {
        const option = document.createElement('option');
        option.value = employee.id;
        option.textContent = employee.name;
        selector.append(option);
    }
    if (state.employees.some(employee => employee.id === previous))
        selector.value = previous;
}
function payslipRange() {
    const [year, month] = selectedDate.split('-').map(Number);
    const choice = $('#payslipPeriod').value;
    const reference = choice === 'first' ? `${year}-${String(month).padStart(2, '0')}-01`
        : choice === 'second' ? `${year}-${String(month).padStart(2, '0')}-16` : selectedDate;
    return fortnightRange(reference);
}
function exportFortnight(employee, chosenRange = null, documentType = "report") {
    if (currentUser?.uid !== ADMIN_UID)
        return;
    const [start, end] = chosenRange || fortnightRange(selectedDate);
    const records = state.attendance
        .filter(row => row.employeeId === employee.id && row.date >= start && row.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date));
    let ordinary = 0, overtime = 0, permission = 0, total = 0, worked = 0;
    const rows = records.map(row => {
        const payment = calc(row);
        const unpaidHours = permissionHours(row, row.clock_out || new Date().toISOString());
        ordinary += payment.base;
        overtime += payment.extraPay;
        permission += unpaidHours;
        worked += payment.h;
        total += payment.total;
        return `<tr>
      <td>${esc(row.date)}</td>
      <td>${esc(fmt(row.clock_in))}</td>
      <td>${esc(fmt(row.clock_out))}</td>
      <td class="num">${payment.h.toFixed(2)} h</td>
      <td class="num">${payment.extra.toFixed(2)} h</td>
      <td class="num">${unpaidHours.toFixed(2)} h</td>
      <td class="num">$${payment.total.toFixed(2)}</td>
    </tr>`;
    }).join('');
    // Dos documentos distintos: comprobante económico o reporte de marcaciones.
    // Nunca mezclamos el detalle de jornadas dentro de la boleta formal.
    const isPayslip = documentType === 'payslip';
    // Abrimos una ventana aislada para imprimir sin modificar la pantalla principal.
    const printWindow = window.open('', '_blank');
    if (!printWindow)
        return alert('Permite las ventanas emergentes para imprimir la boleta.');
    const issued = new Date().toLocaleDateString('es-SV');
    const reference = `BH-${start.replaceAll('-', '')}-${employee.id.slice(0, 6).toUpperCase()}`;
    printWindow.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isPayslip ? "Boleta de pago" : "Reporte de horas"} - ${esc(employee.name)}</title>
<style>
  @page { size: letter; margin: 15mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.5 Arial, sans-serif; color: #17243a; }
  .sectionHeading { margin-top: 23px; background: #eaf0f6; padding: 9px 12px; font-size: 12px; font-weight: 800; letter-spacing: .6px; }
  .moneyTable { margin-top: 8px; font-size: 12px; }
  .moneyTable td { padding: 11px 12px; }
  .moneyTable td:last-child { text-align: right; font-weight: 700; }
  .top { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #193e70; padding-bottom: 18px; }
  .brand { font-size: 24px; font-weight: 800; letter-spacing: 1px; }
  .tagline { font-size: 10px; letter-spacing: 2px; color: #66768c; }
  .brandIcon { font-size: 32px; }
  h1 { text-align: center; margin: 24px 0 4px; font-size: 20px; letter-spacing: 1px; }
  .subtitle { text-align: center; color: #68768a; margin: 0 0 24px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 14px; background: #f2f5fa; border: 1px solid #dbe3ef; }
  .label { display: block; font-size: 9px; letter-spacing: 1px; font-weight: 700; color: #718095; }
  .value { font-size: 12px; font-weight: 700; }
  h2 { font-size: 13px; color: #193e70; margin: 22px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { background: #193e70; color: white; text-align: left; padding: 9px 6px; }
  td { padding: 9px 6px; border-bottom: 1px solid #dbe3ef; }
  tr:nth-child(even) td { background: #f5f8fc; }
  .num { text-align: right; white-space: nowrap; }
  .summary { margin-top: 20px; margin-left: auto; max-width: 320px; }
  .summary div { display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
  .summary .total { background: #193e70; color: #fff; font-size: 17px; font-weight: 700; border: 0; margin-top: 6px; padding: 12px; }
  .notice { margin-top: 22px; color: #5c6b7f; font-size: 10px; }
  .signatures { display: flex; justify-content: space-between; gap: 50px; margin-top: 72px; text-align: center; }
  .signatures div { width: 42%; border-top: 1px solid #334155; padding-top: 7px; }
  footer { border-top: 1px solid #dbe3ef; margin-top: 30px; padding-top: 10px; color: #718095; font-size: 9px; }
  .print-actions { display: flex; gap: 12px; justify-content: center; margin: 24px 0; }
  .print-actions button { padding: 12px 18px; border: 0; border-radius: 8px; background: #193e70; color: #fff; font-weight: 700; cursor: pointer; }
  .print-actions button + button { background: #e6ebf1; color: #17243a; }
  @media print { .print-actions { display: none !important; } .top, .info, .summary, .signatures, table { break-inside: avoid; } }
</style>
</head>
<body>
<header class="top">
  <div><div class="brand">BON HOUSE</div><div class="tagline">CAFETERÍA · COMPROBANTE DE PLANILLA</div></div>
  <div class="brandIcon">☕</div>
</header>
<h1>${isPayslip ? "BOLETA DE PAGO QUINCENAL" : "REPORTE QUINCENAL DE HORAS LABORALES"}</h1>
<p class="subtitle">${isPayslip ? "Comprobante individual de remuneración" : "Detalle de asistencia y jornadas"}</p>
<section class="info">
  <div><span class="label">EMPLEADO</span><span class="value">${esc(employee.name)}</span></div>
  <div><span class="label">REFERENCIA</span><span class="value">${esc(reference)}</span></div>
  <div><span class="label">DEPARTAMENTO / SUCURSAL</span><span class="value">${esc(employee.dept || 'No especificado')}</span></div>
  <div><span class="label">FECHA DE EMISIÓN</span><span class="value">${esc(issued)}</span></div>
  <div><span class="label">INICIO DEL PERÍODO</span><span class="value">${esc(start)}</span></div>
  <div><span class="label">FIN DEL PERÍODO</span><span class="value">${esc(end)}</span></div>
</section>
${isPayslip ? `
<section class="sectionHeading">DETALLE DE REMUNERACIÓN</section>
<table class="moneyTable">
  <thead><tr><th>CONCEPTO</th><th class="num">IMPORTE (USD)</th></tr></thead>
  <tbody>
    <tr><td>Remuneración ordinaria calculada</td><td>$${ordinary.toFixed(2)}</td></tr>
    <tr><td>Remuneración por horas extraordinarias</td><td>$${overtime.toFixed(2)}</td></tr>
    <tr><td>Descuentos y ajustes</td><td>No configurados</td></tr>
  </tbody>
</table>
<section class="summary"><div class="total"><span>TOTAL ESTIMADO A PAGAR</span><span>$${total.toFixed(2)}</span></div></section>
` : `
<h2>Detalle de horas laborales y marcaciones</h2>
<table>
<thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th class="num">Horas</th><th class="num">Extras</th><th class="num">Permiso no pagado</th><th class="num">Total</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">Sin registros en este período.</td></tr>'}</tbody>
</table>
<section class="summary">
  <div><span>Horas trabajadas</span><strong>${worked.toFixed(2)} h</strong></div>
  <div><span>Permisos sin goce</span><strong>${permission.toFixed(2)} h</strong></div>
  <div><span>Pago base calculado</span><strong>$${ordinary.toFixed(2)}</strong></div>
  <div><span>Pago de horas extra</span><strong>$${overtime.toFixed(2)}</strong></div>
  <div class="total"><span>TOTAL ESTIMADO</span><span>$${total.toFixed(2)}</span></div>
</section>
`}
<p class="notice">${isPayslip ? "Importe estimado según los registros y la configuración actual de TimeCore. No constituye constancia de pago realizado. Revisar con la planilla oficial antes de emitir." : "Reporte de horas calculado según las marcaciones disponibles. Verificar antes de utilizar en planilla."}</p>
<section class="signatures"><div>Firma del empleado</div><div>Firma del responsable</div></section>
<footer>Bon House · TimeCore · Documento generado a partir de los registros disponibles.</footer>
<div class="print-actions" role="toolbar" aria-label="Opciones de boleta">
  <button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button>
  <button type="button" onclick="window.close()">Cerrar boleta y volver a TimeCore</button>
</div>
<script>
  // No iniciamos la impresión automáticamente: algunos navegadores dejan
  // bloqueada la ventana original cuando se vuelve del diálogo de impresión.
  // El usuario imprime desde el botón de esta ventana independiente.
<\/script>
</body>
</html>`);
    printWindow.document.close();
    // La boleta se genera en otra ventana: el panel de TimeCore no se reemplaza.
    // Sin listeners de foco ni overlays en la ventana principal.
    // TimeCore permanece interactivo mientras la boleta está abierta.
}
/* Acciones del módulo independiente de boletas. */
$('#generatePayslip').onclick = () => {
    if (currentUser?.uid !== ADMIN_UID)
        return;
    const employee = state.employees.find(item => item.id === $('#payslipEmployee').value);
    if (!employee)
        return alert('Selecciona un empleado para generar su boleta.');
    exportFortnight(employee, payslipRange(), "payslip");
};
/* AUTENTICACIÓN Y CONTROL DE ACCESO POR ROL. */
async function loadSession(user) { clearListeners(); currentUser = user; profile = null; state.employees = []; state.attendance = []; state.closures = []; $('#adminView').classList.remove('active'); $('#employeeView').classList.add('active'); $('#loginScreen').classList.toggle('hidden', !!user); $('#mainApp').classList.toggle('hidden', !user); $('#adminSidebar').hidden = !user || user.uid !== ADMIN_UID; $('#employeeLogout').hidden = !user || user.uid === ADMIN_UID; $('#appShell').classList.toggle('employee-mode', !user || user.uid !== ADMIN_UID); $('#openAdmin').hidden = !user || user.uid !== ADMIN_UID; if (!user) {
    showError('Inicia sesión para sincronizar');
    renderEmployees();
    return;
} showError('Conectado a Firebase'); if (user.uid === ADMIN_UID) {
    unsubs.push(TC.onSnapshot(TC.collection(TC.db, 'employees'), snap => { state.employees = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.active !== false); renderAdmin(); renderEmployees(); }, e => showError(errorText(e))));
    unsubs.push(TC.onSnapshot(TC.collection(TC.db, 'attendance'), snap => { state.attendance = snap.docs.map(d => d.data()); renderAdmin(); renderEmployees(); }, e => showError(errorText(e))));
    unsubs.push(TC.onSnapshot(TC.collection(TC.db, 'payrollClosures'), snap => { state.closures = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderClosures(); }, e => showError(errorText(e))));
    unsubs.push(TC.onSnapshot(TC.doc(TC.db, 'settings', 'payroll'), snap => { state.config = { ...defaults, ...(snap.data() || {}) }; renderAdmin(); }, e => showError(errorText(e))));
    openAdmin();
}
else {
    const snap = await TC.getDoc(TC.doc(TC.db, 'employees', user.uid));
    if (!snap.exists() || snap.data().active === false) {
        showError('Cuenta sin perfil activo. Contacta a la jefa.');
        await TC.signOut(TC.auth);
        return;
    }
    profile = { id: user.uid, ...snap.data() };
    unsubs.push(TC.onSnapshot(TC.doc(TC.db, 'attendance', `${user.uid}_${todayKey()}`), snap => { state.attendance = snap.exists() ? [snap.data()] : []; renderEmployees(); }, e => showError(errorText(e))));
    renderEmployees();
} }
function shift(n) { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + n); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (selectedDate > todayKey())
    selectedDate = todayKey(); renderAdmin(); }
$('#prevDay').onclick = () => shift(-1);
$('#nextDay').onclick = () => shift(1);
$('#addEmployee').onclick = addEmployee;
$('#applyConfig').onclick = async () => { const next = {}; for (const id of Object.keys(defaults)) {
    const n = Number($('#' + id).value);
    if (!Number.isFinite(n) || n < 0 || (id === 'paidDays' || id === 'normalHours') && n === 0)
        return alert('Revisa los valores de pago.');
    next[id] = n;
} try {
    await TC.setDoc(TC.doc(TC.db, 'settings', 'payroll'), next);
    showError('Configuración guardada');
}
catch (e) {
    alert(errorText(e));
} };
$('#exportPdf').onclick = () => window.print();
$('#closeFortnight').onclick = closeFortnight;
$('#back').onclick = () => { $('#adminView').classList.remove('active'); $('#employeeView').classList.add('active'); renderEmployees(); };
$('#openAdmin').onclick = openAdmin;
const adminSignOut = async () => {
    if (!confirm('¿Deseas cerrar la sesión de administración?')) return;
    const buttons = [$('#logout'), $('#adminLogout')];
    buttons.forEach(b => { if (b) b.disabled = true; });
    try { await TC.signOut(TC.auth); }
    catch (err) { alert('No se pudo cerrar sesión: ' + errorText(err)); }
    finally { buttons.forEach(b => { if (b) b.disabled = false; }); }
};
$('#logout').onclick = adminSignOut;
$('#adminLogout').onclick = adminSignOut; $('#employeeLogout').onclick = async () => { const btn = $('#employeeLogout'); btn.disabled = true; try { await TC.signOut(TC.auth); } catch (err) { alert('No se pudo cerrar sesión: ' + errorText(err)); } finally { btn.disabled = false; } };
$('#loginForm').onsubmit = async (e) => { e.preventDefault(); $('#loginError').textContent = ''; const user = $('#loginUser').value.trim(), pass = $('#loginPass').value; try {
    await TC.signInWithEmailAndPassword(TC.auth, loginEmail(user), pass);
}
catch (err) {
    $('#loginError').textContent = errorText(err);
} };
window.addEventListener('tc-ready', () => TC.onAuthStateChanged(TC.auth, u => loadSession(u).catch(e => showError(errorText(e)))));
