/* Visual navigation and data-driven chart for TimeCore. Does not write to Firebase. */
(function () {
    const $ = s => document.querySelector(s);
    const nav = [...document.querySelectorAll('.navBtn')];
    const targets = { home: '#adminView', employees: '#employeesPanel', attendance: '#activityPanel', calendar: '.dateNav', pay: '#payrollPanel', payslips: '#payslipsPanel', reports: '#payrollPanel', permissions: '#activityPanel', settings: '#configPanel' };
    nav.forEach(btn => btn.addEventListener('click', () => {
        if (document.querySelector('#adminSidebar')?.hidden)
            return;
        const id = btn.dataset.panel;
        nav.forEach(n => n.classList.toggle('active', n === btn));
        if (document.querySelector('#adminView')?.classList.contains('active')) {
            const el = $(targets[id]);
            if (el)
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        else if (id !== 'home' && typeof window.openAdmin === 'function') {
            window.openAdmin();
            setTimeout(() => $(targets[id])?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    }));
    function update() {
        try {
            if (typeof state === 'undefined' || typeof todayKey === 'undefined')
                return;
            const employees = state.employees || [], today = todayKey();
            let active = 0, paused = 0, done = 0, idle = 0;
            employees.forEach(e => { const r = record(e.id, today); if (!r?.clock_in)
                idle++;
            else if (r.clock_out)
                done++;
            else if (isOnPermission(r))
                paused++;
            else
                active++; });
            const set = (id, n) => { const el = $(id); if (el)
                el.textContent = n; };
            set('#statusWorking', active);
            set('#statusPaused', paused);
            set('#statusDone', done);
            set('#statusIdle', idle);
            set('#donutTotal', employees.length);
            const total = employees.length || 1, fractions = [active, paused, done, idle].map(n => n / total * 100);
            let start = 0;
            const colors = ['#1ad6bb', '#f0b26b', '#67a6ef', '#34475e'];
            const parts = fractions.map((pct, i) => { const s = `${colors[i]} ${start}% ${start + pct}%`; start += pct; return s; });
            $('#statusDonut').style.background = `conic-gradient(${parts.join(',')})`;
            const records = (state.attendance || []).filter(r => r.date === today && r.clock_out && r.clock_in).sort((a, b) => new Date(a.clock_out) - new Date(b.clock_out));
            const sums = [];
            let sum = 0;
            records.forEach(r => { sum += calc(r).total; sums.push({ hour: new Date(r.clock_out).getHours() + new Date(r.clock_out).getMinutes() / 60, value: sum }); });
            const max = Math.max(sum, 1);
            const pts = [{ hour: 0, value: 0 }, ...sums, { hour: 24, value: sum }].map(p => `${(p.hour / 24 * 600).toFixed(1)} ${(175 - p.value / max * 152).toFixed(1)}`);
            const path = 'M ' + pts.join(' L ');
            $('#earningsLine').setAttribute('d', path);
            $('#earningsArea').setAttribute('d', path + ' L 600 175 L 0 175 Z');
        }
        catch (e) { /* visual enhancements must never interrupt attendance */ }
    }
    setInterval(update, 3000);
    document.addEventListener('visibilitychange', update);
    setTimeout(update, 900);
})();
