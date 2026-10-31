/* CONFIGURACIÓN Y UTILIDADES GENERALES */
const $ = s => document.querySelector(s);
const ADMIN_UID = 'tFUODWGOkXeCm18fSO1bKZCm3ms2';
// Centro fijo de Bon House: comprobar coordenadas antes de usar en producción.
const WORKPLACE = Object.freeze({ latitude: 13.9871804, longitude: -89.5491599, radiusMeters: 50 });
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const defaults = { halfSalary: 204, ordinaryFortnightHours: 88, extraRate: 3 };
let markingInProgress = false;
let state = { employees: [], attendance: [], closures: [], config: { ...defaults } }, selectedDate = todayKey(), currentUser = null, profile = null, unsubs = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = t => t ? new Date(t).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtHours = value => { const mins = Math.max(0, Math.round((Number(value) || 0) * 60)); return `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')} min`; };
const prettyDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
const uname = s => s.trim().toLowerCase();
const loginEmail = s => s.includes('@') ? s.trim() : `${uname(s)}@timecore.invalid`;
const errorText = e => ({ 'auth/invalid-credential': 'Usuario o contraseña incorrectos.', 'auth/email-already-in-use': 'Este usuario ya existe.', 'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.', 'permission-denied': 'No tienes permisos. Comprueba las reglas de Firestore.', 'unavailable': 'Sin conexión. Intenta nuevamente.' }[e.code] || e.message || 'Ocurrió un error.');
function showError(message) {
    const status = $('#syncStatus');
    const text = String(message || '');
    const isLocationWarning = text.startsWith('Estás fuera del radio de ');
    if (isLocationWarning && window.TimeCoreLocationAlert) {
        status.textContent = '';
        window.TimeCoreLocationAlert.open(text);
        return;
    }
    if (window.TimeCoreLocationAlert) window.TimeCoreLocationAlert.close();
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
    if (!r?.clock_in || !r?.clock_out) return { h: 0 };
    const elapsed = Math.max(0, (new Date(r.clock_out) - new Date(r.clock_in)) / 36e5);
    return { h: Math.max(0, elapsed - permissionHours(r)) };
}
function periodPayroll(employeeId, start, end) {
    const cap = Math.max(1, Number(state.config.ordinaryFortnightHours ?? defaults.ordinaryFortnightHours));
    // Un único sueldo base quincenal para todo el personal; se ignoran valores individuales antiguos.
    const basePay = Math.max(0, Number(state.config.halfSalary ?? defaults.halfSalary));
    const ordinaryHourlyRate = basePay / cap;
    // Para el detalle diario: sueldo quincenal distribuido entre 15 días × 8 horas.
    // Así una jornada completa de 8 h muestra $13.60 cuando el sueldo quincenal es $204.
    const dailyOrdinaryHourlyRate = basePay / 120;
    const extraRate = Math.max(0, Number(state.config.extraRate ?? defaults.extraRate));
    const rows = state.attendance.filter(r => r.employeeId === employeeId && r.date >= start && r.date <= end && r.clock_in && r.clock_out)
        .sort((a, b) => a.date.localeCompare(b.date));
    let hours = 0, ordinaryHours = 0, extraHours = 0;
    const byDate = new Map();
    for (const row of rows) {
        const h = calc(row).h;
        const before = hours;
        const ordinary = Math.min(h, Math.max(0, cap - before));
        const extra = Math.max(0, h - ordinary);
        // El pago ordinario se calcula proporcionalmente a las horas ordinarias acumuladas.
        // El sueldo configurado corresponde a completar el límite ordinario de la quincena.
        const base = Number((ordinary * dailyOrdinaryHourlyRate).toFixed(2));
        const extraPay = extra * extraRate;
        hours += h; ordinaryHours += ordinary; extraHours += extra;
        byDate.set(row.date, { h, ordinary, extra, base, extraPay, total: base + extraPay });
    }
    // Solo se paga la proporción de horas ordinarias realmente laboradas.
    // Al completar el límite configurado se alcanza el sueldo base quincenal configurado.
    const base = Number((ordinaryHours * ordinaryHourlyRate).toFixed(2));
    const dailyOrdinaryPay = Number([...byDate.values()].reduce((sum, day) => sum + day.base, 0).toFixed(2));
    const baseComplement = Number(Math.max(0, base - dailyOrdinaryPay).toFixed(2));
    const overtime = Number((extraHours * extraRate).toFixed(2));
    return { hours, ordinaryHours, extraHours, base, dailyOrdinaryPay, baseComplement, overtime, total: Number((base + overtime).toFixed(2)), byDate };
}
function isOnPermission(r) { const b = r?.permissionBreaks || []; return b.length > 0 && !b[b.length - 1].end; }
// El cierre de quincena usa una clave única YYYY-MM-DD_YYYY-MM-DD.
function closureId(start, end) { return `${start}_${end}`; }
function closureFor(start, end) { return state.closures.find(item => item.id === closureId(start, end)); }
function periodTotals(start, end) {
    const people = state.employees.map(employee => {
        const rows = state.attendance.filter(r => r.employeeId === employee.id && r.date >= start && r.date <= end);
        const payroll = periodPayroll(employee.id, start, end);
        return { employeeId: employee.id, name: employee.name, dept: employee.dept || '', hours: Number(payroll.hours.toFixed(2)), ordinaryHours: Number(payroll.ordinaryHours.toFixed(2)), extraHours: Number(payroll.extraHours.toFixed(2)), base: payroll.base, overtime: payroll.overtime, total: payroll.total, days: rows.length };
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
    normal.disabled = done || paused || markingInProgress;
    normal.onclick = markAttendance;
    actions.append(normal);
    if (started && !done) {
        const permission = document.createElement('button');
        permission.type = 'button';
        permission.textContent = paused ? 'Entrada con permiso' : 'Salida con permiso';
        permission.style.marginTop = '8px';
        permission.style.background = paused ? '#117d68' : '#a65b24';
        permission.disabled = markingInProgress;
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
    if (!navigator.geolocation) throw new Error('Este dispositivo no permite obtener la ubicación.');
    if (!window.isSecureContext) throw new Error('Abre TimeCore desde su enlace HTTPS para usar la ubicación.');
    showError('Comprobando ubicación precisa de Bon House (radio 50 m)…');
    let best = null, lastError = null;
    // Primera lectura rápida (puede reutilizar una posición de hasta 3 segundos); segunda fresca solo si hace falta.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true, timeout: attempt === 0 ? 8000 : 6500, maximumAge: attempt === 0 ? 3000 : 0
            }));
            const { latitude, longitude, accuracy } = pos.coords;
            if (![latitude, longitude, accuracy].every(Number.isFinite)) continue;
            const distance = metersBetween(latitude, longitude, WORKPLACE.latitude, WORKPLACE.longitude);
            const candidate = { distance, accuracy };
            if (!best || accuracy < best.accuracy) best = candidate;
            // Se exige que incluso el margen de error quede dentro de los 50 metros.
            if (distance + accuracy <= WORKPLACE.radiusMeters) return candidate;
            if (distance - accuracy > WORKPLACE.radiusMeters) {
                throw new Error(`Estás fuera del radio de ${WORKPLACE.radiusMeters} m de Bon House (distancia estimada: ${Math.round(distance)} m).`);
            }
            showError('Afinando GPS para confirmar el límite de 50 metros…');
        } catch (e) {
            if (e.message?.startsWith('Estás fuera')) throw e;
            lastError = e;
            if (e.code === 1) throw new Error('Permite la ubicación precisa para TimeCore en los ajustes del teléfono.');
            if (attempt === 0) showError('GPS inicial impreciso; realizando una comprobación precisa…');
        }
    }
    if (best) throw new Error(`Ubicación no confirmada: GPS a ${Math.round(best.distance)} m con precisión ±${Math.round(best.accuracy)} m. No se registró la marcación. Acércate al local o activa ubicación precisa.`);
    throw new Error('No se pudo obtener tu ubicación. Activa el GPS y vuelve a intentar. ' + (lastError?.message || ''));
}
async function markAttendance() {
    if (markingInProgress) return;
    if (!currentUser || !profile || currentUser.uid === ADMIN_UID) return;
    markingInProgress = true;
    renderEmployees();
    try {
        const locationCheck = await verifyWorkplace(), date = todayKey(), ref = TC.doc(TC.db, 'attendance', `${currentUser.uid}_${date}`);
        const now = new Date().toISOString();
        let savedRecord = null;
        await TC.runTransaction(TC.db, async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists()) {
                savedRecord = { employeeId: currentUser.uid, date, clock_in: now, clock_out: null };
                tx.set(ref, { ...savedRecord, createdAt: TC.serverTimestamp() });
            } else if (!snap.data().clock_out) {
                if (isOnPermission(snap.data())) throw new Error('Primero marca Entrada con permiso para reanudar tu jornada.');
                savedRecord = { ...snap.data(), clock_out: now };
                tx.update(ref, { clock_out: now });
            } else throw new Error('El turno ya está completo.');
        });
        // La transacción solo termina cuando Firestore confirma la escritura; evitamos una segunda lectura de red.
        state.attendance = [{ ...savedRecord, createdAt: savedRecord.createdAt || null }];
        renderEmployees();
        showError(`✓ Marcación guardada · GPS confirmado a ${Math.round(locationCheck.distance)} m de Bon House`);
    } catch (e) {
        showError(errorText(e));
    } finally {
        markingInProgress = false;
        renderEmployees();
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
async function adminEditShift(e, r) {
    if (currentUser?.uid !== ADMIN_UID || !r?.clock_in) return;
    const [start, end] = fortnightRange(r.date);
    if (closureFor(start, end)) return alert('La quincena está cerrada. No se puede modificar esta marcación.');
    const toLocalInput = value => {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    const parseLocal = value => {
        const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/);
        if (!m) return null;
        const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00`);
        return Number.isFinite(d.getTime()) && d.getFullYear() === +m[1].slice(0,4) && d.getMonth()+1 === +m[1].slice(5,7) && d.getDate() === +m[1].slice(8,10) && d.getHours() === +m[2] && d.getMinutes() === +m[3] ? d : null;
    };
    const entryText = prompt(`Nueva entrada de ${e.name} (AAAA-MM-DD HH:MM):`, toLocalInput(r.clock_in));
    if (entryText === null) return;
    const entry = parseLocal(entryText);
    if (!entry) return alert('La entrada no es válida. Usa AAAA-MM-DD HH:MM.');
    const entryDateKey = `${entry.getFullYear()}-${String(entry.getMonth()+1).padStart(2,'0')}-${String(entry.getDate()).padStart(2,'0')}`;
    if (entryDateKey !== r.date) return alert(`La fecha de entrada debe seguir siendo ${r.date}. Para editar otro día, selecciona esa fecha en el calendario.`);
    const exitText = prompt(`Nueva salida de ${e.name}. Deja vacío si aún no ha salido (AAAA-MM-DD HH:MM):`, r.clock_out ? toLocalInput(r.clock_out) : '');
    if (exitText === null) return;
    const exit = exitText.trim() ? parseLocal(exitText) : null;
    if (exitText.trim() && !exit) return alert('La salida no es válida. Usa AAAA-MM-DD HH:MM o déjala vacía.');
    if (exit && exit <= entry) return alert('La salida debe ser posterior a la entrada.');
    if (entry > new Date() || (exit && exit > new Date())) return alert('No se pueden registrar horas futuras.');
    const reason = prompt('Motivo de la corrección (obligatorio):', 'Corrección de horario autorizada');
    if (reason === null) return;
    if (reason.trim().length < 5) return alert('Escribe un motivo de al menos 5 caracteres.');
    if (!confirm(`¿Guardar estos horarios para ${e.name}?\nEntrada: ${entry.toLocaleString('es-SV')}\nSalida: ${exit ? exit.toLocaleString('es-SV') : 'Pendiente'}\n\nLa corrección quedará en el historial.`)) return;
    try {
        const ref = TC.doc(TC.db, 'attendance', `${e.id}_${r.date}`);
        await TC.runTransaction(TC.db, async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists() || snap.data().employeeId !== e.id) throw new Error('La marcación cambió o no existe. Actualiza el panel.');
            const row = snap.data(), history = Array.isArray(row.correctionHistory) ? row.correctionHistory : [];
            tx.update(ref, {
                clock_in: entry.toISOString(), clock_out: exit ? exit.toISOString() : null,
                correctionHistory: [...history, { previousEntry: row.clock_in, previousExit: row.clock_out || null, newEntry: entry.toISOString(), newExit: exit ? exit.toISOString() : null, reason: reason.trim().slice(0,250), by: currentUser.uid, at: new Date().toISOString() }],
                lastCorrectionBy: currentUser.uid, lastCorrectionAt: TC.serverTimestamp()
            });
        });
        showError('✓ Entrada y salida corregidas. El historial quedó guardado y la planilla se recalculó.');
    } catch (err) { alert('No se pudieron corregir las horas: ' + errorText(err)); }
}
async function adminRestoreShift(e, r) {
    if (currentUser?.uid !== ADMIN_UID || !r?.clock_in || !r?.clock_out) return;
    const [start, end] = fortnightRange(r.date);
    if (closureFor(start, end)) return alert('La quincena está cerrada. No se puede modificar esta marcación.');
    const reason = prompt(`Motivo para restablecer la jornada de ${e.name} del ${r.date}:`, 'Salida marcada por accidente');
    if (reason === null) return;
    if (reason.trim().length < 5) return alert('Escribe un motivo de al menos 5 caracteres.');
    if (!confirm(`¿Restablecer la jornada de ${e.name}?\nEntrada original: ${fmt(r.clock_in)}\nSalida accidental: ${fmt(r.clock_out)}\n\nSe conservará la hora de entrada y el historial de la corrección.`)) return;
    try {
        const ref = TC.doc(TC.db, 'attendance', `${e.id}_${r.date}`);
        await TC.runTransaction(TC.db, async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists() || !snap.data().clock_out || snap.data().employeeId !== e.id)
                throw new Error('La marcación cambió o no existe. Actualiza la página.');
            const row = snap.data();
            const history = Array.isArray(row.correctionHistory) ? row.correctionHistory : [];
            if (history.length >= 500) throw new Error('El historial de esta jornada alcanzó el límite técnico.');
            tx.update(ref, {
                clock_out: null,
                correctionHistory: [...history, { previousExit: row.clock_out, originalEntry: row.clock_in, reason: reason.trim().slice(0, 250), by: currentUser.uid, at: new Date().toISOString() }],
                lastCorrectionBy: currentUser.uid,
                lastCorrectionAt: TC.serverTimestamp()
            });
        });
        showError('✓ Jornada restablecida; entrada original conservada. El empleado ya puede marcar su salida real.');
    } catch (err) { alert('No se pudo restablecer la jornada: ' + errorText(err)); }
}
/* PANEL ADMINISTRATIVO: métricas y registros del personal. */
function renderAdmin() {
    if (currentUser?.uid !== ADMIN_UID) return;
    renderPayslipOptions();
    const c = state.config;
    for (const id of Object.keys(defaults)) { const input = $('#' + id); if (input) input.value = c[id]; }
    $('#selectedDateLabel').textContent = prettyDate(selectedDate);
    $('#todayBadge').textContent = selectedDate === todayKey() ? 'HOY' : '';
    $('#nextDay').disabled = selectedDate >= todayKey();
    let present = 0, extra = 0, money = 0;
    const body = $('#payrollBody'); body.innerHTML = '';
    const [periodStart, periodEnd] = fortnightRange(selectedDate);
    state.employees.forEach(e => {
        const r = record(e.id, selectedDate), payroll = periodPayroll(e.id, periodStart, periodEnd);
        const p = r ? (payroll.byDate.get(r.date) || { h: 0, extra: 0, base: 0, extraPay: 0, total: 0 }) : { h: 0, extra: 0, base: 0, extraPay: 0, total: 0 };
        const perm = permissionHours(r, r?.clock_out || new Date().toISOString());
        if (selectedDate === todayKey() && r?.clock_in && !r.clock_out) present++;
        extra += p.extra; money += p.total;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><div class="namePdfCell"><div><b>${esc(e.name)}</b><br><small>${esc(e.dept || '—')}</small></div><button class="miniPdf">PDF quincenal</button></div></td><td>${fmt(r?.clock_in)}${r?.clock_in ? '<br><button class="editShift" type="button">Editar horas</button>' : ''}</td><td>${fmt(r?.clock_out)}${r?.exitSource === 'admin' ? '<br><small>Salida por jefa</small>' : ''}${isOnPermission(r) ? '<br><small>Fuera con permiso</small>' : ''}${r?.clock_in && !r?.clock_out ? '<br><button class="manualExit">Registrar salida</button>' : ''}${r?.correctionHistory?.length ? '<br><small>Correcciones: ' + r.correctionHistory.length + '</small>' : ''}</td><td>${fmtHours(p.h)}${perm > 0 ? `<br><small>Permiso no pagado: ${perm.toFixed(2)} h</small>` : ''}</td><td>${fmtHours(p.extra)}</td><td>$${p.base.toFixed(2)}</td><td>$${p.extraPay.toFixed(2)}</td><td><b>$${p.total.toFixed(2)}</b></td>`;
        tr.querySelector('.miniPdf').onclick = () => exportFortnight(e);
        const editBtn = tr.querySelector('.editShift'); if (editBtn) editBtn.onclick = () => adminEditShift(e, r);
        const exitBtn = tr.querySelector('.manualExit'); if (exitBtn) exitBtn.onclick = () => adminCloseShift(e, r);
        body.append(tr);
    });
    $('#presentCount').textContent = present;
    $('#extraToday').textContent = extra.toFixed(2) + ' h';
    $('#moneyToday').textContent = $('#dailyGrandTotal').textContent = '$' + money.toFixed(2);
    $('#formulaInfo').textContent = `Sueldo base general: $${Number(c.halfSalary ?? defaults.halfSalary).toFixed(2)} por quincena. Límite: ${Number(c.ordinaryFortnightHours ?? defaults.ordinaryFortnightHours)} h ordinarias · Hora extra: $${Number(c.extraRate ?? defaults.extraRate).toFixed(2)}.`;
    $('#activity').innerHTML = state.employees.map(e => { const r = record(e.id, selectedDate); return r?.clock_in ? `<div>${esc(e.name)} · Entrada ${fmt(r.clock_in)} · Salida ${fmt(r.clock_out)}</div>` : ''; }).join('') || '<p>No hay marcaciones en esta fecha.</p>';
    const list = $('#adminEmployees'); list.innerHTML = '';
    if (!state.employees.length) {
        list.innerHTML = '<p class="emptyEmployees">Todavía no hay empleados activos registrados.</p>';
    }
    state.employees.forEach(e => {
        const div = document.createElement('div');
        div.className = 'adminEmp';
        div.innerHTML = `<div class="adminEmpInfo"><b>${esc(e.name)}</b><small>${esc(e.dept || 'Sin departamento')} · @${esc(e.username || '')}</small></div><div class="employee-actions"><button type="button" class="editEmployee" aria-label="Editar datos de ${esc(e.name)}">✎ Editar datos</button><button type="button" class="deactivate">Desactivar</button></div>`;
        // Edición directa y sencilla: evita formularios plegables que pueden
        // quedar ocultos por estilos/caché en algunos dispositivos.
        div.querySelector('.editEmployee').addEventListener('click', async () => {
            if (currentUser?.uid !== ADMIN_UID) return alert('Solo la administradora puede editar empleados.');
            const name = prompt('Nombre completo del empleado:', e.name || '');
            if (name === null) return;
            const dept = prompt('Departamento / sucursal:', e.dept || '');
            if (dept === null) return;
            if (!name.trim() || !dept.trim()) return alert('El nombre y el departamento/sucursal no pueden quedar vacíos.');
            const button = div.querySelector('.editEmployee');
            button.disabled = true;
            try {
                await TC.setDoc(TC.doc(TC.db, 'employees', e.id), { name: name.trim().slice(0, 100), dept: dept.trim().slice(0, 80) }, { merge: true });
                showError('Datos actualizados correctamente. Usuario, contraseña, marcaciones e historial de pagos permanecen intactos.');
            } catch (err) {
                const message = errorText(err);
                alert('No se pudieron guardar los cambios. ' + message + (err?.code === 'permission-denied' ? '\n\nPublica las reglas firestore.rules incluidas en esta versión en Firebase Console > Firestore Database > Rules.' : ''));
            } finally {
                button.disabled = false;
            }
        });
        div.querySelector('.deactivate').onclick = async () => {
            if (!confirm('¿Desactivar a este empleado? Su historial permanecerá guardado.')) return;
            try { await TC.setDoc(TC.doc(TC.db, 'employees', e.id), { active: false }, { merge: true }); showError('Empleado desactivado'); }
            catch (err) { alert(errorText(err)); }
        };
        list.append(div);
    });
    const allPayroll = state.employees.reduce((sum, e) => sum + periodPayroll(e.id, periodStart, periodEnd).total, 0);
    $('#fortnight').textContent = '$' + allPayroll.toFixed(2);
    renderClosures();
}
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
    const payroll = periodPayroll(employee.id, start, end);
    let ordinary = payroll.base, overtime = payroll.overtime, permission = 0, total = payroll.total, worked = payroll.hours;
    const rows = records.map(row => {
        const payment = payroll.byDate.get(row.date) || { h: 0, extra: 0, total: 0 };
        const unpaidHours = permissionHours(row, row.clock_out || new Date().toISOString());
        permission += unpaidHours;
        const dailyOrdinaryHours = Number(payment.ordinary || 0);
        const dailyExtraHours = Number(payment.extra || 0);
        const dailyOrdinaryPay = Number(payment.base || 0);
        const dailyExtraPay = Number(payment.extraPay || 0);
        return `<tr>
      <td>${esc(row.date)}</td>
      <td>${esc(fmt(row.clock_in))}</td>
      <td>${esc(fmt(row.clock_out))}</td>
      <td class="num">${fmtHours(payment.h)}</td>
      <td class="num">${fmtHours(dailyOrdinaryHours)}</td>
      <td class="num">${fmtHours(dailyExtraHours)}</td>
      <td class="num">${unpaidHours.toFixed(2)} h</td>
      <td class="num">$${dailyOrdinaryPay.toFixed(2)}</td>
      <td class="num">$${dailyExtraPay.toFixed(2)}</td>
      <td class="num"><strong>$${Number(payment.total || 0).toFixed(2)}</strong></td>
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
  table { width: 100%; border-collapse: collapse; font-size: 8px; }
  th { background: #193e70; color: white; text-align: left; padding: 7px 3px; }
  td { padding: 7px 3px; border-bottom: 1px solid #dbe3ef; }
  .daily-rule { margin: 0 0 10px; padding: 8px 10px; background: #f2f5fa; border-left: 3px solid #193e70; }
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
<section class="sectionHeading">RESUMEN DE PAGO Y HORAS EXTRAS</section>
<table class="moneyTable">
  <thead><tr><th>CONCEPTO</th><th class="num">IMPORTE (USD)</th></tr></thead>
  <tbody>
    <tr><td>HORAS EXTRAS TOTALES (solo después de superar el límite ordinario)</td><td><strong>${fmtHours(payroll.extraHours)}</strong></td></tr>
    <tr><td>Pago diario de horas ordinarias (a $${(Number(state.config.halfSalary ?? defaults.halfSalary) / 120).toFixed(2)}/h)</td><td>$${payroll.dailyOrdinaryPay.toFixed(2)}</td></tr>
    <tr><td>Complemento hasta sueldo base proporcional de la quincena</td><td>$${payroll.baseComplement.toFixed(2)}</td></tr>
    <tr><td>Pago de horas extras (${fmtHours(payroll.extraHours)} × $${Number(state.config.extraRate ?? defaults.extraRate).toFixed(2)}/h)</td><td>$${overtime.toFixed(2)}</td></tr>
    <tr><td>Descuentos y ajustes</td><td>No configurados</td></tr>
  </tbody>
</table>
<section class="summary"><div class="total"><span>TOTAL ESTIMADO A PAGAR</span><span>$${total.toFixed(2)}</span></div></section>
` : `
<h2>Detalle diario de horas y pago</h2>
<p class="notice daily-rule">Cálculo quincenal: las primeras ${Number(state.config.ordinaryFortnightHours ?? defaults.ordinaryFortnightHours)} horas acumuladas se pagan como ordinarias; solo el excedente se paga como extra. El total diario de horas ordinarias se calcula a $${(Number(state.config.halfSalary ?? defaults.halfSalary) / 120).toFixed(2)} por hora (con sueldo de $204, una jornada de 8 horas equivale a $13.60). El complemento de sueldo quincenal se muestra por separado en el resumen.</p>
<table>
<thead><tr><th>Fecha</th><th>Entrada</th><th>Salida</th><th class="num">Horas del día</th><th class="num">Ord.</th><th class="num">Extras</th><th class="num">Permiso</th><th class="num">Pago ord.</th><th class="num">Pago extra</th><th class="num">Total día</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10">Sin registros en este período.</td></tr>'}</tbody>
</table>
<section class="summary">
  <div><span>Horas trabajadas</span><strong>${fmtHours(worked)}</strong></div>
  <div><span>Permisos sin goce</span><strong>${permission.toFixed(2)} h</strong></div>
  <div><span>Horas ordinarias (límite quincenal)</span><strong>${fmtHours(payroll.ordinaryHours)}</strong></div>
  <div><span>Horas extras (después del límite)</span><strong>${fmtHours(payroll.extraHours)}</strong></div>
  <div><span>Pago de horas ordinarias laboradas (a $${(Number(state.config.halfSalary ?? defaults.halfSalary) / 120).toFixed(2)}/h)</span><strong>$${payroll.dailyOrdinaryPay.toFixed(2)}</strong></div>
  <div><span>Complemento hasta sueldo base proporcional</span><strong>$${payroll.baseComplement.toFixed(2)}</strong></div>
  <div><span>Pago de horas extra ($${Number(state.config.extraRate ?? defaults.extraRate).toFixed(2)} por hora)</span><strong>$${overtime.toFixed(2)}</strong></div>
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
async function loadSession(user) { clearListeners(); currentUser = user; profile = null; state.employees = []; state.attendance = []; state.closures = []; $('#adminView').classList.remove('active'); $('#employeeView').classList.add('active'); $('#loginScreen').classList.toggle('hidden', !!user); $('#mainApp').classList.toggle('hidden', !user); $('#refreshTimeCore').hidden = !user; $('#adminSidebar').hidden = !user || user.uid !== ADMIN_UID; $('#employeeLogout').hidden = !user || user.uid === ADMIN_UID; $('#appShell').classList.toggle('employee-mode', !user || user.uid !== ADMIN_UID); $('#openAdmin').hidden = !user || user.uid !== ADMIN_UID; if (!user) {
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
let refreshingData = false;
async function refreshTimeCore() {
    if (!window.TC || !currentUser || refreshingData || markingInProgress) return;
    const button = $('#refreshTimeCore');
    refreshingData = true;
    button.disabled = true;
    button.textContent = '↻ Actualizando…';
    try {
        if (currentUser.uid === ADMIN_UID) {
            const [employees, attendance, closures, settings] = await Promise.all([
                TC.getDocsFromServer(TC.collection(TC.db, 'employees')),
                TC.getDocsFromServer(TC.collection(TC.db, 'attendance')),
                TC.getDocsFromServer(TC.collection(TC.db, 'payrollClosures')),
                TC.getDocFromServer(TC.doc(TC.db, 'settings', 'payroll'))
            ]);
            state.employees = employees.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => e.active !== false);
            state.attendance = attendance.docs.map(d => d.data());
            state.closures = closures.docs.map(d => ({ id: d.id, ...d.data() }));
            state.config = { ...defaults, ...(settings.data() || {}) };
            renderAdmin(); renderEmployees(); renderClosures();
        } else {
            const [employee, attendance] = await Promise.all([
                TC.getDocFromServer(TC.doc(TC.db, 'employees', currentUser.uid)),
                TC.getDocFromServer(TC.doc(TC.db, 'attendance', `${currentUser.uid}_${todayKey()}`))
            ]);
            if (!employee.exists() || employee.data().active === false) throw new Error('La cuenta del empleado no está activa.');
            profile = { id: currentUser.uid, ...employee.data() };
            state.attendance = attendance.exists() ? [attendance.data()] : [];
            renderEmployees();
        }
        showError('✓ Información actualizada desde Firebase.');
    } catch (e) {
        showError('No se pudo actualizar desde Firebase: ' + errorText(e));
    } finally {
        refreshingData = false;
        button.disabled = false;
        button.textContent = '↻ Actualizar';
    }
}
$('#refreshTimeCore').onclick = refreshTimeCore;
function shift(n) { const d = new Date(selectedDate + 'T12:00:00'); d.setDate(d.getDate() + n); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; if (selectedDate > todayKey())
    selectedDate = todayKey(); renderAdmin(); }
$('#prevDay').onclick = () => shift(-1);
$('#nextDay').onclick = () => shift(1);

async function addEmployee() {
  if (currentUser?.uid !== ADMIN_UID) return alert('Solo la administradora puede agregar empleados.');
  const name=$('#newName').value.trim(), dept=$('#newDept').value.trim(), username=$('#newUsername').value.trim(), password=$('#newPin').value;
  if (!name || !dept || !username || password.length<6) return alert('Completa nombre, departamento y usuario. La contraseña necesita al menos 6 caracteres.');
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return alert('El usuario solo admite letras, números, puntos, guiones y guion bajo.');
  const button=$('#addEmployee'); button.disabled=true;
  let secondaryApp=null, secondaryAuth=null, created=null;
  try {
    secondaryApp=TC.initializeApp(window.TIMECORE_FIREBASE_CONFIG,'timecore-create-employee');
    secondaryAuth=TC.getAuth(secondaryApp);
    created=await TC.createUserWithEmailAndPassword(secondaryAuth,loginEmail(username),password);
    await TC.setDoc(TC.doc(TC.db,'employees',created.user.uid),{name,dept,username,active:true,createdAt:TC.serverTimestamp()});
    for(const id of ['newName','newDept','newUsername','newPin']) $('#'+id).value='';
    showError('✓ Empleado agregado correctamente.');
  } catch(err) {
    alert('No se pudo agregar el empleado: '+errorText(err)+(created?'\nSe creó la cuenta de acceso, pero no el perfil. No vuelvas a crearla sin revisar Firebase.':''));
  } finally {
    if(secondaryAuth) try {await TC.signOut(secondaryAuth)}catch(_){}
    if(secondaryApp) try {await TC.deleteApp(secondaryApp)}catch(_){}
    button.disabled=false;
  }
}

$('#addEmployee').onclick = addEmployee;
$('#applyConfig').onclick = async () => { const next = {}; for (const id of Object.keys(defaults)) {
    const raw = $('#' + id).value; const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || id === 'ordinaryFortnightHours' && n === 0)
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
    if (!window.TC) throw new Error('Firebase todavía no está listo. Espera unos segundos y vuelve a intentar.');
    await TC.signInWithEmailAndPassword(TC.auth, loginEmail(user), pass);
}
catch (err) {
    $('#loginError').textContent = errorText(err);
} };
// Iniciar una sola vez, incluso si Firebase terminó de cargar antes que este archivo.
let authListenerStarted = false;
function startTimeCoreAuth() {
    if (authListenerStarted || !window.TC) return;
    authListenerStarted = true;
    TC.onAuthStateChanged(TC.auth, u => loadSession(u).catch(e => showError(errorText(e))));
}
window.addEventListener('tc-ready', startTimeCoreAuth);
window.addEventListener('tc-load-error', () => {
    const el = $('#loginError');
    if (el) el.textContent = 'No se pudo cargar Firebase. Comprueba tu conexión y recarga la página.';
});
startTimeCoreAuth();
