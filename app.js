const GAS_URL = 'https://script.google.com/macros/s/AKfycbzFBx-WmI3BDm3GwqR6O0AF3a9lj-9LjmXp1ZTk-yL97znfSniJ1_kixxVuDl0Hjar0/exec';

const app = {
    user: JSON.parse(localStorage.getItem('fuelUser')) || null,
    loginTargetRole: '',
    rawDb: { drivers: [], fuelRatesList: [], history: [], mileages: [], masterCompanies: [], receipts: [] },
    filteredDailyMileages: [],
    filteredMonthlyMileages: [],
    filteredAdminReceipts: [],
    charts: {},

    init: () => {
        app.bindEvents();
        app.checkSession();
    },

    bindEvents: () => {
        document.getElementById('loginForm')?.addEventListener('submit', app.handleLogin);
        document.getElementById('mileageForm')?.addEventListener('submit', app.handleMileageSubmit);
        document.getElementById('receiptForm')?.addEventListener('submit', app.handleReceiptSubmit);
        document.getElementById('frmDriver')?.addEventListener('submit', app.handleDriverFormSubmit);
        document.getElementById('frmFuelRate')?.addEventListener('submit', app.handleFuelRateSubmit);
        document.getElementById('frmDriverPassword')?.addEventListener('submit', app.handleDriverPasswordSubmit); 
        
        const startEl = document.getElementById('inputStartDist');
        const endEl = document.getElementById('inputEndDist');
        const distEl = document.getElementById('inputDistance');
        const calcDist = () => {
            const s = Number(startEl.value) || 0;
            const e = Number(endEl.value) || 0;
            if(s > 0 && e > s) distEl.value = e - s;
            else distEl.value = '';
        };
        startEl?.addEventListener('input', calcDist);
        endEl?.addEventListener('input', calcDist);

        document.getElementById('driverMonthFilter')?.addEventListener('change', app.renderDriverRecords);
        document.getElementById('driverReceiptMonthFilter')?.addEventListener('change', app.renderDriverReceipts);
        document.getElementById('adminCompanyFilter')?.addEventListener('change', app.refreshAdminViews);

        const tabElList = [].slice.call(document.querySelectorAll('#adminTabs button'));
        tabElList.forEach(tabEl => {
            tabEl.addEventListener('shown.bs.tab', (e) => {
                if (e.target.id === 'tab-dash') app.renderCharts();
                if (e.target.id === 'tab-unsubmitted') {
                    document.getElementById('unsubmittedDateFilter').value = new Date().toLocaleDateString('sv-SE');
                    app.renderUnsubmittedTable();
                }
                if (e.target.id === 'tab-receipts') app.applyReceiptSearch();
                if (e.target.id === 'tab-fuelrate') app.renderFuelRateTable();
            });
        });
    },

    checkSession: () => {
        if (app.user) app.route(app.user.role);
        else app.route('login');
    },

    showLoginForm: (role) => {
        app.loginTargetRole = role;
        document.getElementById('roleSelection').classList.add('d-none');
        document.getElementById('loginForm').classList.remove('d-none');
        document.getElementById('loginTitle').innerText = (role === 'driver') ? '기사님 로그인' : '관리자 로그인';
    },

    hideLoginForm: () => {
        document.getElementById('loginForm').classList.add('d-none');
        document.getElementById('roleSelection').classList.remove('d-none');
    },

    route: (target) => {
        document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('d-none'); });
        if (target === 'login') {
            document.getElementById('view-login').classList.remove('d-none');
            document.getElementById('view-login').classList.add('active');
        } else if (target === 'driver') {
            document.getElementById('view-driver').classList.remove('d-none');
            document.getElementById('view-driver').classList.add('active');
            app.initDriverView();
        } else if (target === 'admin' || target === 'manager') {
            document.getElementById('view-admin').classList.remove('d-none');
            document.getElementById('view-admin').classList.add('active');
            app.applyRoleRestrictions(target);
            app.loadAdminDashboardData();
        }
    },

    formatDateStr: (dateVal) => {
        if (!dateVal) return '';
        if (typeof dateVal === 'string') {
            if (dateVal.includes('T')) return dateVal.split('T')[0];
            return dateVal.substring(0, 10);
        }
        return String(dateVal).substring(0, 10);
    },

    showLoading: (show) => {
        const loader = document.getElementById('loading');
        if (loader) show ? loader.classList.remove('d-none') : loader.classList.add('d-none');
    },

    escapeXSS: (str) => {
        if (!str) return '';
        return String(str).replace(/[&<>"']/g, (m) => { const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }; return map[m]; });
    },

    hashPassword: async (pw) => {
        const data = new TextEncoder().encode(pw);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    fetchAPI: async (payload) => {
        try {
            const response = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            return result.data;
        } catch (error) { alert("연결 오류: " + error.message); return null; }
    },

    handleLogin: async (e) => {
        e.preventDefault();
        app.showLoading(true);
        const phone = document.getElementById('loginPhone').value.trim();
        const pw = document.getElementById('loginPw').value.trim();
        const hashedPassword = await app.hashPassword(pw);
        const data = await app.fetchAPI({ action: 'login', phone, password_hash: hashedPassword });
        app.showLoading(false);

        if (data) {
            localStorage.setItem('fuelUser', JSON.stringify(data));
            app.user = data;
            app.route(data.role);
        }
    },

    logout: () => { localStorage.removeItem('fuelUser'); app.user = null; app.route('login'); },

    openDriverPasswordModal: () => {
        document.getElementById('dNewPw').value = '';
        document.getElementById('dNewPwConfirm').value = '';
        new bootstrap.Modal(document.getElementById('mdlDriverPassword')).show();
    },

    handleDriverPasswordSubmit: async (e) => {
        e.preventDefault();
        const newPw = document.getElementById('dNewPw').value.trim();
        const newPwConfirm = document.getElementById('dNewPwConfirm').value.trim();

        if (newPw !== newPwConfirm) return alert('비밀번호 확인이 일치하지 않습니다.');
        if (newPw === '0000') return alert('초기 암호인 0000은 재사용할 수 없습니다.');

        app.showLoading(true);
        const hashedPassword = await app.hashPassword(newPw);
        const data = await app.fetchAPI({ action: 'changePassword', phone: app.user.phone, new_password_hash: hashedPassword });
        app.showLoading(false);

        if (data) {
            alert('비밀번호가 정상적으로 변경되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('mdlDriverPassword')).hide();
        }
    },

    initDriverView: () => {
        app.cancelDriverEdit(); 
        document.getElementById('driverGreeting').innerHTML = `이름: <b class="text-primary">${app.escapeXSS(app.user.name)}</b> 기사님`;
        document.getElementById('driverCarBadge').innerText = app.escapeXSS(app.user.car_number);

        const compSelect1 = document.getElementById('inputCompany');
        const compSelect2 = document.getElementById('rInputCompany');
        compSelect1.innerHTML = ''; compSelect2.innerHTML = '';
        
        const activeComps = app.user.activeCompanies || [];
        const myCompanies = (app.user.company || "").split(',').map(c => c.trim()).filter(c => c && activeComps.includes(c));
        
        myCompanies.forEach(c => {
            compSelect1.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
            compSelect2.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
        });

        const currentMonthStr = new Date().toISOString().substring(0, 7);
        document.getElementById('driverMonthFilter').value = currentMonthStr;
        document.getElementById('driverReceiptMonthFilter').value = currentMonthStr;
        
        app.renderDriverRecords();
        app.renderDriverReceipts();
    },

    renderDriverRecords: () => {
        const selectedMonth = document.getElementById('driverMonthFilter').value;
        const records = app.user.driverRecords?.mileages || [];
        let totalDistance = 0; let totalCost = 0; let validRecords = [];

        records.forEach(r => {
            if (app.formatDateStr(r.date).substring(0, 7) === selectedMonth) {
                validRecords.push(r);
                totalDistance += Number(r.distance) || 0;
                totalCost += Number(r.fuel_cost) || 0;
            }
        });

        const tbody = document.getElementById('tblDriverMonthBody');
        tbody.innerHTML = '';
        if(validRecords.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted small py-3">해당 월 기록이 없습니다.</td></tr>'; } 
        else {
            validRecords.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(r => {
                let evidenceBtn = `<span class="text-muted small">없음</span>`;
                if (r.evidence_url) {
                    evidenceBtn = r.evidence_url.split(',').map((url, idx) => `<a href="${url.trim()}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0 me-1">사진${idx+1}</a>`).join('');
                }
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="small">${app.formatDateStr(r.date).substring(5, 10)}</td>
                    <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                    <td class="small text-secondary">${r.start_distance} → ${r.end_distance}</td>
                    <td class="fw-bold text-dark">${Number(r.distance).toLocaleString()} km</td>
                    <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                    <td class="text-center">${evidenceBtn}</td>
                    <td class="text-center"><button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyRecord('${app.formatDateStr(r.date)}', '${app.escapeXSS(r.company)}')">삭제</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
        document.getElementById('dStatDistance').innerText = `${totalDistance.toLocaleString()} km`;
        document.getElementById('dStatCost').innerText = `${totalCost.toLocaleString()} 원`;
        document.getElementById('dStatDays').innerText = `${validRecords.length}건`;
    },

    renderDriverReceipts: () => {
        const selectedMonth = document.getElementById('driverReceiptMonthFilter').value;
        const receipts = app.user.driverRecords?.receipts || [];
        const tbody = document.getElementById('tblDriverReceiptBody');
        tbody.innerHTML = '';
        
        let validReceipts = receipts.filter(r => app.formatDateStr(r.date).substring(0, 7) === selectedMonth);
        if(validReceipts.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted small py-3">해당 월 영수증 내역이 없습니다.</td></tr>'; return; }
        
        validReceipts.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(r => {
            const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0">영수증 보기</a>` : `-`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small">${app.formatDateStr(r.date)}</td>
                <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                <td class="fw-bold text-primary">${Number(r.amount).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyReceipt('${app.formatDateStr(r.date)}', '${app.escapeXSS(r.company)}', ${r.amount})">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteMyRecord: async (dateStr, company) => {
        if(!confirm(`[${dateStr}] 운행 기록을 완전히 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteDailyMileage', date: dateStr, phone: app.user.phone, company: company });
        if(res) {
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverRecords(); 
        }
        app.showLoading(false);
    },

    deleteMyReceipt: async (dateStr, company, amount) => {
        if(!confirm(`해당 주유 영수증을 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteReceipt', date: dateStr, phone: app.user.phone, company: company, amount: amount });
        if(res) {
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverReceipts(); 
        }
        app.showLoading(false);
    },

    cancelDriverEdit: () => {
        document.getElementById('inputDate').value = new Date().toLocaleDateString('sv-SE');
        document.getElementById('inputStartDist').value = '';
        document.getElementById('inputEndDist').value = '';
        document.getElementById('inputDistance').value = '';
        document.getElementById('inputEvidence').value = '';
    },

    handleMileageSubmit: async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnSubmitMileage');
        const date = document.getElementById('inputDate').value;
        const startDist = parseInt(document.getElementById('inputStartDist').value, 10);
        const endDist = parseInt(document.getElementById('inputEndDist').value, 10);
        const distance = parseInt(document.getElementById('inputDistance').value, 10);
        const company = document.getElementById('inputCompany').value;
        const fileInput = document.getElementById('inputEvidence');

        if (isNaN(distance) || distance <= 0) return alert('도착 계기판 숫자가 출발보다 작거나 같습니다.');

        submitBtn.disabled = true; submitBtn.innerHTML = '처리중...';
        app.showLoading(true);

        const payload = {
            action: 'saveMileage', date, distance, phone: app.user.phone,
            name: app.user.name, car_number: app.user.car_number,
            company: company, start_distance: startDist, end_distance: endDist,
            isUpdate: false, files: [] 
        };

        if (fileInput.files.length > 0) {
            for (let i = 0; i < fileInput.files.length; i++) {
                payload.files.push({ fileBase64: await app.compressImage(fileInput.files[i]), mimeType: "image/jpeg" });
            }
        }

        let res = await app.fetchAPI(payload);
        if (res === null) {
            if (confirm('해당 날짜에 이미 기록이 존재합니다. 덮어쓰시겠습니까?')) {
                payload.isUpdate = true; res = await app.fetchAPI(payload);
            }
        }

        if (res) {
            alert('기록 저장이 완료되었습니다.');
            app.cancelDriverEdit(); 
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverRecords(); 
        }
        app.showLoading(false); submitBtn.disabled = false; submitBtn.innerHTML = '등록하기';
    },

    handleReceiptSubmit: async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnSubmitReceipt');
        const date = document.getElementById('rInputDate').value;
        const company = document.getElementById('rInputCompany').value;
        const amount = parseInt(document.getElementById('rInputAmount').value, 10);
        const fileInput = document.getElementById('rInputEvidence');

        if (isNaN(amount) || amount <= 0) return alert('금액을 바르게 입력하세요.');

        submitBtn.disabled = true; app.showLoading(true);
        const payload = {
            action: 'saveReceipt', date, amount, phone: app.user.phone,
            name: app.user.name, car_number: app.user.car_number, company: company,
            fileBase64: await app.compressImage(fileInput.files[0])
        };

        const res = await app.fetchAPI(payload);
        if (res) {
            alert('주유 영수증이 등록되었습니다.');
            document.getElementById('rInputAmount').value = '';
            document.getElementById('rInputEvidence').value = '';
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverReceipts(); 
        }
        app.showLoading(false); submitBtn.disabled = false;
    },

    loadAdminDashboardData: async () => {
        app.showLoading(true);
        const data = await app.fetchAPI({ action: 'getAdminData', role: app.user.role, company: app.user.company });
        app.showLoading(false);
        if (data) {
            app.rawDb = data; 
            app.populateAdminCompanyFilter(); 
            app.refreshAdminViews();
            document.getElementById('searchDailyMonth').value = new Date().toISOString().substring(0, 7);
            document.getElementById('searchReceiptMonth').value = new Date().toISOString().substring(0, 7);
            app.applyDailySearch(); 
            app.applyReceiptSearch();
        }
    },

    populateAdminCompanyFilter: () => {
        const selectEl = document.getElementById('adminCompanyFilter');
        const searchComp1 = document.getElementById('searchMonthlyCompany');
        const searchComp2 = document.getElementById('searchReceiptCompany');
        const companies = new Set((app.rawDb.masterCompanies || []).map(c => c.name));
        
        if (app.user.role === 'admin') {
            let opts = '<option value="ALL">전체 화주사 통합 조회</option>';
            Array.from(companies).filter(c=>c).sort().forEach(c => opts += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`);
            if(selectEl) selectEl.innerHTML = opts; 
            if(searchComp1) searchComp1.innerHTML = opts; 
            if(searchComp2) searchComp2.innerHTML = opts;
            app.currentAdminCompanyFilter = selectEl?.value || 'ALL';
        } else {
            if(selectEl) selectEl.classList.add('d-none');
            app.currentAdminCompanyFilter = app.user.company; 
            if(searchComp1) { searchComp1.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`; searchComp1.setAttribute('disabled', 'true'); }
            if(searchComp2) { searchComp2.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`; searchComp2.setAttribute('disabled', 'true'); }
        }
    },

    refreshAdminViews: () => {
        if(app.user.role === 'admin') {
            const filterEl = document.getElementById('adminCompanyFilter');
            if(filterEl) app.currentAdminCompanyFilter = filterEl.value || 'ALL';
        }
        app.calculateSummaryStats(); 
        app.renderDriversTable(); 
        app.applyDailySearch(); 
        app.applyReceiptSearch();
    },

    matchCompany: (itemCompany) => {
        if (app.currentAdminCompanyFilter === 'ALL') return true;
        return String(itemCompany).includes(app.currentAdminCompanyFilter);
    },

    calculateSummaryStats: () => {
        const todayStr = new Date().toLocaleDateString('sv-SE');
        const monthStr = todayStr.substring(0, 7);
        const validMileages = app.rawDb.mileages || [];

        const tRec = validMileages.filter(r => app.formatDateStr(r.date) === todayStr);
        const mRec = validMileages.filter(r => app.formatDateStr(r.date).startsWith(monthStr));

        const todayDrivers = new Set(tRec.map(r=>r.phone)).size;
        const todayDist = tRec.reduce((s,r)=>s+Number(r.distance),0);
        const todayCost = tRec.reduce((s,r)=>s+Number(r.fuel_cost),0);

        const monthDrivers = new Set(mRec.map(r=>r.phone)).size;
        const monthDist = mRec.reduce((s,r)=>s+Number(r.distance),0);
        const monthCost = mRec.reduce((s,r)=>s+Number(r.fuel_cost),0);
        const totalDrivers = (app.rawDb.drivers || []).filter(d => d.role === 'driver').length;

        if (document.getElementById('vTodayDrivers')) document.getElementById('vTodayDrivers').innerText = `${todayDrivers}명`;
        if (document.getElementById('vTodayDist')) document.getElementById('vTodayDist').innerText = `${todayDist.toLocaleString()} km`;
        if (document.getElementById('vTodayCost')) document.getElementById('vTodayCost').innerText = `${todayCost.toLocaleString()} 원`;
        if (document.getElementById('vTotalDrivers')) document.getElementById('vTotalDrivers').innerText = `${totalDrivers}명`;
        if (document.getElementById('vMonthDrivers')) document.getElementById('vMonthDrivers').innerText = `${monthDrivers}명`;
        if (document.getElementById('vMonthDist')) document.getElementById('vMonthDist').innerText = `${monthDist.toLocaleString()} km`;
        if (document.getElementById('vMonthCost')) document.getElementById('vMonthCost').innerText = `${monthCost.toLocaleString()} 원`;
    },

    renderDriversTable: () => {
        const tbody = document.getElementById('tblDriversBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        const drivers = (app.rawDb.drivers || []).filter(d => d.role === 'driver' && app.matchCompany(d.company));
        if(drivers.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">등록된 기사가 없습니다.</td></tr>'; return; }

        drivers.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="fw-bold text-dark">${app.escapeXSS(d.name)}</td>
                <td>${app.escapeXSS(d.phone)}</td>
                <td><span class="badge bg-light text-dark border">${app.escapeXSS(d.car_number)}</span></td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(d.company) || '미배정'}</span></td>
                <td class="text-center">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-mgr-lock" onclick="app.openEditDriverModal('${d.phone}')">수정</button>
                        <button class="btn btn-outline-danger btn-mgr-lock" onclick="app.deleteDriverProcess('${d.phone}', '${d.name}')">삭제</button>
                        <button class="btn btn-outline-warning" onclick="app.resetDriverPasswordProcess('${d.phone}', '${d.name}')">비번초기화</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    applyDailySearch: () => {
        const fMonth = document.getElementById('searchDailyMonth').value; 
        const fKeyword = document.getElementById('searchDailyKeyword').value.trim().toLowerCase();
        const tbody = document.getElementById('tblDailyRecordsBody');
        if(!tbody) return;

        app.filteredDailyMileages = (app.rawDb.mileages || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            const d = app.formatDateStr(r.date);
            if (fMonth && !d.startsWith(fMonth)) return false;
            if (fKeyword && !String(r.name).toLowerCase().includes(fKeyword)) return false;
            return true;
        }).sort((a,b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        if(app.filteredDailyMileages.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">결과가 없습니다.</td></tr>'; return; }

        app.filteredDailyMileages.forEach(r => {
            let evidenceBtn = `-`;
            if(r.evidence_url) {
                evidenceBtn = r.evidence_url.split(',').map((url, idx) => `<a href="${url.trim()}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0 me-1">사진${idx+1}</a>`).join('');
            }
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${app.formatDateStr(r.date)}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="text-muted small">${r.start_distance}km → ${r.end_distance}km</td>
                <td class="fw-bold text-primary">${Number(r.distance).toLocaleString()} km</td>
                <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="app.deleteDailyProcess('${app.formatDateStr(r.date)}', '${r.phone}', '${r.company}', '${r.name}')">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    applyReceiptSearch: () => {
        const fMonth = document.getElementById('searchReceiptMonth').value; 
        const fCompany = document.getElementById('searchReceiptCompany')?.value || 'ALL'; 
        const tbody = document.getElementById('tblAdminReceiptBody');
        if(!tbody) return;

        app.filteredAdminReceipts = (app.rawDb.receipts || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            if (fCompany !== 'ALL' && !String(r.company).includes(fCompany)) return false; 
            if (fMonth && !app.formatDateStr(r.date).startsWith(fMonth)) return false;
            return true;
        }).sort((a,b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        if(app.filteredAdminReceipts.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">내역이 없습니다.</td></tr>'; return; }

        app.filteredAdminReceipts.forEach(r => {
            const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0">영수증 보기</a>` : `-`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${app.formatDateStr(r.date)}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td>${r.phone}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="fw-bold text-primary">${Number(r.amount).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="app.adminDeleteReceipt('${app.formatDateStr(r.date)}', '${r.phone}', '${r.company}', ${r.amount})">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteDailyProcess: async (dateStr, phone, company, name) => {
        if(!confirm(`정말 ${name} 기사님의 기록을 삭제하시겠습니까?`)) return;
        app.showLoading(true); await app.fetchAPI({ action: 'deleteDailyMileage', date: dateStr, phone, company });
        app.loadAdminDashboardData();
    },

    adminDeleteReceipt: async (dateStr, phone, company, amount) => {
        if(!confirm(`해당 주유 영수증을 삭제하시겠습니까?`)) return;
        app.showLoading(true); await app.fetchAPI({ action: 'deleteReceipt', date: dateStr, phone: phone, company: company, amount: amount });
        app.loadAdminDashboardData();
    },

    openAddDriverModal: () => {
        document.getElementById('mdlDriverTitle').innerText = "기사 신규 등록";
        document.getElementById('hdnEditOriginPhone').value = "";
        document.getElementById('mDriverName').value = ""; document.getElementById('mDriverPhone').value = ""; document.getElementById('mDriverCar').value = "";
        const compInput = document.getElementById('mDriverCompany');
        if(compInput) {
            let opts = '';
            (app.rawDb.masterCompanies || []).forEach(c => opts += `<option value="${c.name}">${c.name}</option>`);
            compInput.innerHTML = opts;
        }
        new bootstrap.Modal(document.getElementById('mdlDriver')).show();
    },

    openEditDriverModal: (phone) => {
        const d = (app.rawDb.drivers || []).find(x => x.phone == phone);
        if(!d) return;
        document.getElementById('mdlDriverTitle').innerText = `정보 수정 [${d.name}]`;
        document.getElementById('hdnEditOriginPhone').value = d.phone;
        document.getElementById('mDriverName').value = d.name;
        document.getElementById('mDriverPhone').value = d.phone;
        document.getElementById('mDriverCar').value = d.car_number;
        const compInput = document.getElementById('mDriverCompany');
        if(compInput) {
            let opts = '';
            (app.rawDb.masterCompanies || []).forEach(c => opts += `<option value="${c.name}" ${c.name === d.company ? 'selected':''}>${c.name}</option>`);
            compInput.innerHTML = opts;
        }
        new bootstrap.Modal(document.getElementById('mdlDriver')).show();
    },

    handleDriverFormSubmit: async (e) => {
        e.preventDefault();
        const originPhone = document.getElementById('hdnEditOriginPhone').value;
        const name = document.getElementById('mDriverName').value.trim();
        const phone = document.getElementById('mDriverPhone').value.trim();
        const car_number = document.getElementById('mDriverCar').value.trim();
        const company = document.getElementById('mDriverCompany').value;

        bootstrap.Modal.getInstance(document.getElementById('mdlDriver')).hide();
        app.showLoading(true);
        if(!originPhone) {
            await app.fetchAPI({ action: 'addDriver', name, phone, car_number, company, password_hash: '0000' });
        } else {
            await app.fetchAPI({ action: 'updateDriver', originPhone, name, phone, car_number, company });
        }
        app.loadAdminDashboardData();
    },

    resetDriverPasswordProcess: async (phone, name) => {
        if(!confirm(`${name} 기사님의 암호를 0000으로 리셋하시겠습니까?`)) return;
        app.showLoading(true); await app.fetchAPI({ action: 'resetPassword', phone, default_hash: '0000' });
        app.loadAdminDashboardData();
    },

    deleteDriverProcess: async (phone, name) => {
        if(!confirm(`${name} 기사님을 탈퇴 처리하시겠습니까?`)) return;
        app.showLoading(true); await app.fetchAPI({ action: 'deleteDriver', phone });
        app.loadAdminDashboardData();
    },

    renderCharts: () => {
        const mileages = app.rawDb.mileages || [];
        const dateMap = {};
        mileages.forEach(m => {
            const d = app.formatDateStr(m.date);
            dateMap[d] = (dateMap[d] || 0) + (Number(m.distance) || 0);
        });
        const labels = Object.keys(dateMap).sort().slice(-7);
        const vals = labels.map(l => dateMap[l]);
        
        const ctx = document.getElementById('cChart1')?.getContext('2d');
        if(ctx) {
            if(app.charts['cChart1']) app.charts['cChart1'].destroy();
            app.charts['cChart1'] = new Chart(ctx, { type: 'line', data: { labels, datasets:[{ label:'주행량', data: vals, borderColor:'#4318ff', tension:0.3 }] } });
        }
    },

    downloadDailyExcel: () => {
        let html = `<table border="1"><thead><tr><th>날짜</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>출발계기판</th><th>도착계기판</th><th>실제거리</th><th>정산유류비</th></tr></thead><tbody>`;
        (app.filteredDailyMileages || []).forEach(r => {
            html += `<tr><td>${app.formatDateStr(r.date)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.start_distance}</td><td>${r.end_distance}</td><td>${r.distance}</td><td>${r.fuel_cost}</td></tr>`;
        });
        html += '</tbody></table>';
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", "일별운행기록.xls"); link.click();
    },

    downloadReceiptExcel: () => {
        let html = `<table border="1"><thead><tr><th>날짜</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>금액</th></tr></thead><tbody>`;
        (app.filteredAdminReceipts || []).forEach(r => {
            html += `<tr><td>${app.formatDateStr(r.date)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.amount}</td></tr>`;
        });
        html += '</tbody></table>';
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", "주유영수증내역.xls"); link.click();
    }
};
window.onload = app.init;
