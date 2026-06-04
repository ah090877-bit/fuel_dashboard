// 🚨 알려주신 구글 웹앱 주소
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzFBx-WmI3BDm3GwqR6O0AF3a9lj-9LjmXp1ZTk-yL97znfSniJ1_kixxVuDl0Hjar0/exec';

const app = {
    user: JSON.parse(localStorage.getItem('fuelUser')) || null,
    loginTargetRole: '',
    rawDb: { drivers: [], fuelRatesList: [], history: [], mileages: [], masterCompanies: [] },
    filteredDailyMileages: [],
    filteredMonthlyMileages: [],
    charts: {},
    currentAdminCompanyFilter: 'ALL',

    init: () => {
        app.bindEvents();
        app.checkSession();
    },

    bindEvents: () => {
        document.getElementById('loginForm')?.addEventListener('submit', app.handleLogin);
        document.getElementById('changePasswordForm')?.addEventListener('submit', app.handleChangePasswordSubmit);
        document.getElementById('mileageForm')?.addEventListener('submit', app.handleMileageSubmit);
        document.getElementById('frmDriver')?.addEventListener('submit', app.handleDriverFormSubmit);
        document.getElementById('frmFuelRate')?.addEventListener('submit', app.handleFuelRateSubmit);
        document.getElementById('frmEditDaily')?.addEventListener('submit', app.handleEditDailySubmit);
        
        document.getElementById('driverMonthFilter')?.addEventListener('change', app.renderDriverRecords);
        document.getElementById('unsubmittedDateFilter')?.addEventListener('change', app.renderUnsubmittedTable);
        
        document.getElementById('adminCompanyFilter')?.addEventListener('change', app.refreshAdminViews);
        document.getElementById('mFuelRateCompany')?.addEventListener('change', app.syncFuelRateValue);
        document.getElementById('mFuelRateMonth')?.addEventListener('change', app.syncFuelRateValue);

        const tabElList = [].slice.call(document.querySelectorAll('#adminTabs button'));
        tabElList.forEach(tabEl => {
            tabEl.addEventListener('shown.bs.tab', (e) => {
                if (e.target.id === 'tab-dash') app.renderCharts();
                if (e.target.id === 'tab-unsubmitted') {
                    document.getElementById('unsubmittedDateFilter').value = new Date().toLocaleDateString('sv-SE');
                    app.renderUnsubmittedTable();
                }
                if (e.target.id === 'tab-fuelrate') app.renderFuelRateTable();
            });
        });
    },

    checkSession: () => {
        if (app.user) {
            if (app.user.requirePasswordChange) app.route('change-password');
            else app.route(app.user.role);
        } else {
            app.route('login');
        }
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
        document.getElementById('loginPhone').value = '';
        document.getElementById('loginPw').value = '';
    },

    route: (target) => {
        document.querySelectorAll('.view-section').forEach(el => {
            el.classList.remove('active');
            el.classList.add('d-none');
        });

        if (target === 'login') {
            document.getElementById('view-login').classList.remove('d-none');
            document.getElementById('view-login').classList.add('active');
            app.hideLoginForm();
        } else if (target === 'change-password') {
            document.getElementById('view-change-password').classList.remove('d-none');
            document.getElementById('view-change-password').classList.add('active');
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
        return String(str).replace(/[&<>"']/g, (m) => {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
            return map[m];
        });
    },

    hashPassword: async (password) => {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // 단일 사진 압축 함수
    compressImage: async (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800; 
                    let width = img.width;
                    let height = img.height;
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.6).split(',')[1]); 
                };
                img.onerror = () => reject(new Error('이미지 처리 실패'));
            };
            reader.onerror = () => reject(new Error('파일 읽기 실패'));
        });
    },

    fetchAPI: async (payload) => {
        try {
            const response = await fetch(GAS_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                redirect: 'follow' 
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            return result.data;
        } catch (error) {
            alert("서버 연결 오류: " + error.message);
            return null;
        }
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
            if (app.loginTargetRole === 'driver' && data.role !== 'driver') return alert('기사 계정이 아닙니다.');
            if (app.loginTargetRole === 'admin' && data.role === 'driver') return alert('관리자 계정이 아닙니다.');

            localStorage.setItem('fuelUser', JSON.stringify(data));
            app.user = data;
            
            if (data.requirePasswordChange) app.route('change-password');
            else app.route(data.role);
        }
    },

    handleChangePasswordSubmit: async (e) => {
        e.preventDefault();
        const newPw = document.getElementById('newPw').value.trim();
        const newPwConfirm = document.getElementById('newPwConfirm').value.trim();

        if (newPw !== newPwConfirm) return alert('비밀번호가 불일치합니다.');
        if (newPw === '0000') return alert('초기 비밀번호(0000)는 사용할 수 없습니다.');

        app.showLoading(true);
        const hashedPassword = await app.hashPassword(newPw);
        const data = await app.fetchAPI({ action: 'changePassword', phone: app.user.phone, new_password_hash: hashedPassword });
        app.showLoading(false);

        if (data) {
            alert('비밀번호가 안전하게 변경되었습니다. 보안을 위해 변경된 비밀번호로 다시 로그인해 주세요.');
            app.logout();
        }
    },

    logout: () => {
        localStorage.removeItem('fuelUser');
        app.user = null;
        app.route('login');
    },

    initDriverView: () => {
        app.cancelDriverEdit(); 
        document.getElementById('driverGreeting').innerHTML = `이름: <b class="text-primary">${app.escapeXSS(app.user.name)}</b> 기사님`;
        document.getElementById('driverCarBadge').innerText = app.escapeXSS(app.user.car_number);

        const compSelect = document.getElementById('inputCompany');
        compSelect.innerHTML = '';
        
        const activeComps = app.user.activeCompanies || [];
        const myCompanies = (app.user.company || "").split(',').map(c => c.trim()).filter(c => c && activeComps.includes(c));
        
        if (myCompanies.length === 0) {
            compSelect.innerHTML = '<option value="">선택가능한 화주사가 없습니다. (운영중단 또는 미배정)</option>';
        } else {
            myCompanies.forEach(c => {
                compSelect.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
            });
        }

        const currentMonthStr = new Date().toISOString().substring(0, 7);
        document.getElementById('driverMonthFilter').value = currentMonthStr;
        app.renderDriverRecords();
    },

    renderDriverRecords: () => {
        const selectedMonth = document.getElementById('driverMonthFilter').value;
        const records = app.user.driverRecords || [];
        
        let totalDistance = 0;
        let totalCost = 0;
        let validRecords = [];

        records.forEach(r => {
            const rMonth = new Date(r.date).toLocaleDateString('sv-SE').substring(0, 7);
            if (rMonth === selectedMonth) {
                validRecords.push(r);
                totalDistance += Number(r.distance) || 0;
                totalCost += Number(r.fuel_cost) || 0;
            }
        });

        const tbody = document.getElementById('tblDriverMonthBody');
        tbody.innerHTML = '';

        if(validRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted small py-3">해당 월의 운행 기록이 없습니다.</td></tr>';
        } else {
            validRecords.sort((a,b) => new Date(b.date) - new Date(a.date));
            validRecords.forEach(r => {
                const rowDateStr = new Date(r.date).toLocaleDateString('sv-SE');
                let evidenceBtn = `<span class="text-muted small">없음</span>`;
                if (r.evidence_url) {
                    const urls = r.evidence_url.split(',');
                    evidenceBtn = urls.map((url, idx) => `<a href="${url.trim()}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill px-2 py-0 me-1 mb-1"><i class="bi bi-image"></i> 사진${idx+1}</a>`).join('');
                }

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="small">${new Date(r.date).toLocaleDateString('ko-KR', {month:'2-digit', day:'2-digit'})}</td>
                    <td class="small text-muted">${app.escapeXSS(r.company)}</td>
                    <td class="fw-bold text-dark">${Number(r.distance).toLocaleString()} km</td>
                    <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                    <td class="text-center">${evidenceBtn}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary py-0 px-2 rounded-1" onclick="app.setupDriverEdit('${rowDateStr}', '${app.escapeXSS(r.company)}', '${r.distance}')">수정</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        document.getElementById('dStatDistance').innerText = `${totalDistance.toLocaleString()} km`;
        document.getElementById('dStatCost').innerText = `${totalCost.toLocaleString()} 원`;
        document.getElementById('dStatDays').innerText = `${validRecords.length}건`;
    },

    setupDriverEdit: (date, company, distance) => {
        document.getElementById('inputDate').value = date;
        document.getElementById('inputCompany').value = company;
        document.getElementById('inputDistance').value = distance;
        
        document.getElementById('hdnDriverEditMode').value = "true";
        document.getElementById('driverFormTitle').innerHTML = '<i class="bi bi-pencil-fill"></i> 운행 기록 수정 모드';
        
        document.getElementById('lblEvidence').innerHTML = '<i class="bi bi-camera"></i> 계기판/영수증 증빙 (변경시에만 첨부)';
        document.getElementById('lblEvidence').classList.replace('text-danger', 'text-primary');
        document.getElementById('txtEvidenceHelp').innerText = '기존 사진을 유지하려면 파일을 첨부하지 마세요.';
        
        document.getElementById('btnSubmitMileage').innerHTML = '<i class="bi bi-check-circle"></i> 수정사항 저장';
        document.getElementById('btnSubmitMileage').classList.replace('w-100', 'w-75');
        document.getElementById('btnCancelEdit').classList.remove('d-none');
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    cancelDriverEdit: () => {
        document.getElementById('inputDate').value = new Date().toLocaleDateString('sv-SE');
        document.getElementById('inputDistance').value = '';
        document.getElementById('inputEvidence').value = '';
        
        document.getElementById('hdnDriverEditMode').value = "false";
        document.getElementById('driverFormTitle').innerHTML = '<i class="bi bi-pencil-square"></i> 주행거리 기록 및 증빙';
        
        document.getElementById('lblEvidence').innerHTML = '<i class="bi bi-camera-fill"></i> 계기판/영수증 증빙 (최대 4장)';
        document.getElementById('lblEvidence').classList.replace('text-primary', 'text-danger');
        document.getElementById('txtEvidenceHelp').innerText = '최초 등록 시 사진 첨부는 필수입니다. (최대 4장)';

        document.getElementById('btnSubmitMileage').innerHTML = '<i class="bi bi-cloud-arrow-up"></i> 등록하기';
        document.getElementById('btnSubmitMileage').classList.replace('w-75', 'w-100');
        document.getElementById('btnCancelEdit').classList.add('d-none');
    },

    // ⭐️ 중복 등록 방지 및 다중 사진(최대 4장) 처리 적용
    handleMileageSubmit: async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btnSubmitMileage');
        
        const date = document.getElementById('inputDate').value;
        const distance = parseInt(document.getElementById('inputDistance').value, 10);
        const company = document.getElementById('inputCompany').value;
        const fileInput = document.getElementById('inputEvidence');
        const isEditMode = document.getElementById('hdnDriverEditMode').value === "true";

        if (!company) return alert('기입 가능한 소속 화주사가 없습니다.');
        if (isNaN(distance) || distance <= 0) return alert('주행거리를 올바르게 입력하세요.');

        if (!isEditMode && fileInput.files.length === 0) {
            return alert('계기판이나 영수증 등 증빙 사진을 반드시 첨부해 주셔야 합니다.');
        }
        if (fileInput.files.length > 4) {
            return alert('사진은 한 번에 최대 4장까지만 첨부 가능합니다.');
        }

        // 제출 버튼 이중클릭 잠금
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> 처리중...';
        app.showLoading(true);

        const payload = {
            action: 'saveMileage', date, distance, phone: app.user.phone,
            name: app.user.name, car_number: app.user.car_number,
            company: company, isUpdate: isEditMode, edited_by: app.user.name,
            files: [] // 다중 파일 배열 생성
        };

        if (fileInput.files.length > 0) {
            try {
                for (let i = 0; i < fileInput.files.length; i++) {
                    const file = fileInput.files[i];
                    const base64 = await app.compressImage(file);
                    payload.files.push({ fileBase64: base64, mimeType: "image/jpeg" });
                }
            } catch (err) {
                app.showLoading(false);
                submitBtn.disabled = false;
                submitBtn.innerHTML = isEditMode ? '<i class="bi bi-check-circle"></i> 수정사항 저장' : '<i class="bi bi-cloud-arrow-up"></i> 등록하기';
                return alert("사진 처리 중 오류가 발생했습니다. 다른 사진을 선택해 주세요.");
            }
        }

        let res = await app.fetchAPI(payload);
        
        if (res === null) {
            if (confirm('해당 날짜에 이미 기록이 존재합니다.\n입력하신 거리(및 증빙)로 덮어쓰기 수정하시겠습니까?')) {
                payload.isUpdate = true;
                res = await app.fetchAPI(payload);
            }
        }

        app.showLoading(false);
        submitBtn.disabled = false;
        submitBtn.innerHTML = isEditMode ? '<i class="bi bi-check-circle"></i> 수정사항 저장' : '<i class="bi bi-cloud-arrow-up"></i> 등록하기';

        if (res) {
            alert('주행기록 및 증빙자료가 성공적으로 저장되었습니다.');
            app.cancelDriverEdit(); 
            
            const updatedRecords = await app.fetchAPI({ action: 'getDriverData', phone: app.user.phone });
            if (updatedRecords) {
                app.user.driverRecords = updatedRecords;
                localStorage.setItem('fuelUser', JSON.stringify(app.user));
                app.renderDriverRecords(); 
            }
        }
    },

    loadAdminDashboardData: async () => {
        app.showLoading(true);
        const data = await app.fetchAPI({ action: 'getAdminData', role: app.user.role, company: app.user.company });
        app.showLoading(false);
        if (data) {
            app.rawDb = data;
            app.populateAdminCompanyFilter();
            app.refreshAdminViews();
            app.resetDailySearch();
            const currentYearMonth = new Date().toISOString().substring(0, 7);
            document.getElementById('searchMonthlyMonth').value = currentYearMonth;
            app.applyMonthlySearch();
        }
    },

    populateAdminCompanyFilter: () => {
        const selectEl = document.getElementById('adminCompanyFilter');
        const badgeEl = document.getElementById('adminRoleBadge');
        
        const masterCompObj = app.rawDb.masterCompanies || [];
        const companies = new Set(masterCompObj.map(c => c.name));
        app.rawDb.drivers.forEach(d => { if(d.company) d.company.split(',').forEach(c => companies.add(c.trim())); });
        app.rawDb.mileages.forEach(m => { if(m.company) m.company.split(',').forEach(c => companies.add(c.trim())); });
        
        if (app.user.role === 'admin') {
            badgeEl.classList.add('d-none');
            selectEl.classList.remove('d-none');
            
            const currentVal = selectEl.value || 'ALL';
            selectEl.innerHTML = '<option value="ALL">전체 화주사 통합 조회</option>';
            Array.from(companies).filter(c=>c).sort().forEach(c => {
                selectEl.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
            });
            
            selectEl.value = Array.from(companies).includes(currentVal) ? currentVal : 'ALL';
            app.currentAdminCompanyFilter = selectEl.value;
        } else {
            selectEl.classList.add('d-none');
            badgeEl.classList.remove('d-none');
            badgeEl.innerText = `매니저 (${app.user.company})`;
            app.currentAdminCompanyFilter = app.user.company; 
        }

        const searchCompEl = document.getElementById('searchMonthlyCompany');
        if (searchCompEl) {
            searchCompEl.innerHTML = '<option value="ALL">전체 화주사</option>';
            if (app.user.role === 'admin') {
                Array.from(companies).filter(c=>c).sort().forEach(c => {
                    searchCompEl.innerHTML += `<option value="${app.escapeXSS(c)}">${app.escapeXSS(c)}</option>`;
                });
            } else {
                searchCompEl.innerHTML = `<option value="${app.escapeXSS(app.user.company)}">${app.escapeXSS(app.user.company)}</option>`;
                searchCompEl.value = app.user.company;
                searchCompEl.setAttribute('disabled', 'true'); 
            }
        }
    },

    refreshAdminViews: () => {
        if(app.user.role === 'admin') {
            app.currentAdminCompanyFilter = document.getElementById('adminCompanyFilter').value || 'ALL';
        }
        app.calculateSummaryStats();
        app.renderDriversTable();
        if (document.getElementById('tab-unsubmitted').classList.contains('active')) app.renderUnsubmittedTable();
        app.renderHistoryTable();
        app.applyDailySearch();
        app.applyMonthlySearch();
        if (document.getElementById('tab-fuelrate').classList.contains('active')) app.renderFuelRateTable();
        if(document.getElementById('tab-dash').classList.contains('active')) app.renderCharts();
    },

    matchCompany: (itemCompany) => {
        if (app.currentAdminCompanyFilter === 'ALL') return true;
        if (!itemCompany) return false;
        return String(itemCompany).includes(app.currentAdminCompanyFilter);
    },

    calculateSummaryStats: () => {
        const todayStr = new Date().toLocaleDateString('sv-SE');
        const monthStr = todayStr.substring(0, 7);

        const validDrivers = app.rawDb.drivers.filter(d => d.role === 'driver' && app.matchCompany(d.company));
        const validMileages = app.rawDb.mileages.filter(m => app.matchCompany(m.company));

        const todayRecords = validMileages.filter(r => new Date(r.date).toLocaleDateString('sv-SE') === todayStr);
        const todayDriverCount = new Set(todayRecords.map(r => r.phone)).size;
        const todayDist = todayRecords.reduce((sum, r) => sum + Number(r.distance), 0);
        const todayCost = todayRecords.reduce((sum, r) => sum + Number(r.fuel_cost), 0);

        const monthRecords = validMileages.filter(r => new Date(r.date).toLocaleDateString('sv-SE').substring(0, 7) === monthStr);
        const monthDriverCount = new Set(monthRecords.map(r => r.phone)).size;
        const monthDist = monthRecords.reduce((sum, r) => sum + Number(r.distance), 0);
        const monthCost = monthRecords.reduce((sum, r) => sum + Number(r.fuel_cost), 0);

        document.getElementById('vTodayDrivers').innerText = `${todayDriverCount}명`;
        document.getElementById('vTodayDist').innerText = `${todayDist.toLocaleString()} km`;
        document.getElementById('vTodayCost').innerText = `${todayCost.toLocaleString()} 원`;

        document.getElementById('vTotalDrivers').innerText = `${validDrivers.length}명`;
        document.getElementById('vMonthDrivers').innerText = `${monthDriverCount}명`;
        document.getElementById('vMonthDist').innerText = `${monthDist.toLocaleString()} km`;
        document.getElementById('vMonthCost').innerText = `${monthCost.toLocaleString()} 원`;
    },

    renderUnsubmittedTable: () => {
        const filterDate = document.getElementById('unsubmittedDateFilter').value;
        if(!filterDate) return;

        const validDrivers = app.rawDb.drivers.filter(d => d.role === 'driver' && app.matchCompany(d.company));
        const validMileages = app.rawDb.mileages.filter(m => app.matchCompany(m.company));

        const submittedPhones = new Set(validMileages.filter(r => new Date(r.date).toLocaleDateString('sv-SE') === filterDate).map(r => r.phone));
        const unsubmitted = validDrivers.filter(d => !submittedPhones.has(d.phone));
        
        const tbody = document.getElementById('tblUnsubmittedBody');
        tbody.innerHTML = '';

        if(unsubmitted.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">해당 일자의 미입력 기사가 없습니다.</td></tr>';
            return;
        }

        unsubmitted.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="fw-bold text-dark">${app.escapeXSS(d.name)}</td>
                <td>${app.escapeXSS(d.phone)}</td>
                <td><span class="badge bg-light text-dark border">${app.escapeXSS(d.car_number)}</span></td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(d.company) || '미배정'}</span></td>
                <td><span class="text-danger fw-bold"><i class="bi bi-x-circle"></i> 미제출</span></td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderDriversTable: () => {
        const tbody = document.getElementById('tblDriversBody');
        tbody.innerHTML = '';
        const drivers = app.rawDb.drivers.filter(d => d.role === 'driver' && app.matchCompany(d.company));

        if(drivers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">등록된 기사가 없습니다.</td></tr>';
            return;
        }

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

    openAddDriverModal: () => {
        document.getElementById('mdlDriverTitle').innerText = "기사 신규 등록";
        document.getElementById('hdnEditOriginPhone').value = "";
        document.getElementById('mDriverName').value = "";
        document.getElementById('mDriverPhone').value = "";
        document.getElementById('mDriverCar').value = "";
        
        const compInput = document.getElementById('mDriverCompany');
        compInput.innerHTML = '';
        
        const masterCompObj = app.rawDb.masterCompanies || [];
        if(app.user.role === 'manager') {
            compInput.innerHTML = `<option value="${app.user.company}">${app.user.company}</option>`;
            compInput.setAttribute('disabled', 'true');
        } else {
            if (masterCompObj.length === 0) {
               compInput.innerHTML = `<option value="">등록된 화주사가 없습니다. 세팅부터 해주세요.</option>`;
            } else {
               masterCompObj.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
                   compInput.innerHTML += `<option value="${app.escapeXSS(c.name)}">${app.escapeXSS(c.name)}</option>`;
               });
            }
            compInput.removeAttribute('disabled');
        }
        
        new bootstrap.Modal(document.getElementById('mdlDriver')).show();
    },

    openEditDriverModal: (phone) => {
        const driver = app.rawDb.drivers.find(d => d.phone == phone);
        if(!driver) return;
        document.getElementById('mdlDriverTitle').innerText = `정보 수정 [${driver.name}]`;
        document.getElementById('hdnEditOriginPhone').value = driver.phone;
        document.getElementById('mDriverName').value = driver.name;
        document.getElementById('mDriverPhone').value = driver.phone;
        document.getElementById('mDriverCar').value = driver.car_number;
        
        const compInput = document.getElementById('mDriverCompany');
        compInput.innerHTML = '';
        const masterCompObj = app.rawDb.masterCompanies || [];
        
        if (app.user.role === 'manager') {
            compInput.innerHTML = `<option value="${driver.company}">${driver.company}</option>`;
            compInput.setAttribute('disabled', 'true');
        } else {
            masterCompObj.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
                const selected = (driver.company === c.name) ? 'selected' : '';
                compInput.innerHTML += `<option value="${app.escapeXSS(c.name)}" ${selected}>${app.escapeXSS(c.name)}</option>`;
            });
            compInput.removeAttribute('disabled');
        }

        new bootstrap.Modal(document.getElementById('mdlDriver')).show();
    },

    handleDriverFormSubmit: async (e) => {
        e.preventDefault();
        app.showLoading(true);
        const originPhone = document.getElementById('hdnEditOriginPhone').value;
        const name = document.getElementById('mDriverName').value.trim();
        const phone = document.getElementById('mDriverPhone').value.trim();
        const car_number = document.getElementById('mDriverCar').value.trim();
        const compSelect = document.getElementById('mDriverCompany');
        const company = compSelect.options[compSelect.selectedIndex]?.value || "";

        if(!/^010\d{8}$/.test(phone)) { app.showLoading(false); return alert('휴대폰 번호가 올바르지 않습니다.'); }
        if(!company) { app.showLoading(false); return alert('화주사를 선택해 주세요.'); }

        bootstrap.Modal.getInstance(document.getElementById('mdlDriver')).hide();

        if(!originPhone) {
            const res = await app.fetchAPI({ action: 'addDriver', name, phone, car_number, company, password_hash: '0000' });
            if (res && res.exists) {
                const isMyCompany = String(res.existingCompany).includes(company);
                if (isMyCompany) {
                    alert('해당 화주사에 이미 등록된 기사입니다.');
                } else {
                    const addConfirm = confirm(`동일한 번호의 정보가 존재합니다.\n(기존: [${res.existingCompany}] 소속)\n\n[ ${company} ] 화주사에 추가하시겠습니까?`);
                    if (addConfirm) {
                        const mergeRes = await app.fetchAPI({ action: 'addCompanyToDriver', phone: phone, newCompany: company });
                        if(mergeRes) alert('추가 완료되었습니다.');
                    }
                }
            } else if (res) {
                alert('등록되었습니다. 초기 비밀번호는 0000 입니다.');
            }
        } else {
            const res = await app.fetchAPI({ action: 'updateDriver', originPhone, name, phone, car_number, company });
            if (res) alert('수정되었습니다.');
        }
        app.showLoading(false);
        app.loadAdminDashboardData();
    },

    deleteDriverProcess: async (phone, name) => {
        if(app.user.role === 'manager') return alert('운영자는 권한이 없습니다.');
        if(!confirm(`정말 ${name} 기사님을 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteDriver', phone });
        app.showLoading(false);
        if(res) app.loadAdminDashboardData();
    },

    resetDriverPasswordProcess: async (phone, name) => {
        if(!confirm(`${name} 기사님의 비밀번호를 0000 으로 초기화합니다.`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'resetPassword', phone, default_hash: '0000' });
        app.showLoading(false);
        if(res) {
            alert(`초기화 완료 (비밀번호: 0000)`);
            app.loadAdminDashboardData();
        }
    },

    openEditDailyModal: (dateStr, phone, company, distance, name) => {
        document.getElementById('eDailyDate').value = dateStr;
        document.getElementById('eDailyPhone').value = phone;
        document.getElementById('eDailyCompany').value = company;
        document.getElementById('eDailyName').value = name;
        document.getElementById('eDailyNameTxt').innerText = `${name} (${dateStr} / ${company})`;
        document.getElementById('eDailyDistance').value = distance;
        new bootstrap.Modal(document.getElementById('mdlEditDaily')).show();
    },

    handleEditDailySubmit: async (e) => {
        e.preventDefault();
        const date = document.getElementById('eDailyDate').value;
        const phone = document.getElementById('eDailyPhone').value;
        const company = document.getElementById('eDailyCompany').value;
        const name = document.getElementById('eDailyName').value;
        const distance = parseInt(document.getElementById('eDailyDistance').value, 10);

        if (isNaN(distance) || distance <= 0) return alert('올바른 거리를 입력하세요.');
        bootstrap.Modal.getInstance(document.getElementById('mdlEditDaily')).hide();

        app.showLoading(true);
        const payload = { action: 'updateDailyMileage', date, phone, company, distance, name, edited_by: app.user.name };
        const res = await app.fetchAPI(payload);
        app.showLoading(false);
        
        if(res) {
            app.showToast('해당 일자의 운행 거리가 수정 재계산되었습니다.');
            app.loadAdminDashboardData();
        }
    },

    deleteDailyProcess: async (dateStr, phone, company, name) => {
        if(!confirm(`정말 [${name}] 기사님의 [${dateStr}] 일자 [${company}] 운행 기록을 영구 삭제하시겠습니까?`)) return;
        app.showLoading(true);
        const payload = { action: 'deleteDailyMileage', date: dateStr, phone, company };
        const res = await app.fetchAPI(payload);
        app.showLoading(false);
        if(res) {
            app.showToast('운행 기록이 삭제되었습니다.');
            app.loadAdminDashboardData();
        }
    },

    openFuelRateModal: () => {
        const currentYearMonth = new Date().toISOString().substring(0, 7);
        document.getElementById('mFuelRateMonth').value = currentYearMonth;
        
        const compSelect = document.getElementById('mFuelRateCompany');
        compSelect.innerHTML = '<option value="">모든 화주사 공통 단가 (기본)</option>';
        if (app.user.role === 'admin') {
             const masterCompObj = app.rawDb.masterCompanies || [];
             masterCompObj.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
                 compSelect.innerHTML += `<option value="${app.escapeXSS(c.name)}">${app.escapeXSS(c.name)}</option>`;
             });
        } else {
             compSelect.innerHTML = `<option value="${app.escapeXSS(app.user.company)}">${app.escapeXSS(app.user.company)}</option>`;
        }
        
        app.syncFuelRateValue();
        new bootstrap.Modal(document.getElementById('mdlFuelRate')).show();
    },

    syncFuelRateValue: () => {
        const m = document.getElementById('mFuelRateMonth').value;
        const c = document.getElementById('mFuelRateCompany').value;
        if(!m) return;
        const rates = app.rawDb.fuelRatesList || [];
        const exactMatch = rates.find(r => r.month === m && r.company === c);
        if (exactMatch) document.getElementById('mFuelRateVal').value = exactMatch.rate;
        else {
            const defaultMatch = rates.find(r => r.month === m && r.company === "");
            document.getElementById('mFuelRateVal').value = defaultMatch ? defaultMatch.rate : 200;
        }
    },

    handleFuelRateSubmit: async (e) => {
        e.preventDefault();
        const selectedMonth = document.getElementById('mFuelRateMonth').value; 
        const selectedCompany = document.getElementById('mFuelRateCompany').value; 
        const val = parseInt(document.getElementById('mFuelRateVal').value, 10);
        
        if (!selectedMonth) return;
        if (isNaN(val) || val <= 0) return;

        bootstrap.Modal.getInstance(document.getElementById('mdlFuelRate')).hide();
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'updateFuelRate', month: selectedMonth, fuel_rate: val, company: selectedCompany });
        app.showLoading(false);
        
        if(res) {
            alert(`단가 소급 적용 완료`);
            app.loadAdminDashboardData();
        }
    },

    renderFuelRateTable: () => {
        const tbody = document.getElementById('tblFuelRateBody');
        tbody.innerHTML = '';
        
        const rates = app.rawDb.fuelRatesList || [];
        if(rates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">등록된 단가 정보가 없습니다.</td></tr>';
            return;
        }

        rates.sort((a,b) => b.month.localeCompare(a.month)); 
        
        rates.forEach(r => {
            if (app.user.role === 'manager' && r.company !== app.user.company && r.company !== "") return;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="fw-bold">${r.month}</td>
                <td><span class="badge bg-secondary rounded-pill px-2">${r.company || '전체(공통)'}</span></td>
                <td class="fw-bold text-danger">${r.rate} 원</td>
                <td class="text-center">
                    <button class="btn btn-outline-danger btn-sm" onclick="app.deleteFuelRate('${r.month}', '${r.company}')">삭제</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    deleteFuelRate: async (month, company) => {
        if(!confirm(`[${month}] 월의 단가 설정을 삭제하시겠습니까? (과거 유류비가 0원으로 바뀔 수 있습니다)`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'deleteFuelRate', month, company });
        app.showLoading(false);
        if(res) app.loadAdminDashboardData();
    },

    openCompanyModal: () => {
        app.renderMasterCompanies();
        new bootstrap.Modal(document.getElementById('mdlCompany')).show();
    },

    renderMasterCompanies: () => {
        const ul = document.getElementById('ulMasterCompanies');
        ul.innerHTML = '';
        const comps = app.rawDb.masterCompanies || [];
        if(comps.length === 0) {
            ul.innerHTML = '<li class="list-group-item text-muted text-center small bg-light border-0 rounded-3 py-3">등록된 화주사가 없습니다.</li>';
        } else {
            comps.sort((a,b)=>a.name.localeCompare(b.name)).forEach(c => {
                const statusBadge = c.status === 'active' 
                    ? '<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-2 py-1 small">운영중</span>' 
                    : '<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-1 small">중단됨</span>';
                
                ul.innerHTML += `
                    <li class="list-group-item bg-light border-0 rounded-3 p-3">
                        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
                            <div class="d-flex align-items-center gap-2">
                                <span class="fw-bold text-dark fs-6">${app.escapeXSS(c.name)}</span>
                                ${statusBadge}
                            </div>
                            <div class="btn-group shadow-sm">
                                <button class="btn btn-sm btn-white border text-primary fw-bold" onclick="app.editMasterCompanyPrompt('${c.name}')"><i class="bi bi-pencil-square"></i> 이름 수정</button>
                                <button class="btn btn-sm btn-white border ${c.status === 'active' ? 'text-danger' : 'text-success'} fw-bold" onclick="app.toggleCompanyStatusProcess('${c.name}', '${c.status}')">
                                    <i class="bi ${c.status === 'active' ? 'bi-pause-circle' : 'bi-play-circle'}"></i> 상태 변경
                                </button>
                            </div>
                        </div>
                    </li>
                `;
            });
        }
    },

    addMasterCompany: async () => {
        const input = document.getElementById('mNewCompanyName');
        const cName = input.value.trim();
        if(!cName) return alert('이름을 입력하세요.');
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'addMasterCompany', companyName: cName });
        app.showLoading(false);
        if(res) {
            input.value = '';
            app.loadAdminDashboardData(); 
            setTimeout(() => { app.renderMasterCompanies(); }, 500);
        }
    },

    editMasterCompanyPrompt: async (oldName) => {
        const newName = prompt(`[${oldName}] 화주사의 새로운 이름을 입력하세요. (기존 데이터 일괄 변경됨)`, oldName);
        if(!newName || newName.trim() === oldName) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'editMasterCompany', oldName: oldName, newName: newName.trim() });
        app.showLoading(false);
        if(res) {
            app.showToast('화주사 이름이 성공적으로 일괄 수정되었습니다.');
            app.loadAdminDashboardData();
            setTimeout(() => { app.renderMasterCompanies(); }, 500);
        }
    },

    toggleCompanyStatusProcess: async (cName, currentStatus) => {
        const stTxt = currentStatus === 'active' ? '운영 중단(기입 불가)' : '운영 재개(기입 가능)';
        if(!confirm(`[${cName}] 화주사를 ${stTxt} 상태로 변경하시겠습니까?`)) return;
        app.showLoading(true);
        const res = await app.fetchAPI({ action: 'toggleCompanyStatus', companyName: cName, status: currentStatus });
        app.showLoading(false);
        if(res) {
            app.loadAdminDashboardData();
            setTimeout(() => { app.renderMasterCompanies(); }, 500);
        }
    },

    resetDailySearch: () => {
        document.getElementById('searchDailyMonth').value = '';
        document.getElementById('searchDailyStart').value = '';
        document.getElementById('searchDailyEnd').value = '';
        document.getElementById('searchDailyKeyword').value = '';
        app.applyDailySearch();
    },

    // 관리자 탭 - 다중 사진 렌더링
    applyDailySearch: () => {
        const fMonth = document.getElementById('searchDailyMonth').value; 
        const fStart = document.getElementById('searchDailyStart').value;
        const fEnd = document.getElementById('searchDailyEnd').value;
        const fKeyword = document.getElementById('searchDailyKeyword').value.trim().toLowerCase();

        app.filteredDailyMileages = app.rawDb.mileages.filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            const rDateStr = new Date(r.date).toLocaleDateString('sv-SE'); 
            if (fMonth && fMonth !== rDateStr.substring(0, 7)) return false;
            if (fStart && rDateStr < fStart) return false;
            if (fEnd && rDateStr > fEnd) return false;
            if (fKeyword) {
                if (!String(r.name).toLowerCase().includes(fKeyword) && 
                    !String(r.car_number).toLowerCase().includes(fKeyword)) return false;
            }
            return true;
        });

        app.filteredDailyMileages.sort((a,b) => new Date(b.date) - new Date(a.date));
        const tbody = document.getElementById('tblDailyRecordsBody');
        tbody.innerHTML = '';
        
        if(app.filteredDailyMileages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">결과가 없습니다.</td></tr>';
            return;
        }

        app.filteredDailyMileages.forEach(r => {
            const rowDateStr = new Date(r.date).toLocaleDateString('sv-SE');
            let evidenceBtn = `<span class="text-muted small">없음</span>`;
            if (r.evidence_url) {
                const urls = r.evidence_url.split(',');
                evidenceBtn = urls.map((url, idx) => `<a href="${url.trim()}" target="_blank" class="btn btn-sm btn-outline-info rounded-pill py-0 px-2 me-1 mb-1"><i class="bi bi-image"></i> 사진${idx+1}</a>`).join('');
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${rowDateStr}</td>
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td><span class="badge bg-light text-dark border">${app.escapeXSS(r.car_number)}</span></td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="fw-bold text-primary">${Number(r.distance).toLocaleString()} km</td>
                <td class="fw-bold text-danger">${Number(r.fuel_cost).toLocaleString()} 원</td>
                <td class="text-center">${evidenceBtn}</td>
                <td class="text-center">
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary btn-mgr-lock" onclick="app.openEditDailyModal('${rowDateStr}', '${r.phone}', '${r.company}', '${r.distance}', '${r.name}')">수정</button>
                        <button class="btn btn-outline-danger btn-mgr-lock" onclick="app.deleteDailyProcess('${rowDateStr}', '${r.phone}', '${r.company}', '${r.name}')">삭제</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    applyMonthlySearch: () => {
        const fMonth = document.getElementById('searchMonthlyMonth').value; 
        const fCompany = document.getElementById('searchMonthlyCompany')?.value || 'ALL'; 
        const fKeyword = document.getElementById('searchMonthlyKeyword').value.trim().toLowerCase();
        
        if (!fMonth) return;
        document.getElementById('txtMonthlyResultTitle').innerText = `${fMonth} 월별 정산 요약`;

        let targetMileages = app.rawDb.mileages.filter(r => {
            if (!app.matchCompany(r.company)) return false; 
            if (fCompany !== 'ALL' && !String(r.company).includes(fCompany)) return false; 
            
            const rMonthStr = new Date(r.date).toLocaleDateString('sv-SE').substring(0, 7); 
            if (fMonth !== rMonthStr) return false;
            return true;
        });

        const summaryMap = {};
        targetMileages.forEach(r => {
            const key = `${r.phone}_${r.company}`;
            if (!summaryMap[key]) {
                summaryMap[key] = {
                    name: r.name, phone: r.phone, car_number: r.car_number, company: r.company,
                    daysCount: 0, totalDistance: 0, totalFuelCost: 0
                };
            }
            summaryMap[key].daysCount += 1;
            summaryMap[key].totalDistance += Number(r.distance) || 0;
            summaryMap[key].totalFuelCost += Number(r.fuel_cost) || 0;
        });

        app.filteredMonthlyMileages = Object.values(summaryMap);
        if (fKeyword) app.filteredMonthlyMileages = app.filteredMonthlyMileages.filter(r => String(r.name).toLowerCase().includes(fKeyword));
        app.filteredMonthlyMileages.sort((a,b) => b.totalDistance - a.totalDistance);

        const tbody = document.getElementById('tblMonthlyRecordsBody');
        tbody.innerHTML = '';
        
        if(app.filteredMonthlyMileages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">결과가 없습니다.</td></tr>';
            return;
        }

        app.filteredMonthlyMileages.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="fw-bold">${app.escapeXSS(r.name)}</td>
                <td>${app.escapeXSS(r.phone)}</td>
                <td><span class="badge bg-light text-dark border">${app.escapeXSS(r.car_number)}</span></td>
                <td><span class="badge bg-secondary rounded-pill px-2">${app.escapeXSS(r.company)}</span></td>
                <td class="fw-bold text-dark">${r.daysCount} 일</td>
                <td class="fw-bold text-primary">${r.totalDistance.toLocaleString()} km</td>
                <td class="fw-bold text-danger">${r.totalFuelCost.toLocaleString()} 원</td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderHistoryTable: () => {
        const tbody = document.getElementById('tblHistoryBody');
        tbody.innerHTML = '';
        const validHistory = app.rawDb.history.filter(h => app.matchCompany(h.company));
        const sortedHistory = [...validHistory].sort((a,b) => new Date(b.edited_at) - new Date(a.edited_at));

        if(sortedHistory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">이력이 없습니다.</td></tr>';
            return;
        }

        sortedHistory.forEach(h => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="small text-muted">${new Date(h.edited_at).toLocaleString()}</td>
                <td class="fw-bold">${app.escapeXSS(h.name)}</td>
                <td><span class="badge bg-secondary rounded-1">${app.escapeXSS(h.company)}</span></td>
                <td class="text-decoration-line-through text-muted">${Number(h.old_distance).toLocaleString()} km</td>
                <td class="fw-bold text-success">${Number(h.new_distance).toLocaleString()} km</td>
                <td>${app.escapeXSS(h.edited_by)}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    renderCharts: () => {
        const validMileages = app.rawDb.mileages.filter(m => app.matchCompany(m.company));
        const dateMap = {}; const driverDistMap = {};
        
        validMileages.forEach(r => {
            const dStr = new Date(r.date).toLocaleDateString('sv-SE');
            dateMap[dStr] = (dateMap[dStr] || 0) + Number(r.distance);
            const dName = r.name;
            driverDistMap[dName] = (driverDistMap[dName] || 0) + Number(r.distance);
        });

        const labelsChart1 = Object.keys(dateMap).sort().slice(-10);
        const dataChart1 = labelsChart1.map(k => dateMap[k]);
        const driversSortedByDist = Object.keys(driverDistMap).sort((a,b) => driverDistMap[b] - driverDistMap[a]);
        const labelsChart2 = driversSortedByDist.slice(0, 7);
        const dataChart2 = labelsChart2.map(k => driverDistMap[k]);

        app.buildSingleChart('cChart1', 'line', labelsChart1, '총 주행거리량 (km)', dataChart1, '#4318ff', true);
        app.buildSingleChart('cChart2', 'bar', labelsChart2, '누적 주행거리 (km)', dataChart2, '#05cd99', false);
    },

    buildSingleChart: (canvasId, type, labels, label, data, color, fill) => {
        if(app.charts[canvasId]) app.charts[canvasId].destroy();
        const ctx = document.getElementById(canvasId).getContext('2d');
        let bg = color;
        if(fill && type === 'line') {
            let g = ctx.createLinearGradient(0, 0, 0, 240);
            g.addColorStop(0, color + '66'); g.addColorStop(1, color + '00'); bg = g;
        }
        app.charts[canvasId] = new Chart(ctx, {
            type: type,
            data: { labels: labels, datasets: [{ label: label, data: data, borderColor: color, backgroundColor: bg, borderWidth: 2.5, fill: fill, tension: 0.35, pointRadius: type === 'line' ? 3 : 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: '#f4f7fe' } } } }
        });
    },

    downloadDailyExcel: () => {
        if(app.filteredDailyMileages.length === 0) return alert('결과가 없습니다.');
        let htmlTable = `<table border="1"><thead><tr style="background-color:#f2f2f2;"><th>운행일자</th><th>기사명</th><th>전화번호</th><th>차량번호</th><th>화주사</th><th>주행거리(km)</th><th>정산유류비(원)</th><th>증빙URL</th></tr></thead><tbody>`;
        app.filteredDailyMileages.forEach(r => { htmlTable += `<tr><td>${new Date(r.date).toLocaleDateString('sv-SE')}</td><td>${r.name}</td><td>${r.phone}</td><td>${r.car_number}</td><td>${r.company}</td><td>${r.distance}</td><td>${r.fuel_cost}</td><td>${r.evidence_url}</td></tr>`; });
        htmlTable += "</tbody></table>";
        const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `유류비_일별상세_${new Date().toLocaleDateString('sv-SE')}.xls`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    },

    downloadMonthlyExcel: () => {
        if(app.filteredMonthlyMileages.length === 0) return alert('결과가 없습니다.');
        let htmlTable = `<table border="1"><thead><tr style="background-color:#cce5ff;"><th>기사명</th><th>전화번호</th><th>차량번호</th><th>화주사</th><th>총 운행일수</th><th>총 거리(km)</th><th>총 유류비(원)</th></tr></thead><tbody>`;
        app.filteredMonthlyMileages.forEach(r => { htmlTable += `<tr><td>${r.name}</td><td>${r.phone}</td><td>${r.car_number}</td><td>${r.company}</td><td>${r.daysCount}</td><td>${r.totalDistance}</td><td>${r.totalFuelCost}</td></tr>`; });
        htmlTable += "</tbody></table>";
        const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' });
        const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
        link.setAttribute("download", `유류비_월별요약_${document.getElementById('searchMonthlyMonth').value}.xls`);
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }
};

window.onload = app.init;
