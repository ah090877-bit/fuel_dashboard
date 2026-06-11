const GAS_URL = 'https://script.google.com/macros/s/AKfycbzFBx-WmI3BDm3GwqR6O0AF3a9lj-9LjmXp1ZTk-yL97znfSniJ1_kixxVuDl0Hjar0/exec';

const app = {
    user: JSON.parse(localStorage.getItem('fuelUser')) || null,
    loginTargetRole: '',
    rawDb: { drivers: [], fuelRatesList: [], mileages: [], masterCompanies: [], receipts: [], locations: [] },
    filteredDailyMileages: [],
    filteredMonthlyMileages: [],
    filteredAdminReceipts: [],
    filteredLocations: [],
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
        document.getElementById('driverLocationDateFilter')?.addEventListener('change', app.renderDriverLocations);
        document.getElementById('adminCompanyFilter')?.addEventListener('change', app.refreshAdminViews);

        const tabElList = [].slice.call(document.querySelectorAll('#adminTabs button'));
        tabElList.forEach(tabEl => {
            tabEl.addEventListener('shown.bs.tab', (e) => {
                if (e.target.id === 'tab-dash') app.renderAdvancedCharts();
                if (e.target.id === 'tab-unsubmitted') {
                    document.getElementById('unsubmittedDateFilter').value = app.getSafeTodayString();
                    app.renderUnsubmittedTable();
                }
                if (e.target.id === 'tab-lookup-monthly') app.applyMonthlySearch();
                if (e.target.id === 'tab-receipts') app.applyReceiptSearch();
                if (e.target.id === 'tab-locations') app.applyLocationSearch();
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
            app.loadAdminDashboardData();
        }
    },

    getSafeTodayString: () => {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000; 
        return (new Date(now - tzOffset)).toISOString().substring(0, 10);
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
        return String(str).replace(/[&<>"']/g, (m) => { 
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }; 
            return map[m]; 
        });
    },

    hashPassword: async (pw) => {
        const data = new TextEncoder().encode(pw);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    compressImage: (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = event => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const MAX_WIDTH = 1024; const MAX_HEIGHT = 1024;
                    let width = img.width; let height = img.height;
                    if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } } 
                    else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                    canvas.width = width; canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]); 
                };
                img.onerror = error => reject(error);
            };
            reader.onerror = error => reject(error);
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
        const data = await app.fetchAPI({ action: 'login', phone, password_hash: hashedPassword, role: app.loginTargetRole });
        app.showLoading(false);

        if (data) {
            if (data.requirePasswordChange) {
                app.tempLoginData = data; 
                document.getElementById('dNewPw').value = '';
                document.getElementById('dNewPwConfirm').value = '';
                alert("초기 비밀번호가 감지되었습니다.\n안전한 사용을 위해 비밀번호를 반드시 변경해 주세요.");
                new bootstrap.Modal(document.getElementById('mdlDriverPassword')).show();
                return;
            }

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
        
        const targetData = app.tempLoginData ? app.tempLoginData : app.user;
        const data = await app.fetchAPI({ action: 'changePassword', phone: targetData.phone, new_password_hash: hashedPassword, role: targetData.role });
        app.showLoading(false);

        if (data) {
            bootstrap.Modal.getInstance(document.getElementById('mdlDriverPassword')).hide();
            if (app.tempLoginData) {
                alert('비밀번호가 정상적으로 변경되었습니다. 변경된 비밀번호로 다시 로그인해 주세요.');
                app.tempLoginData = null; 
                app.hideLoginForm(); 
            } else {
                alert('비밀번호가 정상적으로 변경되었습니다.');
            }
        }
    },

    handleArrivalSubmit: () => {
        if (!navigator.geolocation) return alert("GPS를 지원하지 않는 브라우저입니다.");
        const comp = document.getElementById('inputCompany').value;
        if(!comp) return alert("소속 화주사를 먼저 선택해주세요.");
        if(!confirm(`[${comp}] 목적지에 도착하셨습니까?\n현재 위치를 관리자에게 전송합니다.`)) return;

        app.showLoading(true);
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            
            const payload = { action: 'saveLocation', phone: app.user.phone, name: app.user.name, company: comp, lat: lat, lng: lng };
            const res = await app.fetchAPI(payload);
            app.showLoading(false);
            
            if(res) {
                alert(`[전송 완료]\n지점: ${comp}\n주소: ${res.address}`);
                const updated = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
                app.user.driverRecords = updated; localStorage.setItem('fuelUser', JSON.stringify(app.user));
                app.renderDriverLocations();
            }
        }, (err) => {
            app.showLoading(false);
            alert("위치 정보를 가져올 수 없습니다. GPS 설정 및 브라우저 권한을 확인해주세요.");
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
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
        const todayStr = app.getSafeTodayString();
        
        document.getElementById('driverMonthFilter').value = currentMonthStr;
        document.getElementById('driverReceiptMonthFilter').value = currentMonthStr;
        document.getElementById('driverLocationDateFilter').value = todayStr;
        
        app.renderDriverRecords();
        app.renderDriverReceipts();
        app.renderDriverLocations(); 
    },

    renderDriverRecords: () => {
        const selectedMonth = document.getElementById('driverMonthFilter').value;
        const records = app.user.driverRecords?.mileages || [];
        let totalDistance = 0; let totalCost = 0; let totalToll = 0; let validRecords = [];

        records.forEach(r => {
            if (app.formatDateStr(r.date).substring(0, 7) === selectedMonth) {
                validRecords.push(r);
                totalDistance += Number(r.distance) || 0;
                totalCost += Number(r.fuel_cost) || 0;
                totalToll += Number(r.toll_fee) || 0; 
            }
        });

        const tbody = document.getElementById('tblDriverMonthBody');
        tbody.innerHTML = '';
        if(validRecords.length === 0) { tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted small py-3">해당 월 기록이 없습니다.</td></tr>'; } 
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
                    <td class="fw-bold text-secondary">${Number(r.toll_fee).toLocaleString()} 원</td>
                    <td class="text-center">${evidenceBtn}</td>
                    <td class="text-center">
                        <button class="btn btn-outline-primary btn-sm py-0 px-2 me-1" onclick="app.editMyRecord('${app.formatDateStr(r.date)}', '${app.escapeXSS(r.company)}', ${r.start_distance}, ${r.end_distance}, ${r.distance}, ${r.toll_fee})">수정</button>
                        <button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyRecord('${app.formatDateStr(r.date)}', '${app.escapeXSS(r.company)}')">삭제</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
        document.getElementById('dStatDistance').innerText = `${totalDistance.toLocaleString()} km`;
        document.getElementById('dStatCost').innerText = `${totalCost.toLocaleString()} 원`;
        document.getElementById('dStatToll').innerText = `${totalToll.toLocaleString()} 원`; 
    },

    editMyRecord: (dateStr, company, start, end, distance, tollFee) => {
        document.getElementById('inputDate').value = dateStr;
        document.getElementById('inputCompany').value = company;
        document.getElementById('inputStartDist').value = start;
        document.getElementById('inputEndDist').value = end;
        document.getElementById('inputDistance').value = distance;
        document.getElementById('inputTollFee').value = tollFee || 0; 
        document.getElementById('driverFormTitle').scrollIntoView({ behavior: "smooth" });
    },

    renderDriverReceipts: () => {
        const selectedMonth = document.getElementById('driverReceiptMonthFilter').value;
        const receipts = app.user.driverRecords?.receipts || [];
        const tbody = document.getElementById('tblDriverReceiptBody');
        tbody.innerHTML = '';
        
        let validReceipts = receipts.filter(r => app.formatDateStr(r.date).substring(0, 7) === selectedMonth);
        if(validReceipts.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small py-3">해당 월 영수증 내역이 없습니다.</td></tr>'; return; }
        
        validReceipts.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(r => {
            const evidenceBtn = r.evidence_url ? `<a href="${r.evidence_url}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0">영수증 보기</a>` : `-`;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small">${app.formatDateStr(r.date)}</td>
                <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                <td><span class="badge ${r.type==='도로비'?'bg-secondary':'bg-primary'}">${r.type || '주유비'}</span></td>
                <td class="fw-bold text-primary">${Number(r.amount).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm py-0 px-2" onclick="app.deleteMyReceipt('${app.formatDateStr(r.date)}', '${app.escapeXSS(r.company)}', ${r.amount})">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderDriverLocations: () => {
        const selectedDate = document.getElementById('driverLocationDateFilter').value;
        const locations = app.user.driverRecords?.locations || [];
        const tbody = document.getElementById('tblDriverLocationBody');
        if(!tbody) return;
        tbody.innerHTML = '';

        document.getElementById('txtDriverLocDate').innerText = selectedDate;

        let validLocs = locations.filter(l => app.formatDateStr(l.date) === selectedDate);
        document.getElementById('txtDriverLocCount').innerText = validLocs.length;

        if(validLocs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted small py-3">해당 날짜의 도착 인증 기록이 없습니다.</td></tr>';
            return;
        }

        const countMap = {};
        validLocs.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(l => {
            if(!countMap[l.company]) countMap[l.company] = 0;
            countMap[l.company]++;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small">${l.timestamp.substring(11, 16)}</td>
                <td class="fw-bold text-dark small">${app.escapeXSS(l.company)} <span class="badge bg-light text-dark border py-0 px-1 font-monospace">${countMap[l.company]}회차</span></td>
                <td class="small text-muted text-wrap" style="max-width:180px;">${app.escapeXSS(l.address)}</td>
            `;
            tbody.prepend(tr); 
        });
    },

    cancelDriverEdit: () => {
        document.getElementById('inputDate').value = app.getSafeTodayString();
        document.getElementById('inputStartDist').value = '';
        document.getElementById('inputEndDist').value = '';
        document.getElementById('inputDistance').value = '';
        document.getElementById('inputTollFee').value = ''; 
        document.getElementById('inputEvidence').value = '';
    },

    handleMileageSubmit: async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnSubmitMileage');
        const date = document.getElementById('inputDate').value;
        const startDist = parseInt(document.getElementById('inputStartDist').value, 10);
        const endDist = parseInt(document.getElementById('inputEndDist').value, 10);
        const distance = parseInt(document.getElementById('inputDistance').value, 10);
        const tollFee = parseInt(document.getElementById('inputTollFee').value, 10) || 0; 
        const company = document.getElementById('inputCompany').value;
        const fileInput = document.getElementById('inputEvidence');

        if (isNaN(distance) || distance <= 0) return alert('도착 계기판 숫자가 출발보다 작거나 같습니다.');

        submitBtn.disabled = true; submitBtn.innerHTML = '처리중...';
        app.showLoading(true);

        const payload = {
            action: 'saveMileage', date, distance, phone: app.user.phone,
            name: app.user.name, car_number: app.user.car_number,
            company: company, start_distance: startDist, end_distance: endDist, toll_fee: tollFee, 
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
        const receiptType = document.getElementById('rReceiptType').value; 
        const fileInput = document.getElementById('rInputEvidence');

        if (isNaN(amount) || amount <= 0) return alert('금액을 바르게 입력하세요.');

        submitBtn.disabled = true; app.showLoading(true);
        const payload = {
            action: 'saveReceipt', date, amount, phone: app.user.phone,
            name: app.user.name, car_number: app.user.car_number, company: company, type: receiptType,
            fileBase64: await app.compressImage(fileInput.files[0])
        };

        const res = await app.fetchAPI(payload);
        if (res) {
            alert(`${receiptType} 지출 증빙 서류가 등록되었습니다.`);
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
            app.setupAdminUI(); 
            app.populateAdminCompanyFilter(); 
            
            const today = app.getSafeTodayString();
            const firstDay = today.substring(0, 8) + '01';
            
            document.getElementById('searchDailyMonth').value = today.substring(0, 7);
            document.getElementById('searchDailyStartDate').value = firstDay;
            document.getElementById('searchDailyEndDate').value = today;
            
            document.getElementById('searchMonthlyStartDate').value = firstDay;
            document.getElementById('searchMonthlyEndDate').value = today;
            
            document.getElementById('searchReceiptMonth').value = today.substring(0, 7);
            document.getElementById('searchLocationDate').value = today; 

            app.refreshAdminViews();
        }
    },

    setupAdminUI: () => {
        const badgeEl = document.getElementById('adminGreetingBadge');
        if(badgeEl) {
            if(app.user.role === 'admin') {
                badgeEl.innerHTML = `<span class="badge bg-primary px-3 py-2 rounded-pill shadow-sm"><i class="bi bi-star-fill text-warning"></i> 최고관리자</span> <span class="fs-5 fw-bold ms-2 text-dark">${app.escapeXSS(app.user.name)}</span><span class="fs-6 text-muted">님, 반갑습니다!</span>`;
            } else {
                badgeEl.innerHTML = `<span class="badge bg-info text-dark px-3 py-2 rounded-pill shadow-sm"><i class="bi bi-building"></i> ${app.escapeXSS(app.user.company)}</span> <span class="fs-5 fw-bold ms-2 text-dark">${app.escapeXSS(app.user.name)}</span><span class="fs-6 text-muted"> 관리자님, 반갑습니다!</span>`;
            }
        }
        
        const btnManageCompany = document.getElementById('btnManageCompany');
        if (btnManageCompany) {
            if (app.user.role === 'admin') {
                btnManageCompany.classList.remove('d-none');
            } else {
                btnManageCompany.classList.add('d-none');
            }
        }
    },

    populateAdminCompanyFilter: () => {
        const selectEl = document.getElementById('adminCompanyFilter');
        const searchComp2 = document.getElementById('searchReceiptCompany');
        const searchComp3 = document.getElementById('searchLocationCompany'); 
        const companies = new Set((app.rawDb.masterCompanies || []).map(c => c.name));
        
        if (app.user.role === 'admin') {
            if(selectEl) selectEl.classList.remove('d-none');
            let opts = '<option value="ALL">전체 화주사 통합 조회</option>';
            Array.from(companies).filter(c=>c).sort().forEach(c => opts += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`);
            if(selectEl) selectEl.innerHTML = opts; 
            if(searchComp2) searchComp2.innerHTML = opts;
            if(searchComp3) searchComp3.innerHTML = opts;
            app.currentAdminCompanyFilter = selectEl?.value || 'ALL';
        } else {
            if(selectEl) selectEl.classList.add('d-none');
            app.currentAdminCompanyFilter = app.user.company; 
            if(searchComp2) { searchComp2.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`; searchComp2.setAttribute('disabled', 'true'); }
            if(searchComp3) { searchComp3.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`; searchComp3.setAttribute('disabled', 'true'); }
        }
    },

    refreshAdminViews: () => {
        if(app.user.role === 'admin') {
            const filterEl = document.getElementById('adminCompanyFilter');
            if(filterEl) app.currentAdminCompanyFilter = filterEl.value || 'ALL';
        }
        app.calculateSummaryStats(); 
        app.renderAdvancedCharts();
        app.renderDriversTable(); 
        app.applyDailySearch(); 
        app.applyMonthlySearch(); 
        app.applyReceiptSearch();
        app.applyLocationSearch(); 
        app.renderFuelRateTable();
    },

    matchCompany: (itemCompany) => {
        if (app.currentAdminCompanyFilter === 'ALL') return true;
        return String(itemCompany).includes(app.currentAdminCompanyFilter);
    },

    calculateSummaryStats: () => {
        const todayStr = app.getSafeTodayString();
        const monthStr = todayStr.substring(0, 7);
        const validMileages = (app.rawDb.mileages || []).filter(r => app.matchCompany(r.company));

        const tRec = validMileages.filter(r => app.formatDateStr(r.date) === todayStr);
        const mRec = validMileages.filter(r => app.formatDateStr(r.date).startsWith(monthStr));

        const todayDrivers = new Set(tRec.map(r=>r.phone)).size;
        const todayDist = tRec.reduce((s,r)=>s+Number(r.distance),0);
        const todayCost = tRec.reduce((s,r)=>s+Number(r.fuel_cost),0);

        const monthDrivers = new Set(mRec.map(r=>r.phone)).size;
        const monthDist = mRec.reduce((s,r)=>s+Number(r.distance),0);
        const monthCost = mRec.reduce((s,r)=>s+Number(r.fuel_cost),0);
        
        const totalDrivers = (app.rawDb.drivers || []).filter(d => d.role === 'driver' && app.matchCompany(d.company)).length;

        if (document.getElementById('vTodayDrivers')) document.getElementById('vTodayDrivers').innerText = `${todayDrivers}명`;
        if (document.getElementById('vTodayDist')) document.getElementById('vTodayDist').innerText = `${todayDist.toLocaleString()} km`;
        if (document.getElementById('vTodayCost')) document.getElementById('vTodayCost').innerText = `${todayCost.toLocaleString()} 원`;
        if (document.getElementById('vTotalDrivers')) document.getElementById('vTotalDrivers').innerText = `${totalDrivers}명`;
        if (document.getElementById('vMonthDrivers')) document.getElementById('vMonthDrivers').innerText = `${monthDrivers}명`;
        if (document.getElementById('vMonthDist')) document.getElementById('vMonthDist').innerText = `${monthDist.toLocaleString()} km`;
        if (document.getElementById('vMonthCost')) document.getElementById('vMonthCost').innerText = `${monthCost.toLocaleString()} 원`;
    },

    renderAdvancedCharts: () => {
        const todayStr = app.getSafeTodayString();
        const todayDate = new Date(todayStr);
        const getPastDateStr = (days) => {
            const d = new Date(todayDate);
            d.setDate(d.getDate() - days);
            return d.toISOString().substring(0, 10);
        };
        
        const d7Str = getPastDateStr(7);
        const d30Str = getPastDateStr(30);
        const d56Str = getPastDateStr(56);
        
        const validMileages = (app.rawDb.mileages || []).filter(r => app.matchCompany(r.company));

        let todayCost = 0;
        let past7TotalCost = 0;
        const driverStats30 = {}; 
        
        const weekdayStats = {0: {sum:0}, 1:{sum:0}, 2:{sum:0}, 3:{sum:0}, 4:{sum:0}, 5:{sum:0}, 6:{sum:0}};
        const weekdayDates = {0: new Set(), 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set(), 5: new Set(), 6: new Set()};

        validMileages.forEach(m => {
            const dStr = app.formatDateStr(m.date);
            const cost = Number(m.fuel_cost) || 0;
            const dObj = new Date(dStr);
            const dayOfWeek = dObj.getDay();

            if (dStr === todayStr) {
                todayCost += cost;
                if(!driverStats30[m.phone]) driverStats30[m.phone] = {name: m.name, total30:0, dates30: new Set(), today:0};
                driverStats30[m.phone].today += cost;
            }

            if (dStr >= d7Str && dStr < todayStr) {
                past7TotalCost += cost;
            }

            if (dStr >= d30Str && dStr < todayStr) {
                if(!driverStats30[m.phone]) driverStats30[m.phone] = {name: m.name, total30:0, dates30: new Set(), today:0};
                driverStats30[m.phone].total30 += cost;
                driverStats30[m.phone].dates30.add(dStr);
            }

            if (dStr >= d56Str && dStr <= todayStr) {
                weekdayStats[dayOfWeek].sum += cost;
                weekdayDates[dayOfWeek].add(dStr);
            }
        });

        const abnormalDrivers = [];
        Object.values(driverStats30).forEach(st => {
            if (st.today > 0 && st.dates30.size > 0) {
                const avg30 = Math.round(st.total30 / st.dates30.size);
                if (avg30 > 0) {
                    const increaseRate = ((st.today - avg30) / avg30) * 100;
                    if (increaseRate >= 30) { 
                        abnormalDrivers.push({ name: st.name, avg: avg30, today: st.today, rate: Math.round(increaseRate) });
                    }
                }
            }
        });
        abnormalDrivers.sort((a,b) => b.rate - a.rate);

        const avg7 = Math.round(past7TotalCost / 7);
        let overallRate = 0;
        if (avg7 > 0) overallRate = Math.round(((todayCost - avg7) / avg7) * 100);
        
        const displayOrder = [1, 2, 3, 4, 5, 6, 0]; 
        const wdNames = ['일', '월', '화', '수', '목', '금', '토'];
        const wdChartLabels = ['월', '화', '수', '목', '금', '토', '일'];
        
        let maxWdVal = -1; let maxWdName = '-';
        const wdChartData = displayOrder.map(dayIdx => {
            const daysCount = weekdayDates[dayIdx].size || 1; 
            const avg = Math.round(weekdayStats[dayIdx].sum / daysCount);
            if(avg > maxWdVal) { maxWdVal = avg; maxWdName = wdNames[dayIdx]; }
            return avg;
        });

        const aiBox = document.getElementById('aiAlertBox');
        if(abnormalDrivers.length > 0 || overallRate > 30) {
            aiBox.className = 'p-4 mb-3 rounded-4 border border-danger bg-danger-subtle text-center';
            document.getElementById('aiAlertTitle').innerHTML = `<i class="bi bi-exclamation-triangle-fill text-danger"></i> 유류비 이상 발생`;
            document.getElementById('aiAlertTitle').classList.add('text-danger');
            document.getElementById('aiAlertDesc').innerHTML = `최근 7일 대비 유류비가 <b>${overallRate > 0 ? '+'+overallRate : overallRate}%</b> 변동했습니다.<br>이상 사용 기사 <b>${abnormalDrivers.length}명</b>이 발견되었습니다.`;
        } else {
            aiBox.className = 'p-4 mb-3 rounded-4 border border-success bg-success-subtle text-center';
            document.getElementById('aiAlertTitle').innerHTML = `<i class="bi bi-check-circle-fill text-success"></i> 정상 작동 중`;
            document.getElementById('aiAlertTitle').classList.remove('text-danger');
            document.getElementById('aiAlertTitle').classList.add('text-success');
            document.getElementById('aiAlertDesc').innerHTML = `현재 감지된 유류비 특이사항이 없습니다.`;
        }
        
        document.getElementById('ai7DayRate').innerText = `${overallRate > 0 ? '+'+overallRate : overallRate}%`;
        document.getElementById('ai7DayRate').className = overallRate > 15 ? 'fw-bold mb-0 text-danger' : 'fw-bold mb-0 text-dark';
        document.getElementById('ai7DayBadge').innerText = overallRate > 30 ? '위험' : (overallRate > 15 ? '경고' : '정상');

        document.getElementById('aiAbnormalCount').innerText = `${abnormalDrivers.length}명`;
        document.getElementById('aiAbnormalCount').className = abnormalDrivers.length > 0 ? 'fw-bold mb-0 text-danger' : 'fw-bold mb-0 text-dark';
        document.getElementById('aiAbnormalBadge').innerText = abnormalDrivers.length > 0 ? '위험' : '정상';

        document.getElementById('aiDayPattern').innerText = `${maxWdName}요일 급증`;

        document.getElementById('abnormalBadgeTitle').innerText = abnormalDrivers.length > 0 ? `위험 ${abnormalDrivers.length}건` : `특이사항 없음`;
        const abTbody = document.getElementById('abnormalDriverBody');
        abTbody.innerHTML = '';
        if(abnormalDrivers.length === 0) {
            abTbody.innerHTML = `<tr><td colspan="5" class="text-muted py-4">이상 유류비 내역이 없습니다.</td></tr>`;
        } else {
            abnormalDrivers.slice(0, 5).forEach(d => {
                const badgeInfo = d.rate >= 50 ? `<span class="badge bg-danger-subtle text-danger border border-danger">위험</span>` : `<span class="badge bg-warning-subtle text-warning border border-warning">주의</span>`;
                abTbody.innerHTML += `<tr>
                    <td class="fw-bold">${app.escapeXSS(d.name)}</td>
                    <td class="text-muted">${d.avg.toLocaleString()}원</td>
                    <td class="fw-bold text-dark">${d.today.toLocaleString()}원</td>
                    <td class="fw-bold ${d.rate >= 50 ? 'text-danger' : 'text-warning'}">+${d.rate}%</td>
                    <td>${badgeInfo}</td>
                </tr>`;
            });
        }

        document.getElementById('avg7DayCost').innerText = `${avg7.toLocaleString()}원`;
        document.getElementById('todayCostDisp').innerText = `${todayCost.toLocaleString()}원`;
        document.getElementById('increaseRateBadge').innerText = `${overallRate > 0 ? '+'+overallRate : overallRate}%`;
        
        let colorTheme = '#05cd99'; 
        if(overallRate > 50) { colorTheme = '#dc3545'; document.getElementById('increaseRateBadge').className = 'badge fs-6 rounded-pill bg-danger'; } 
        else if (overallRate > 30) { colorTheme = '#fd7e14'; document.getElementById('increaseRateBadge').className = 'badge fs-6 rounded-pill bg-orange'; document.getElementById('increaseRateBadge').style.backgroundColor = '#fd7e14'; } 
        else if (overallRate > 15) { colorTheme = '#ffc107'; document.getElementById('increaseRateBadge').className = 'badge fs-6 rounded-pill bg-warning text-dark'; } 
        else { document.getElementById('increaseRateBadge').className = 'badge fs-6 rounded-pill bg-success'; }
        
        document.getElementById('chartCenterText').innerText = `${overallRate > 0 ? '+'+overallRate : overallRate}%`;
        document.getElementById('chartCenterText').style.color = colorTheme;

        const ctxInc = document.getElementById('cChartIncrease')?.getContext('2d');
        if(ctxInc) {
            if(app.charts['cChartIncrease']) app.charts['cChartIncrease'].destroy();
            const fillVal = Math.min(Math.abs(overallRate), 100);
            app.charts['cChartIncrease'] = new Chart(ctxInc, {
                type: 'doughnut',
                data: { datasets:[{ data: [fillVal, 100 - fillVal], backgroundColor:[colorTheme, '#e9ecef'], borderWidth: 0 }] },
                options: { cutout: '75%', responsive: true, maintainAspectRatio: false, plugins: { tooltip: { enabled: false } }, animation: { animateScale: true } }
            });
        }

        document.getElementById('weekdayInsightText').innerHTML = `<i class="bi bi-info-circle-fill me-1"></i> <b>${maxWdName}요일</b>의 평균 유류비가 가장 높게 나타납니다.`;
        
        const ctxWd = document.getElementById('cChartWeekday')?.getContext('2d');
        if(ctxWd) {
            if(app.charts['cChartWeekday']) app.charts['cChartWeekday'].destroy();
            const bgColors = wdChartData.map(val => val === maxWdVal ? '#dc3545' : '#b19cd9');
            
            app.charts['cChartWeekday'] = new Chart(ctxWd, {
                type: 'bar',
                data: { labels: wdChartLabels, datasets:[{ data: wdChartData, backgroundColor: bgColors, borderRadius: 4 }] },
                options: { 
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } }
                }
            });
        }
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

    openCompanyModal: () => {
        const ul = document.getElementById('ulMasterCompanies');
        ul.innerHTML = '';
        (app.rawDb.masterCompanies || []).forEach(c => {
            const badgeClass = c.status === 'active' ? 'bg-success' : 'bg-secondary';
            const statusTxt = c.status === 'active' ? '활성' : '비활성';
            ul.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center">
                <span class="fw-bold text-dark">${app.escapeXSS(c.name)}</span>
                <div>
                    <span class="badge ${badgeClass} me-2">${statusTxt}</span>
                    <button class="btn btn-sm btn-outline-dark py-0" onclick="app.toggleCompanyStatus('${app.escapeXSS(c.name)}', '${c.status}')">상태변경</button>
                </div>
            </li>`;
        });
        new bootstrap.Modal(document.getElementById('mdlCompany')).show();
    },

    addMasterCompany: async () => {
        const name = document.getElementById('mNewCompanyName').value.trim();
        if(!name) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'addMasterCompany', companyName: name });
        app.showLoading(false);
        if(res) {
            document.getElementById('mNewCompanyName').value = '';
            bootstrap.Modal.getInstance(document.getElementById('mdlCompany')).hide();
            app.loadAdminDashboardData();
        }
    },

    toggleCompanyStatus: async (compName, currentStatus) => {
        app.showLoading(true);
        await app.fetchAPI({ action: 'toggleCompanyStatus', companyName: compName, status: currentStatus });
        app.showLoading(false);
        bootstrap.Modal.getInstance(document.getElementById('mdlCompany')).hide();
        app.loadAdminDashboardData();
    },

    populateFuelRateCompanySelect: () => {
        const compSelect = document.getElementById('mFuelRateCompany');
        compSelect.innerHTML = '';
        if(app.user.role === 'admin') {
            compSelect.innerHTML += '<option value="">전체 공통 (기본값)</option>';
            (app.rawDb.masterCompanies || []).forEach(c => compSelect.innerHTML += `<option value="${c.name}">${c.name}</option>`);
        } else {
            compSelect.innerHTML += `<option value="${app.user.company}">${app.user.company}</option>`;
        }
    },

    openFuelRateModal: () => {
        app.populateFuelRateCompanySelect();
        document.getElementById('mFuelRateMonth').value = app.getSafeTodayString().substring(0, 7);
        document.getElementById('mFuelRateMonth').removeAttribute('readonly');
        document.getElementById('mFuelRateVal').value = 200;
        new bootstrap.Modal(document.getElementById('mdlFuelRate')).show();
    },

    openEditFuelRateModal: (month, company, rate) => {
        app.populateFuelRateCompanySelect();
        document.getElementById('mFuelRateMonth').value = month;
        document.getElementById('mFuelRateCompany').value = company || '';
        document.getElementById('mFuelRateVal').value = rate;
        document.getElementById('mFuelRateMonth').setAttribute('readonly', true);
        new bootstrap.Modal(document.getElementById('mdlFuelRate')).show();
    },

    handleFuelRateSubmit: async (e) => {
        e.preventDefault();
        const month = document.getElementById('mFuelRateMonth').value;
        const company = document.getElementById('mFuelRateCompany').value;
        const rate = document.getElementById('mFuelRateVal').value;
        bootstrap.Modal.getInstance(document.getElementById('mdlFuelRate')).hide();
        app.showLoading(true);
        await app.fetchAPI({ action: 'updateFuelRate', month, company, fuel_rate: rate });
        app.loadAdminDashboardData();
    },

    renderFuelRateTable: () => {
        const tbody = document.getElementById('tblFuelRateBody');
        if(!tbody) return;
        tbody.innerHTML = '';
        (app.rawDb.fuelRatesList || []).forEach(r => {
            const isGlobal = !r.company;
            const canEdit = app.user.role === 'admin' || (app.user.role === 'manager' && app.user.company === r.company);
            
            let actionBtns = '-';
            if (canEdit) {
                actionBtns = `
                    <button class="btn btn-sm btn-outline-primary py-0 px-2 me-1" onclick="app.openEditFuelRateModal('${r.month}', '${r.company || ''}', ${r.rate})">수정</button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="app.deleteFuelRateProcess('${r.month}', '${r.company || ''}')">삭제</button>
                `;
            }

            tbody.innerHTML += `<tr>
                <td>${r.month}</td>
                <td><span class="badge bg-secondary">${r.company || '전체 공통 (기본값)'}</span></td>
                <td class="fw-bold text-danger">${r.rate}원</td>
                <td class="text-center">${actionBtns}</td>
            </tr>`;
        });
    },

    deleteFuelRateProcess: async (month, company) => {
        if(!confirm('해당 단가 설정을 삭제하시겠습니까?')) return;
        app.showLoading(true);
        await app.fetchAPI({ action: 'deleteFuelRate', month, company });
        app.loadAdminDashboardData();
    },

    renderUnsubmittedTable: () => {
        const dateFilter = document.getElementById('unsubmittedDateFilter').value;
        const tbody = document.getElementById('tblUnsubmittedBody');
        if(!tbody) return;
        const drivers = (app.rawDb.drivers || []).filter(d => d.role === 'driver');
        const mileages = app.rawDb.mileages || [];
        const submittedPhones = new Set(mileages.filter(m => app.formatDateStr(m.date) === dateFilter).map(m => String(m.phone)));
        
        let html = '';
        drivers.forEach(d => {
            if(!submittedPhones.has(String(d.phone)) && app.matchCompany(d.company)) {
                html += `<tr><td>${app.escapeXSS(d.name)}</td><td>${d.phone}</td><td>${app.escapeXSS(d.car_number)}</td><td>${app.escapeXSS(d.company)}</td><td><span class="badge bg-danger">미입력</span></td></tr>`;
            }
        });
        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center text-muted">해당 날짜에 미입력한 기사가 없습니다.</td></tr>';
    },

    applyMonthlySearch: () => {
        const fStart = document.getElementById('searchMonthlyStartDate').value;
        const fEnd = document.getElementById('searchMonthlyEndDate').value;
        const tbody = document.getElementById('tblMonthlyRecordsBody');
        if(!tbody) return;
        
        const mileages = (app.rawDb.mileages || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            const d = app.formatDateStr(r.date);
            if (fStart && d < fStart) return false;
            if (fEnd && d > fEnd) return false;
            return true;
        });

        const stats = {};
        
        mileages.forEach(m => {
            if(!stats[m.phone]) stats[m.phone] = { name: m.name, car_number: m.car_number, company: m.company, days: new Set(), dist: 0, cost: 0, toll: 0, visits: 0 };
            stats[m.phone].days.add(app.formatDateStr(m.date));
            stats[m.phone].dist += Number(m.distance) || 0;
            stats[m.phone].cost += Number(m.fuel_cost) || 0;
            stats[m.phone].toll += Number(m.toll_fee) || 0; 
        });

        const validLocs = (app.rawDb.locations || []).filter(l => {
            if (!app.matchCompany(l.company)) return false; 
            const d = app.formatDateStr(l.date);
            if (fStart && d < fStart) return false;
            if (fEnd && d > fEnd) return false;
            return true;
        });

        validLocs.forEach(l => {
            if(!stats[l.phone]) {
                const dInfo = (app.rawDb.drivers || []).find(d => d.phone === l.phone) || {name: l.name, car_number: '미등록'};
                stats[l.phone] = { name: dInfo.name, car_number: dInfo.car_number, company: l.company, days: new Set(), dist: 0, cost: 0, toll: 0, visits: 0 };
            }
            stats[l.phone].visits++;
            stats[l.phone].days.add(app.formatDateStr(l.date)); 
        });

        let html = '';
        Object.values(stats).forEach(s => {
            html += `<tr><td>${app.escapeXSS(s.name)}</td><td><span class="badge bg-light text-dark border">${app.escapeXSS(s.car_number)}</span></td><td>${app.escapeXSS(s.company)}</td><td>${s.days.size}일</td><td class="fw-bold text-success">${s.visits}곳</td><td class="fw-bold text-primary">${s.dist.toLocaleString()} km</td><td class="fw-bold text-danger">${s.cost.toLocaleString()} 원</td><td class="fw-bold text-secondary">${s.toll.toLocaleString()} 원</td></tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="8" class="text-center text-muted">해당 기간의 검색 결과가 없습니다.</td></tr>';
    },

    applyDailySearch: () => {
        const fMonth = document.getElementById('searchDailyMonth').value; 
        const fStart = document.getElementById('searchDailyStartDate').value;
        const fEnd = document.getElementById('searchDailyEndDate').value;
        const fKeyword = document.getElementById('searchDailyKeyword').value.trim().toLowerCase();
        const tbody = document.getElementById('tblDailyRecordsBody');
        if(!tbody) return;

        app.filteredDailyMileages = (app.rawDb.mileages || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            const d = app.formatDateStr(r.date);
            if (fMonth && !d.startsWith(fMonth)) return false;
            if (fStart && d < fStart) return false;
            if (fEnd && d > fEnd) return false;
            if (fKeyword && !String(r.name).toLowerCase().includes(fKeyword)) return false;
            return true;
        }).sort((a,b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        if(app.filteredDailyMileages.length === 0) { tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">결과가 없습니다.</td></tr>'; return; }

        app.filteredDailyMileages.forEach(r => {
            let evidenceBtn = `-`;
            if(r.evidence_url) {
                evidenceBtn = r.evidence_url.split(',').map((url, idx) => `<a href="${url.trim()}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0 me-1">사진${idx+1}</a>`).join('');
            }
            
            const visitCount = (app.rawDb.locations || []).filter(l => l.date === app.formatDateStr(r.date) && l.phone === r.phone && l.company === r.company).length;
            const visitBadge = visitCount > 0 ? `<button class="btn btn-sm btn-outline-success rounded-pill px-2 py-0 fw-bold" onclick="app.openRouteModal('${app.formatDateStr(r.date)}', '${r.phone}', '${r.company}', '${r.name}')">${visitCount}곳 <i class="bi bi-search"></i></button>` : `<span class="text-muted small">-</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${app.formatDateStr(r.date)}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="text-muted small">${r.start_distance}km → ${r.end_distance}km</td>
                <td class="fw-bold text-primary">${Number(r.distance).toLocaleString()} km</td>
                <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                <td class="fw-bold text-secondary">${Number(r.toll_fee).toLocaleString()} 원</td>
                <td class="text-center">${visitBadge}</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center"><button class="btn btn-outline-danger btn-sm" onclick="app.deleteDailyProcess('${app.formatDateStr(r.date)}', '${r.phone}', '${r.company}', '${r.name}')">삭제</button></td>
            `;
            tbody.appendChild(tr);
        });
    },

    // ⭐️ [버그 완전 해결] 구글 맵의 연속 경로(선)를 그리기 위한 URL 정밀 세팅 로직
    openRouteModal: (dateStr, phone, company, name) => {
        const locs = (app.rawDb.locations || []).filter(l =>
            app.formatDateStr(l.date) === dateStr &&
            l.phone === phone &&
            l.company === company
        ).sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));

        document.getElementById('mRouteTitle').innerText = `${name} 기사님 동선 (${dateStr})`;
        const tlContainer = document.getElementById('mRouteTimeline');
        tlContainer.innerHTML = '';

        if (locs.length === 0) {
            tlContainer.innerHTML = '<p class="text-center text-muted mt-3">기록된 동선이 없습니다.</p>';
            document.getElementById('btnOpenGoogleMap').classList.add('d-none');
            new bootstrap.Modal(document.getElementById('mdlRouteMap')).show();
            return;
        }

        document.getElementById('btnOpenGoogleMap').classList.remove('d-none');

        // ⭐️ 정밀 수정: 배열에 있는 좌표들을 '/'로 엮어 구글 맵 공식 길찾기(Directions) 연동 형식으로 변환
        const pathCoords = locs.map(l => `${l.lat},${l.lng}`).join('/');
        const dirUrl = `https://www.google.com/maps/dir/${pathCoords}`;

        locs.forEach((l, idx) => {
            tlContainer.innerHTML += `
                <div class="d-flex align-items-start mb-3">
                    <div class="d-flex flex-column align-items-center me-3">
                        <span class="badge bg-danger rounded-circle p-2">${idx+1}</span>
                        ${idx < locs.length -1 ? '<div class="border-start border-danger border-2 h-100 my-1" style="min-height: 20px;"></div>' : ''}
                    </div>
                    <div>
                        <p class="mb-0 fw-bold text-dark">${l.timestamp.substring(11, 16)}</p>
                        <p class="mb-0 small text-muted">${app.escapeXSS(l.address)}</p>
                    </div>
                </div>
            `;
        });

        // 수정한 완벽한 경로 추적 URL을 지도 버튼에 탑재
        document.getElementById('btnOpenGoogleMap').href = dirUrl;
        new bootstrap.Modal(document.getElementById('mdlRouteMap')).show();
    },

    applyLocationSearch: () => {
        const fDate = document.getElementById('searchLocationDate').value; 
        const fCompany = document.getElementById('searchLocationCompany')?.value || 'ALL'; 
        const fKeyword = document.getElementById('searchLocationKeyword').value.trim().toLowerCase();
        const tbody = document.getElementById('tblLocationBody');
        if(!tbody) return;

        app.filteredLocations = (app.rawDb.locations || []).filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            if (fCompany !== 'ALL' && !String(r.company).includes(fCompany)) return false; 
            if (fDate && r.date !== fDate) return false;
            if (fKeyword && !String(r.name).toLowerCase().includes(fKeyword)) return false;
            return true;
        }).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

        tbody.innerHTML = '';
        if(app.filteredLocations.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">해당 날짜에 전송된 위치 기록이 없습니다.</td></tr>'; return; }

        const visits = {};
        app.filteredLocations.forEach(r => {
            if(!visits[r.phone]) visits[r.phone] = 0;
            visits[r.phone]++;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.timestamp.substring(11, 19)}</td> 
                <td class="fw-bold">${app.escapeXSS(r.name)} <span class="badge bg-light text-dark ms-1">${visits[r.phone]}회차</span></td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="text-dark small fw-bold">${app.escapeXSS(r.address)}</td>
                <td class="text-center"><a href="${r.map_url}" target="_blank" class="btn btn-sm btn-outline-danger px-3 rounded-pill"><i class="bi bi-geo-alt-fill"></i> 구글 맵</a></td>
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
                <td><span class="badge ${r.type==='도로비'?'bg-secondary':'bg-primary'}">${r.type || '주유비'}</span></td>
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
        if(!confirm(`해당 지출 내역 영수증을 삭제하시겠습니까?`)) return;
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
            if (app.user.role === 'admin') {
                (app.rawDb.masterCompanies || []).forEach(c => opts += `<option value="${c.name}">${c.name}</option>`);
            } else {
                opts = `<option value="${app.user.company}">${app.user.company}</option>`;
            }
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
            if (app.user.role === 'admin') {
                (app.rawDb.masterCompanies || []).forEach(c => {
                    opts += `<option value="${c.name}" ${d.company.includes(c.name) ? 'selected':''}>${c.name}</option>`;
                });
            } else {
                opts = `<option value="${app.user.company}" selected>${app.user.company}</option>`;
            }
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
            let res = await app.fetchAPI({ action: 'addDriver', name, phone, car_number, company, password_hash: '0000' });
            if (res && res.exists) {
                app.showLoading(false);
                if (confirm(`해당 기사님(${res.driverName})은 이미 다른 화주사(${res.existingCompany})에 등록되어 있습니다.\n\n[${company}] 화주사에 추가로 소속시키시겠습니까?`)) {
                    app.showLoading(true);
                    await app.fetchAPI({ action: 'addCompanyToExistingDriver', phone: phone, company: company });
                    alert('성공적으로 다중 소속 처리되었습니다.');
                } else {
                    return; 
                }
            } else if (res) {
                alert('기사 등록이 완료되었습니다.');
            }
        } else {
            await app.fetchAPI({ action: 'updateDriver', originPhone, name, phone, car_number, company });
            alert('기사 정보가 수정되었습니다.');
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

    downloadDailyExcel: () => {
        let html = `<table border="1"><thead><tr><th>날짜</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>출발계기판</th><th>도착계기판</th><th>실제거리</th><th>정산유류비</th><th>도로비</th></tr></thead><tbody>`;
        (app.filteredDailyMileages || []).forEach(r => {
            html += `<tr><td>${app.formatDateStr(r.date)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.start_distance}</td><td>${r.end_distance}</td><td>${r.distance}</td><td>${r.fuel_cost}</td><td>${r.toll_fee}</td></tr>`;
        });
        html += '</tbody></table>';
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", "일별운행기록.xls"); link.click();
    },

    downloadReceiptExcel: () => {
        let html = `<table border="1"><thead><tr><th>날짜</th><th>기사명</th><th>전화번호</th><th>화주사</th><th>구분</th><th>금액</th></tr></thead><tbody>`;
        (app.filteredAdminReceipts || []).forEach(r => {
            html += `<tr><td>${app.formatDateStr(r.date)}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.company}</td><td>${r.type}</td><td>${r.amount}</td></tr>`;
        });
        html += '</tbody></table>';
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
        link.setAttribute("download", "지출영수증내역.xls"); link.click();
    }
};
window.onload = app.init;
