// 🚨 알려주신 구글 웹앱 주소 유지
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzFBx-WmI3BDm3GwqR6O0AF3a9lj-9LjmXp1ZTk-yL97znfSniJ1_kixxVuDl0Hjar0/exec';

const app = {
    user: JSON.parse(localStorage.getItem('fuelUser')) || null,
    loginTargetRole: '',
    rawDb: { drivers: [], fuelRatesList: [], history: [], mileages: [], masterCompanies: [], receipts: [] },
    filteredDailyMileages: [],
    filteredMonthlyMileages: [],
    filteredAdminReceipts: [],

    init: () => {
        app.bindEvents();
        app.checkSession();
    },

    bindEvents: () => {
        document.getElementById('loginForm')?.addEventListener('submit', app.handleLogin);
        document.getElementById('mileageForm')?.addEventListener('submit', app.handleMileageSubmit);
        document.getElementById('receiptForm')?.addEventListener('submit', app.handleReceiptSubmit); // 영수증 폼 제출
        
        // ⭐️ 전/후 계기판 입력 시 '실제 운행거리' 자동 계산 로직
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

    applyRoleRestrictions: (role) => {
        const mgrLocks = document.querySelectorAll('.btn-mgr-lock');
        const btnManageComp = document.getElementById('btnManageCompany');
        mgrLocks.forEach(b => b.removeAttribute('disabled'));
        if (role === 'manager') { if(btnManageComp) btnManageComp.classList.add('d-none'); } 
        else { if(btnManageComp) btnManageComp.classList.remove('d-none'); }
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

    compressImage: async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width; let height = img.height;
                    if (width > 800) { height *= 800 / width; width = 800; }
                    canvas.width = width; canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]); 
                };
            };
        });
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

    initDriverView: () => {
        app.cancelDriverEdit(); 
        document.getElementById('driverGreeting').innerHTML = `이름: <b class="text-primary">${app.escapeXSS(app.user.name)}</b> 기사님`;
        document.getElementById('driverCarBadge').innerText = app.escapeXSS(app.user.car_number);

        const compSelect1 = document.getElementById('inputCompany');
        const compSelect2 = document.getElementById('rInputCompany');
        compSelect1.innerHTML = ''; compSelect2.innerHTML = '';
        
        const activeComps = app.user.activeCompanies || [];
        const myCompanies = (app.user.company || "").split(',').map(c => c.trim()).filter(c => c && activeComps.includes(c));
        
        if (myCompanies.length === 0) {
            compSelect1.innerHTML = '<option value="">선택가능한 화주사가 없습니다.</option>';
            compSelect2.innerHTML = '<option value="">선택가능한 화주사가 없습니다.</option>';
        } else {
            myCompanies.forEach(c => {
                compSelect1.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
                compSelect2.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
            });
        }

        const currentMonthStr = new Date().toISOString().substring(0, 7);
        document.getElementById('driverMonthFilter').value = currentMonthStr;
        document.getElementById('driverReceiptMonthFilter').value = currentMonthStr;
        
        app.renderDriverRecords();
        app.renderDriverReceipts();
    },

    // 운행기록 렌더링 (전/후 키로수 표시)
    renderDriverRecords: () => {
        const selectedMonth = document.getElementById('driverMonthFilter').value;
        const records = app.user.driverRecords?.mileages || [];
        
        let totalDistance = 0; let totalCost = 0; let validRecords = [];

        records.forEach(r => {
            if (new Date(r.date).toLocaleDateString('sv-SE').substring(0, 7) === selectedMonth) {
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
                const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url.split(',')[0]}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0">보기</a>` : `<span class="text-muted small">없음</span>`;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="small">${new Date(r.date).toLocaleDateString('ko-KR', {month:'2-digit', day:'2-digit'})}</td>
                    <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                    <td class="small text-secondary">${r.start_distance} -> ${r.end_distance}</td>
                    <td class="fw-bold text-dark">${Number(r.distance).toLocaleString()} km</td>
                    <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                    <td class="text-center">${evidenceBtn}</td>
                    <td class="text-center"><button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyRecord('${new Date(r.date).toLocaleDateString('sv-SE')}', '${app.escapeXSS(r.company)}')">삭제</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
        document.getElementById('dStatDistance').innerText = `${totalDistance.toLocaleString()} km`;
        document.getElementById('dStatCost').innerText = `${totalCost.toLocaleString()} 원`;
        document.getElementById('dStatDays').innerText = `${validRecords.length}건`;
    },

    // 영수증 렌더링
    renderDriverReceipts: () => {
        const selectedMonth = document.getElementById('driverReceiptMonthFilter').value;
        const receipts = app.user.driverRecords?.receipts || [];
        const tbody = document.getElementById('tblDriverReceiptBody');
        tbody.innerHTML = '';
        
        let validReceipts = receipts.filter(r => new Date(r.date).toLocaleDateString('sv-SE').substring(0, 7) === selectedMonth);
        if(validReceipts.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted small py-3">해당 월 영수증 내역이 없습니다.</td></tr>'; return; }
        
        validReceipts.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(r => {
            const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0">영수증 보기</a>` : `-`;
            const dateStr = new Date(r.date).toLocaleDateString('sv-SE');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small">${dateStr}</td>
                <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                <td class="fw-bold text-primary">${Number(r.amount).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyReceipt('${dateStr}', '${app.escapeXSS(r.company)}', ${r.amount})">삭제</button></td>
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
        if(!confirm(`해당 영수증을 삭제하시겠습니까?`)) return;
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

        if (!company) return alert('기입 가능한 소속 화주사가 없습니다.');
        if (isNaN(distance) || distance <= 0) return alert('운행 후 계기판이 운행 전보다 커야 합니다.');

        submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 처리중...';
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
            if (confirm('해당 날짜에 이미 기록이 존재합니다.\n입력하신 거리로 덮어쓰기 수정하시겠습니까?')) {
                payload.isUpdate = true;
                res = await app.fetchAPI(payload);
            }
        }

        if (res) {
            alert('운행기록이 저장되었습니다.');
            app.cancelDriverEdit(); 
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverRecords(); 
        }
        app.showLoading(false);
        submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> 등록하기';
    },

    // ⭐️ 영수증 전용 폼 제출 로직
    handleReceiptSubmit: async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnSubmitReceipt');
        const date = document.getElementById('rInputDate').value;
        const company = document.getElementById('rInputCompany').value;
        const amount = parseInt(document.getElementById('rInputAmount').value, 10);
        const fileInput = document.getElementById('rInputEvidence');

        if (!company) return alert('화주사가 선택되지 않았습니다.');
        if (isNaN(amount) || amount <= 0) return alert('금액을 올바르게 입력하세요.');
        if (fileInput.files.length === 0) return alert('영수증 사진을 첨부하세요.');

        submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 업로드중...';
        app.showLoading(true);

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
            document.getElementById('driverReceiptMonthFilter').value = date.substring(0, 7);
            
            const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
            app.renderDriverReceipts(); 
        }
        app.showLoading(false);
        submitBtn.disabled = false; submitBtn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> 영수증 등록하기';
    },

    loadAdminDashboardData: async () => {
        app.showLoading(true);
        const data = await app.fetchAPI({ action: 'getAdminData', role: app.user.role, company: app.user.company });
        app.showLoading(false);
        if (data) {
            app.rawDb = data; app.populateAdminCompanyFilter(); app.refreshAdminViews();
            document.getElementById('searchDailyMonth').value = new Date().toISOString().substring(0, 7);
            document.getElementById('searchReceiptMonth').value = new Date().toISOString().substring(0, 7);
            app.applyDailySearch(); app.applyReceiptSearch();
        }
    },

    populateAdminCompanyFilter: () => {
        const selectEl = document.getElementById('adminCompanyFilter');
        const searchComp1 = document.getElementById('searchMonthlyCompany');
        const searchComp2 = document.getElementById('searchReceiptCompany');
        
        const companies = new Set((app.rawDb.masterCompanies || []).map(c => c.name));
        app.rawDb.drivers.forEach(d => { if(d.company) d.company.split(',').forEach(c => companies.add(c.trim())); });
        
        if (app.user.role === 'admin') {
            document.getElementById('adminRoleBadge').classList.add('d-none');
            selectEl.classList.remove('d-none');
            let opts = '<option value="ALL">전체 화주사 조회</option>';
            Array.from(companies).filter(c=>c).sort().forEach(c => opts += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`);
            selectEl.innerHTML = opts; searchComp1.innerHTML = opts; searchComp2.innerHTML = opts;
            app.currentAdminCompanyFilter = selectEl.value || 'ALL';
        } else {
            selectEl.classList.add('d-none');
            document.getElementById('adminRoleBadge').classList.remove('d-none');
            document.getElementById('adminRoleBadge').innerText = `매니저 (${app.user.company})`;
            app.currentAdminCompanyFilter = app.user.company; 
            searchComp1.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`;
            searchComp2.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`;
            searchComp1.setAttribute('disabled', 'true'); searchComp2.setAttribute('disabled', 'true');
        }
    },

    refreshAdminViews: () => {
        if(app.user.role === 'admin') app.currentAdminCompanyFilter = document.getElementById('adminCompanyFilter').value || 'ALL';
        app.calculateSummaryStats(); app.renderDriversTable(); 
        app.applyDailySearch(); app.applyReceiptSearch();
    },

    matchCompany: (itemCompany) => {
        if (app.currentAdminCompanyFilter === 'ALL') return true;
        return String(itemCompany).includes(app.currentAdminCompanyFilter);
    },

    calculateSummaryStats: () => {
        const todayStr = new Date().toLocaleDateString('sv-SE');
        const monthStr = todayStr.substring(0, 7);
        const validMileages = app.rawDb.mileages.filter(m => app.matchCompany(m.company));

        const tRec = validMileages.filter(r => r.date.startsWith(todayStr));
        document.getElementById('vTodayDrivers').innerText = `${new Set(tRec.map(r=>r.phone)).size}명`;
        document.getElementById('vTodayDist').innerText = `${tRec.reduce((s,r)=>s+Number(r.distance),0).toLocaleString()} km`;
        document.getElementById('vTodayCost').innerText = `${tRec.reduce((s,r)=>s+Number(r.fuel_cost),0).toLocaleString()} 원`;
    },

    applyDailySearch: () => {
        const fMonth = document.getElementById('searchDailyMonth').value; 
        const fKeyword = document.getElementById('searchDailyKeyword').value.trim().toLowerCase();

        const filtered = app.rawDb.mileages.filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            if (fMonth && !r.date.startsWith(fMonth)) return false;
            if (fKeyword && !String(r.name).toLowerCase().includes(fKeyword)) return false;
            return true;
        }).sort((a,b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('tblDailyRecordsBody');
        tbody.innerHTML = '';
        if(filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">결과가 없습니다.</td></tr>'; return; }

        filtered.forEach(r => {
            let evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url.split(',')[0]}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill py-0 px-2">사진 보기</a>` : `-`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.date.substring(0,10)}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="text-muted small">${r.start_distance} <i class="bi bi-arrow-right"></i> ${r.end_distance}</td>
                <td class="fw-bold text-primary">${Number(r.distance).toLocaleString()} km</td>
                <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="app.deleteDailyProcess('${r.date.substring(0,10)}', '${r.phone}', '${r.company}', '${r.name}')">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteDailyProcess: async (dateStr, phone, company, name) => {
        if(!confirm(`[${dateStr}] 운행 기록을 영구 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteDailyMileage', date: dateStr, phone, company });
        if(res) app.loadAdminDashboardData();
        app.showLoading(false);
    },

    // ⭐️ 관리자: 영수증 탭 조회
    applyReceiptSearch: () => {
        const fMonth = document.getElementById('searchReceiptMonth').value; 
        const fCompany = document.getElementById('searchReceiptCompany')?.value || 'ALL'; 

        const filtered = (app.rawDb.receipts || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            if (fCompany !== 'ALL' && !String(r.company).includes(fCompany)) return false; 
            if (fMonth && !r.date.startsWith(fMonth)) return false;
            return true;
        }).sort((a,b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('tblAdminReceiptBody');
        tbody.innerHTML = '';
        if(filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">결과가 없습니다.</td></tr>'; return; }

        filtered.forEach(r => {
            const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill py-0 px-2"><i class="bi bi-receipt"></i> 영수증 확인</a>` : `-`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.date.substring(0,10)}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td>${r.phone}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="fw-bold text-primary">${Number(r.amount).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="app.adminDeleteReceipt('${r.date.substring(0,10)}', '${r.phone}', '${r.company}', ${r.amount})">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    adminDeleteReceipt: async (dateStr, phone, company, amount) => {
        if(!confirm(`해당 영수증 내역을 완전히 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteReceipt', date: dateStr, phone: phone, company: company, amount: amount });
        if(res) app.loadAdminDashboardData();
        app.showLoading(false);
    },

    downloadDailyExcel: () => {
        let htmlTable = `<table border="1"><thead><tr style="background-color:#f2f2f2;"><th>운행일자</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>출발계기판</th><th>도착계기판</th><th>주행거리(km)</th><th>유류비(원)</th><th>증빙URL</th></tr></thead><tbody>`;
        app.filteredDailyMileages.forEach(r => { htmlTable += `<tr><td>${r.date.substring(0,10)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.start_distance}</td><td>${r.end_distance}</td><td>${r.distance}</td><td>${r.fuel_cost}</td><td>${r.evidence_url}</td></tr>`; });
        htmlTable += "</tbody></table>";
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([htmlTable], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", `운행기록_${new Date().toLocaleDateString('sv-SE')}.xls`);
        link.click();
    },

    downloadReceiptExcel: () => {
        const filtered = (app.rawDb.receipts || []).filter(r => app.matchCompany(r.company));
        let htmlTable = `<table border="1"><thead><tr style="background-color:#ffe0b2;"><th>결제일자</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>결제금액(원)</th><th>영수증URL</th></tr></thead><tbody>`;
        filtered.forEach(r => { htmlTable += `<tr><td>${r.date.substring(0,10)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.amount}</td><td>${r.evidence_url}</td></tr>`; });
        htmlTable += "</tbody></table>";
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([htmlTable], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", `주유영수증_${new Date().toLocaleDateString('sv-SE')}.xls`);
        link.click();
    },

    // 화주사 마스터 등 기타 유지
    openCompanyModal: () => {
        const ul = document.getElementById('ulMasterCompanies'); ul.innerHTML = '';
        const comps = app.rawDb.masterCompanies || [];
        comps.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
            ul.innerHTML += `<li class="list-group-item bg-light border-0 rounded-3 p-3 mb-2"><div class="d-flex justify-content-between align-items-center"><span class="fw-bold">${app.escapeXSS(c.name)}</span><button class="btn btn-sm btn-white text-danger border" onclick="app.toggleCompanyStatusProcess('${c.name}', '${c.status}')">${c.status === 'active' ? '운영중 (클릭시 중단)' : '중단됨 (클릭시 재개)'}</button></div></li>`;
        });
        new bootstrap.Modal(document.getElementById('mdlCompany')).show();
    },
    addMasterCompany: async () => {
        const input = document.getElementById('mNewCompanyName');
        const cName = input.value.trim();
        if(!cName) return;
        app.showLoading(true); const res = await app.fetchAPI({ action: 'addMasterCompany', companyName: cName }); app.showLoading(false);
        if(res) { input.value = ''; app.loadAdminDashboardData(); }
    },
    toggleCompanyStatusProcess: async (cName, currentStatus) => {
        if(!confirm(`[${cName}] 상태를 변경하시겠습니까?`)) return;
        app.showLoading(true); const res = await app.fetchAPI({ action: 'toggleCompanyStatus', companyName: cName, status: currentStatus }); app.showLoading(false);
        if(res) app.loadAdminDashboardData();
    }
};
window.onload = app.init;
