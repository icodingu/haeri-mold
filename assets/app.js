/* HAERI | MOLD MANAGEMENT SYSTEM — 1단계
 * 클라우드판: 데이터는 Supabase 테이블 mold_db(id='main')에 한 덩어리(jsonb)로 저장, 실시간 동기화
 * 첨부파일·연결 파일: Supabase Storage 버킷 mold-files (로그인한 팀원만 접근)
 * 도번(dwgNo)이 프로젝트 고유 ID
 */
(function () {
'use strict';

const STORE_KEY = 'haeri_mms_v1';
const SCHEMA = 1;

const STATUSES = ['설계 중', '제작 준비', '제작 중', '수정·보완', '제작 완료', '보류'];
const STATUS_CLS = { '설계 중': 'b-design', '제작 준비': 'b-prep', '제작 중': 'b-make', '수정·보완': 'b-fix', '제작 완료': 'b-done', '보류': 'b-hold' };
const COST_STATUSES = ['견적 요청', '견적 접수', '보류', '확인 필요', '확정', '일부 지급', '지급 완료', '무상'];
const COST_CONFIRMED = ['확정', '일부 지급', '지급 완료', '무상'];   // 확정 제작비에 포함
const COST_PENDING = ['견적 요청', '견적 접수', '보류', '확인 필요']; // 확정·지급에 절대 합산하지 않음
const COST_CLS = { '견적 요청': 'b-none', '견적 접수': 'b-prep', '보류': 'b-hold', '확인 필요': 'b-fix', '확정': 'b-make', '일부 지급': 'b-design', '지급 완료': 'b-done', '무상': 'b-none' };
const VATS = ['미확인', '별도', '포함'];
const LOG_CATS = ['설계', '가공', '발주', '수정', '문제 발생', '기타'];
const LOG_STATES = ['미해결', '진행 중', '해결', '참고'];
const LOG_STATE_CLS = { '미해결': 's-open', '진행 중': 's-prog', '해결': 's-done', '참고': 's-ref' };
const LOG_BADGE = { '미해결': 'b-hold', '진행 중': 'b-fix', '해결': 'b-done', '참고': 'b-prep' };
const DOC_TYPES = ['BOM', '금형구조설명서', '2D 도면', '3D 모델', '3D 뷰어 HTML', '견적서', '거래명세서', '세금계산서', '발주서', '제작 사진', '기타 자료'];

/* ---------------- utils ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowISO = () => new Date().toISOString();
const isNum = v => typeof v === 'number' && isFinite(v);
const num = v => isNum(v) ? v : 0;
const won = v => isNum(v) ? '₩' + v.toLocaleString('ko-KR') : '—';
const wonShort = v => {
  if (!isNum(v)) return '—';
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억';
  if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
  return v.toLocaleString('ko-KR');
};
const parseMoney = s => { const t = String(s || '').replace(/[^\d-]/g, ''); if (t === '' || t === '-') return null; const n = parseInt(t, 10); return isFinite(n) ? n : null; };
const fmtDT = iso => { if (!iso) return '—'; const d = new Date(iso); if (isNaN(d)) return '—'; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmtD = iso => iso ? fmtDT(iso).slice(0, 10) : '—';
const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const dispName = p => p.model ? `${p.dwgNo}_${p.model}` : p.dwgNo;
const badge = s => s ? `<span class="badge ${STATUS_CLS[s] || 'b-none'}">${esc(s)}</span>` : `<span class="badge b-none">미입력</span>`;
const valOr = v => (v == null || v === '') ? '<span class="empty-v">미입력</span>' : esc(v);

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('#toastRoot').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}

/* ---------------- data ---------------- */
let DB = null;

function emptyDB() {
  return { schema: SCHEMA, savedAt: null, lastExportAt: null, settings: { user: '오대리', company: '(주)해리', logoPath: 'assets/logo.png' }, projects: [], schedules: [] };
}

function seedProject() {
  const t = nowISO();
  const W = '../만능봉수 랜더링 작업_Maus Bot/';
  return {
    dwgNo: 'HR26-0801', model: '만능봉수',
    moldType: '사출금형', cavities: '1', material: '몰드베이스 S55C / 코어·캐비티 인서트 KP4 / 센터 인서트 NAK80 (도면 부품표 기준)',
    resin: 'PVC 100%',
    startDate: '', endDate: '', status: '',
    designer: '마포창업센터 이은광 책임님', maker: 'SG몰드코리아 (몰드베이스), 모아텍 (코어 가공)', manager: '오대리',
    summary: '(주)해리 만능봉수(Water Seal) 사출금형. 최초 작업 기준 2026년 8월. 작업 시작일·완료일·작업 상태는 확인 후 입력 필요.\n도면 원본 번호: CLK26-005_HARRY',
    folder: 'molds/HR26-0801_만능봉수/',
    imagePath: 'molds/HR26-0801_만능봉수/images/대표이미지_제품.png', imageFileId: null,
    viewerPath: 'molds/HR26-0801_만능봉수/viewer/CLK26-005_HARRY_3D뷰어.html',
    createdAt: t, updatedAt: t,
    costs: [
      { id: uid('c'), item: '몰드베이스 (완가공)', vendor: 'SG몰드코리아', quote: null, confirmed: 1000000, paid: 1000000, vat: '별도', status: '지급 완료', note: '몰드베이스 완가공 제작 · 업체 위치: 중국 · 실제 투입 비용' },
      { id: uid('c'), item: '코어 가공', vendor: '모아텍', quote: 800000, confirmed: null, paid: null, vat: '미확인', status: '보류', note: '업체 요구 80만 원 — 지급 의무 이견으로 보류. 확정·지급액에 포함하지 않음' },
      { id: uid('c'), item: '코어 재료', vendor: '디엔티 종합특수강', quote: null, confirmed: null, paid: null, vat: '미확인', status: '확인 필요', note: '금액 미입력' },
      { id: uid('c'), item: '기타 부재료', vendor: '기아공구', quote: null, confirmed: null, paid: null, vat: '미확인', status: '확인 필요', note: '금액 미입력' },
      { id: uid('c'), item: '금형 설계', vendor: '마포창업센터', quote: null, confirmed: 0, paid: 0, vat: '미확인', status: '무상', note: '금형 설계 무상 지원 (설계비 0원) · 담당 이은광 책임님' },
    ],
    logs: [
      { id: uid('l'), date: '', title: 'SG몰드코리아 수정사항 미반영', category: '문제 발생', vendor: 'SG몰드코리아', createdAt: t,
        detail: '로케이트링 관련 수정사항을 요청했으나 SG몰드코리아에서 해당 수정사항을 반영하지 않은 채 몰드베이스를 보내왔음.',
        action: '추후 동일 업체 발주 시 수정도면 반영 여부와 출하 전 검수를 반드시 확인할 필요가 있음.', state: '참고', files: '' },
      { id: uid('l'), date: '', title: '모아텍 코어 가공비 지급 보류', category: '발주', vendor: '모아텍', createdAt: t,
        detail: '모아텍에서 코어 가공 비용 800,000원을 요구하였으나, 해당 금액의 지급 여부는 합의되지 않아 보류된 상태임.',
        action: '실제 지급된 비용으로 기록하지 말 것.', state: '미해결', files: '' },
      { id: uid('l'), date: '', title: '금형 설계 무상 지원', category: '설계', vendor: '마포창업센터', createdAt: t,
        detail: '마포창업센터 이은광 책임님이 금형 설계를 무상으로 지원함.',
        action: '설계비는 별도 지급하지 않았으며, 몰드베이스 제작을 위한 재료·제작 관련 비용을 부담함.', state: '참고', files: '' },
    ],
    docs: [
      { id: uid('d'), type: '3D 뷰어 HTML', name: 'CLK26-005_HARRY_3D뷰어.html', desc: '금형 3D 뷰어 (인터넷 연결 필요)', mode: 'link', path: W + 'CLK26-005_HARRY_3D뷰어.html', date: today() },
      { id: uid('d'), type: 'BOM', name: 'CLK26-005_HARRY_BOM.xlsx', desc: '부품표 엑셀', mode: 'link', path: W + 'CLK26-005_HARRY_BOM.xlsx', date: today() },
      { id: uid('d'), type: '금형구조설명서', name: 'CLK26-005_HARRY_금형구조설명서.pdf', desc: '금형 구조 설명서', mode: 'link', path: W + 'CLK26-005_HARRY_금형구조설명서.pdf', date: today() },
      { id: uid('d'), type: '2D 도면', name: 'CLK26-005_HARRY_261008.dwg', desc: '2D 도면 원본', mode: 'link', path: '../만능봉수/CLK26-005_HARRY_261008.dwg', date: today() },
      { id: uid('d'), type: '3D 모델', name: 'CLK26-005_HARRY_WATER_SEAL_ASM.stp', desc: '3D 조립 모델 원본', mode: 'link', path: '../만능봉수/CLK26-005_HARRY_WATER_SEAL_ASM.stp', date: today() },
    ],
  };
}

// 예전 방식(행마다 확정·지급금액) → 금형 단위 확정 제작비·실제 지급액으로 한 번만 옮김
function legacyCostSum(costs, f) {
  let s = 0, any = false;
  (costs || []).forEach(c => { if (c && COST_CONFIRMED.includes(c.status) && c.status !== '무상' && isNum(c[f])) { s += c[f]; any = true; } });
  return any ? s : null;
}
function normalizeProject(p) {
  p = Object.assign({}, p);
  if (!('costFinal' in p)) p.costFinal = legacyCostSum(p.costs, 'confirmed');
  if (!('costPaid' in p)) p.costPaid = legacyCostSum(p.costs, 'paid');
  const d = Object.assign({ dwgNo: '', model: '', moldType: '', cavities: '', material: '', resin: '', startDate: '', endDate: '', status: '', designer: '', maker: '', manager: '', summary: '', folder: '', imagePath: '', imageFileId: null, viewerPath: '', createdAt: nowISO(), updatedAt: nowISO(), costs: [], logs: [], docs: [], vendorInfo: {}, costFinal: null, costPaid: null }, p);
  d.vendorInfo = (d.vendorInfo && typeof d.vendorInfo === 'object' && !Array.isArray(d.vendorInfo)) ? d.vendorInfo : {};
  d.costs = (d.costs || []).map(c => Object.assign({ id: uid('c'), item: '', vendor: '', quote: null, confirmed: null, paid: null, vat: '미확인', status: '견적 요청', note: '', quoteFileId: null }, c));
  d.logs = (d.logs || []).map(l => Object.assign({ id: uid('l'), date: '', title: '', category: '기타', vendor: '', detail: '', action: '', state: '참고', files: '', createdAt: nowISO() }, l));
  d.docs = (d.docs || []).map(x => Object.assign({ id: uid('d'), type: '기타 자료', name: '', desc: '', mode: 'link', path: '', fileId: null, date: today() }, x));
  return d;
}

// 내화채움 슬리브 0701(하부)·0702(상부) 금형 — 기존 데이터에 한 번만 추가 (삭제해도 다시 생기지 않음)
function fireProjects() {
  const t = nowISO(), F = '../내화채움구조슬리브/';
  const mk = (no, part, viewer, stp, dwg, summary) => ({
    dwgNo: no, model: '내화채움 슬리브_' + part,
    moldType: '사출금형', cavities: '2', material: '몰드베이스 3560 (S55C) / 코어 KP-4 / 핀 SKD-61 (도면 부품표 기준)',
    resin: 'PP', startDate: '', endDate: '', status: '', designer: 'DS TECH', maker: '', manager: '오대리',
    summary, folder: fireDir(no, part), imagePath: fireDir(no, part) + 'images/대표이미지_제품.png', imageFileId: null, viewerPath: fireDir(no, part) + 'viewer/' + viewer, createdAt: t, updatedAt: t,
    costs: [], logs: [{ id: uid('l'), date: '', title: '다리 40mm 늘림 재설계', category: '설계', vendor: 'DS TECH', createdAt: t,
      detail: '시사출 때 제품이 코어에 꽉 물려 낙하가 안 됨.', action: '스페이서 블록 110 → 150 (40mm 늘림), 밀핀·스프루락핀(Z핀)도 40mm씩 늘려 재설계 (도면 261022).', state: '참고', files: '' }],
    docs: [
      { id: uid('d'), type: '3D 뷰어 HTML', name: viewer, desc: '금형 3D 뷰어 (인터넷 연결 필요)', mode: 'link', path: fireDir(no, part) + 'viewer/' + viewer, date: today() },
      { id: uid('d'), type: '2D 도면', name: dwg, desc: '2D 도면 원본 (다리 40 늘림)', mode: 'link', path: F + dwg, date: today() },
      ...stp.map(s => ({ id: uid('d'), type: '3D 모델', name: s, desc: '3D 조립 모델 원본', mode: 'link', path: F + s, date: today() })),
    ],
  });
  return [
    mk('HR26-0701', '하부', 'HR26-0701_내화채움슬리브_하부_3D뷰어.html', ['0701(40mm추가).stp'], 'HR26-0701-다리 40.0 늘림-261022.dwg',
      '내화채움 슬리브 하부 사출금형. 1×2 캐비티, PP. 몰드베이스 3560 SA.'),
    mk('HR26-0702', '상부', 'HR26-0702_내화채움슬리브_상부_3D뷰어.html', ['0702(40mm추가)_210.stp', '0702(40mm추가)_200.stp', '0702(40mm추가)_180.stp'], 'HR26-0702-다리 40.0 늘림-261022.dwg',
      '내화채움 슬리브 상부 사출금형. 1×2 캐비티, PP. 몰드베이스 3560 SC.\n금형은 하나이고 코어(C-2, L-3, L-4 핀, 긴 밀핀)와 C-2가 들어가는 중간 형판(68.8t / 58.6t / 38.2t)을 바꿔 끼워 제품 높이 H210 / H200 / H180을 만든다.'),
  ];
}
const fireDir = (no, part) => `molds/${no}_내화채움슬리브_${part}/`;
// 뷰어·대표이미지를 대시보드 폴더 안(molds/…)으로 옮김 — 이미 저장된 0701·0702도 한 번만 경로 갱신
function fixFireViewerPaths() {
  if (READONLY || DB.fireViewerInDash) return;
  for (const p of DB.projects) {
    const part = p.dwgNo === 'HR26-0701' ? '하부' : p.dwgNo === 'HR26-0702' ? '상부' : null;
    if (!part) continue;
    const dir = fireDir(p.dwgNo, part), name = `${p.dwgNo}_내화채움슬리브_${part}_3D뷰어.html`;
    if (!p.viewerPath || p.viewerPath.startsWith('../내화채움구조슬리브/')) p.viewerPath = dir + 'viewer/' + name;
    if (!p.imagePath && !p.imageFileId) p.imagePath = dir + 'images/대표이미지_제품.png';
    for (const d of p.docs || []) if (d.type === '3D 뷰어 HTML' && d.mode === 'link' && (d.path || '').startsWith('../내화채움구조슬리브/')) d.path = dir + 'viewer/' + name;
    p.updatedAt = nowISO();
  }
  DB.fireViewerInDash = true;
  save('내화채움 슬리브 뷰어·대표이미지 경로 갱신');
}
// 0702: 높이 교체 부품에 중간 형판 추가 (개요 문구) — 한 번만
function fix0702MidPlate() {
  if (READONLY || DB.fix0702Mid) return;
  const p = DB.projects.find(x => x.dwgNo === 'HR26-0702');
  if (p && (p.summary || '').includes('금형은 하나이고 코어(C-2, L-3, L-4 핀, 긴 밀핀)만 바꿔 끼워')) { p.summary = p.summary.replace('금형은 하나이고 코어(C-2, L-3, L-4 핀, 긴 밀핀)만 바꿔 끼워', '금형은 하나이고 코어(C-2, L-3, L-4 핀, 긴 밀핀)와 C-2가 들어가는 중간 형판(68.8t / 58.6t / 38.2t)을 바꿔 끼워'); p.updatedAt = nowISO(); }
  DB.fix0702Mid = true;
  save('0702 중간 형판 교체 문구');
}
// 만능봉수: 대표이미지를 제품으로, 뷰어를 대시보드 폴더 안(molds/…)으로 — 한 번만
function fixHarryPaths() {
  if (READONLY || DB.harryInDash) return;
  const p = DB.projects.find(x => x.dwgNo === 'HR26-0801');
  if (p) {
    const dir = 'molds/HR26-0801_만능봉수/', old = '../만능봉수 랜더링 작업_Maus Bot/';
    if (!p.imageFileId && (!p.imagePath || p.imagePath === old + '_작업파일/img/1_조립.jpg')) p.imagePath = dir + 'images/대표이미지_제품.png';
    if (!p.viewerPath || p.viewerPath === old + 'CLK26-005_HARRY_3D뷰어.html') p.viewerPath = dir + 'viewer/CLK26-005_HARRY_3D뷰어.html';
    for (const d of p.docs || []) if (d.type === '3D 뷰어 HTML' && d.mode === 'link' && d.path === old + 'CLK26-005_HARRY_3D뷰어.html') d.path = dir + 'viewer/CLK26-005_HARRY_3D뷰어.html';
    p.updatedAt = nowISO();
  }
  DB.harryInDash = true;
  save('만능봉수 대표이미지·뷰어 경로 갱신');
}
function addFireProjects() {
  if (READONLY || DB.added0701_0702) return;
  for (const p of fireProjects()) if (!DB.projects.some(x => x.dwgNo === p.dwgNo)) DB.projects.push(normalizeProject(p));
  DB.added0701_0702 = true;
  save('내화채움 슬리브 금형 등록');
}

let READONLY = '';   // 비어 있지 않으면 저장 잠금 (기존 데이터 보호)
let CORRUPT_RAW = null;

/* ---------------- cloud (Supabase) ---------------- */
const CFG = window.HAERI_CLOUD || {};
const INIT_HASH = location.hash;   // 초대·비밀번호 재설정 링크 정보 (supabase가 읽고 지우기 전에 보관)
const SB = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' } });
const ROW = CFG.row || 'main', BUCKET = CFG.bucket || 'mold-files', MAX_FILE = 50 * 1024 * 1024;
const Cloud = { user: null, rev: 0, base: null, exists: false, dirty: false, pushing: false, timer: null, retry: null, failed: '', reason: '', live: false, pendingRow: null, deferNote: false };
const jclone = o => JSON.parse(JSON.stringify(o));
const who = () => { const u = Cloud.user; if (!u) return ''; return (u.user_metadata && u.user_metadata.name) || (u.email || '').split('@')[0]; };

function normData(d) {
  d = d || {};
  const o = Object.assign(emptyDB(), jclone(d));
  o.settings = Object.assign(emptyDB().settings, d.settings || {});
  o.projects = (d.projects || []).map(p => normalizeProject(jclone(p)));
  o.schedules = sanitizeSchedules(d.schedules);
  o.fileMeta = Object.assign({}, d.fileMeta || {});
  o.cloudFiles = Object.assign({}, d.cloudFiles || {});
  o.rev = +d.rev || 0;
  return o;
}
function applyRemote(row) {
  DB = normData(row.data);
  Cloud.rev = DB.rev; Cloud.base = jclone(DB); Cloud.exists = true;
}
async function fetchRow() {
  const { data, error } = await SB.from('mold_db').select('data,updated_at,updated_by').eq('id', ROW).maybeSingle();
  if (error) throw error;
  return data;
}
async function load() {
  const row = await fetchRow();
  if (!row) {
    // 클라우드에 아직 데이터가 없을 때만 최초 예제 데이터 등록
    DB = normData({}); Cloud.rev = 0; Cloud.base = jclone(DB); Cloud.exists = false;
    DB.projects.push(seedProject());
    save('최초 데이터 등록');
    return;
  }
  applyRemote(row);
}

let saveTimer = null;
// 화면 데이터는 바로 바뀌고, 클라우드 저장은 잠시 뒤 모아서 보냄. 실패하면 5초마다 다시 시도
function save(force) {
  if (READONLY && force !== true) { toast(READONLY, 'err'); return false; }
  DB.savedAt = nowISO();
  Cloud.dirty = true;
  if (typeof force === 'string') Cloud.reason = force;
  clearTimeout(Cloud.timer); Cloud.timer = setTimeout(push, 300);
  renderSaveState();
  if (!BackupDir.writing) BackupDir.schedule();
  return true;
}
function diffSummary(a, b) {
  a = a || {}; const js = JSON.stringify, out = [];
  const A = new Map((a.projects || []).map(p => [p.dwgNo, p])), B = new Map((b.projects || []).map(p => [p.dwgNo, p]));
  const add = [], mod = [], del = [];
  B.forEach((p, k) => { if (!A.has(k)) add.push(k); else if (js(A.get(k)) !== js(p)) mod.push(k); });
  A.forEach((p, k) => { if (!B.has(k)) del.push(k); });
  if (add.length) out.push('추가 ' + add.join(', '));
  if (mod.length) out.push('수정 ' + mod.join(', '));
  if (del.length) out.push('삭제 ' + del.join(', '));
  if (js(a.schedules || []) !== js(b.schedules || [])) out.push('일정 변경');
  if (js(a.settings || {}) !== js(b.settings || {})) out.push('설정 변경');
  if (js(a.cloudFiles || {}) !== js(b.cloudFiles || {})) out.push('연결 파일 업로드');
  if (js(a.fileMeta || {}) !== js(b.fileMeta || {})) out.push('첨부파일 변경');
  if (js(a.inventory || null) !== js(b.inventory || null)) out.push('공구·부품 재고 변경');
  if (js(a.repairHist || null) !== js(b.repairHist || null)) out.push('금형수리이력 변경');
  return out.join(' / ');
}
// 두 사람이 동시에 저장했을 때: 금형(도번)·일정 단위로 합침. 같은 금형을 둘 다 고쳤으면 내 변경 우선
function merge3(base, mine, theirs) {
  base = base || {}; const js = JSON.stringify, conflicts = [];
  const out = jclone(theirs);
  const mergeList = (bl, ml, tl, k, label) => {
    const B = new Map((bl || []).map(x => [x[k], x])), M = new Map((ml || []).map(x => [x[k], x])), T = new Map((tl || []).map(x => [x[k], x]));
    const keys = new Set([...T.keys(), ...M.keys(), ...B.keys()]), res = [];
    keys.forEach(key => {
      const b = B.get(key), m = M.get(key), t = T.get(key);
      const mc = js(m) !== js(b), tc = js(t) !== js(b);
      if (mc && tc && js(m) !== js(t)) conflicts.push(label || key);
      const v = mc ? m : t;
      if (v !== undefined) res.push(v);
    });
    return res;
  };
  const list = (f, k) => { out[f] = mergeList(base[f], mine[f], theirs[f], k, f === 'projects' ? '' : '달력 일정'); };
  list('projects', 'dwgNo'); list('schedules', 'id');
  // 공구·부품 재고: 공구·부품·입출고 기록을 항목(id)별로 합침
  if (js(mine.inventory) !== js(base.inventory)) {
    if (!theirs.inventory || js(theirs.inventory) === js(base.inventory)) out.inventory = mine.inventory;
    else if (mine.inventory) {
      const bi = base.inventory || {}, mi = mine.inventory, ti = theirs.inventory;
      out.inventory = { tools: mergeList(bi.tools, mi.tools, ti.tools, 'id', '공구 재고'), parts: mergeList(bi.parts, mi.parts, ti.parts, 'id', '부품 재고'), logs: mergeList(bi.logs, mi.logs, ti.logs, 'id', '입출고 기록') };
    }
  }
  // 금형수리이력: 금형(mold_id)·이력(event_id)별로 합침
  if (js(mine.repairHist) !== js(base.repairHist)) {
    if (!theirs.repairHist || js(theirs.repairHist) === js(base.repairHist)) out.repairHist = mine.repairHist;
    else if (mine.repairHist) {
      const bh = base.repairHist || {}, mh = mine.repairHist, th = theirs.repairHist;
      out.repairHist = { molds: mergeList(bh.molds, mh.molds, th.molds, 'mold_id', '수리이력 금형'), events: mergeList(bh.events, mh.events, th.events, 'event_id', '수리이력'),
        labels: [...new Set([...(th.labels || []), ...(mh.labels || [])])] };
    }
  }
  const map = f => {
    const b = base[f] || {}, m = mine[f] || {}, t = theirs[f] || {}, o = {};
    new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)]).forEach(k => { const v = js(m[k]) !== js(b[k]) ? m[k] : t[k]; if (v !== undefined) o[k] = v; });
    out[f] = o;
  };
  map('fileMeta'); map('cloudFiles');
  Object.keys(mine).forEach(k => { if (!['projects', 'schedules', 'fileMeta', 'cloudFiles', 'inventory', 'repairHist', 'rev'].includes(k) && js(mine[k]) !== js(base[k])) out[k] = mine[k]; });
  return { merged: out, conflicts: [...new Set(conflicts)] };
}
async function push() {
  if (Cloud.pushing || !Cloud.dirty) return;
  Cloud.pushing = true; Cloud.dirty = false; clearTimeout(Cloud.retry);
  const hadFail = !!Cloud.failed;
  try {
    for (let tries = 0; tries < 6; tries++) {
      const next = Cloud.rev + 1;
      const data = jclone(DB); data.rev = next;
      const meta = { data, updated_at: nowISO(), updated_by: who() || null };
      let ok;
      if (Cloud.exists) {
        // 내가 마지막으로 본 버전(rev)일 때만 덮어씀 → 그 사이 팀원이 저장했으면 0건 갱신
        const { data: rows, error } = await SB.from('mold_db').update(meta).eq('id', ROW).eq('data->>rev', String(Cloud.rev)).select('id');
        if (error) throw error;
        ok = !!(rows && rows.length);
      } else {
        const { error } = await SB.from('mold_db').insert(Object.assign({ id: ROW }, meta));
        if (error && error.code !== '23505') throw error;
        ok = !error;
      }
      if (ok) {
        const summary = diffSummary(Cloud.base, data);
        Cloud.rev = next; DB.rev = next; Cloud.base = data; Cloud.exists = true; Cloud.failed = '';
        if (summary) SB.from('mold_log').insert({ who: who() || null, summary: (Cloud.reason ? Cloud.reason + ' · ' : '') + summary }).then(() => {}, () => {});
        Cloud.reason = '';
        if (hadFail) toast('클라우드 저장을 다시 완료했습니다');
        return;
      }
      // 충돌: 최신본을 받아 합친 뒤 다시 저장
      const row = await fetchRow();
      if (!row) { Cloud.exists = false; continue; }
      const theirs = normData(row.data);
      const { merged, conflicts } = merge3(Cloud.base, jclone(DB), theirs);
      DB = normData(merged); DB.rev = theirs.rev;
      Cloud.rev = theirs.rev; Cloud.base = theirs; Cloud.exists = true;
      if (conflicts.length) toast(`팀원이 같은 항목을 동시에 고쳤습니다 (${conflicts.join(', ')}). 내 변경으로 저장했습니다.`, 'warn');
      if (!busyUI()) rerender();
    }
    throw new Error('다른 팀원과 저장이 계속 겹칩니다');
  } catch (e) {
    Cloud.dirty = true;
    const first = !Cloud.failed;
    Cloud.failed = (e && e.message) || String(e);
    if (first) toast('클라우드 저장 실패: ' + Cloud.failed + ' — 5초마다 다시 시도합니다. 창을 닫지 마세요.', 'err');
    Cloud.retry = setTimeout(push, 5000);
  } finally {
    Cloud.pushing = false;
    renderSaveState();
    if (Cloud.dirty && !Cloud.failed) push();
  }
}
// 팀원 변경 반영
function busyUI() {
  const a = document.activeElement;
  return !!$('#modalRoot .mback') || !!(a && a.closest && a.closest('#main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
function rerender() {
  if ($('#invFrame')) { applySettings(); return sendInv(); }
  if ($('#repFrame')) { applySettings(); return sendRep(); }   // 수리이력 화면도 새 데이터만 전달   // 재고 화면은 다시 그리지 않고 새 데이터만 전달
  const main = $('#main'), y = main ? main.scrollTop : 0, wy = window.scrollY;
  applySettings(); route();
  if (main) main.scrollTop = y; window.scrollTo(0, wy);
}
async function pullRemote() {
  if (!DB || Cloud.pushing || Cloud.dirty) return;
  let row; try { row = await fetchRow(); } catch (e) { return; }
  if (!row || (+(row.data && row.data.rev) || 0) <= Cloud.rev) return;
  Cloud.pendingRow = row; applyDeferred();
}
function applyDeferred() {
  const row = Cloud.pendingRow;
  if (!row || Cloud.dirty || Cloud.pushing) return;
  if ((+row.data.rev || 0) <= Cloud.rev) { Cloud.pendingRow = null; return; }
  if (busyUI()) { if (!Cloud.deferNote) { Cloud.deferNote = true; toast('팀원이 내용을 바꿨습니다. 입력을 마치면 자동으로 반영됩니다.'); } return; }
  Cloud.pendingRow = null; Cloud.deferNote = false;
  applyRemote(row); rerender(); renderSaveState();
  toast(`${row.updated_by || '팀원'}님이 변경한 내용을 반영했습니다`);
}
function subscribe() {
  SB.channel('mold-db-' + ROW)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mold_db', filter: 'id=eq.' + ROW }, () => pullRemote())
    .subscribe(st => { Cloud.live = st === 'SUBSCRIBED'; renderSaveState(); if (st === 'SUBSCRIBED') pullRemote(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pullRemote(); });
  setInterval(applyDeferred, 1500);
  setInterval(pullRemote, 60000);   // 실시간 연결이 끊겨도 1분마다 확인
}
window.addEventListener('beforeunload', e => { if (Cloud.dirty || Cloud.pushing) { e.preventDefault(); e.returnValue = ''; } });

// 저장 실패 시 메모리 상태를 되돌리기 위한 스냅샷
const snap = () => JSON.stringify({ p: DB.projects, s: DB.schedules });
function restore(x) { const o = JSON.parse(x); DB.projects = o.p.map(normalizeProject); DB.schedules = o.s; }
// 달력 일정: { id, date: 'YYYY-MM-DD', title, dwgNo(선택), color(선택 '#rrggbb') }
function sanitizeSchedules(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && typeof x === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.date)) && String(x.title || '').trim())
    .map(x => { const o = { id: String(x.id || uid('s')), date: String(x.date), title: String(x.title).trim(), dwgNo: String(x.dwgNo || '') }; if (/^#[0-9a-f]{6}$/i.test(String(x.color || ''))) o.color = String(x.color).toLowerCase(); return o; });
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); }
function touch(p) { p.updatedAt = nowISO(); }
function renderSaveState() {
  const el = $('#saveState'); if (!el) return;
  if (READONLY) { el.className = 'save-state err'; el.textContent = '저장 잠김 (설정 확인)'; return; }
  if (Cloud.failed) { el.className = 'save-state err'; el.textContent = '저장 실패 · 다시 시도 중'; el.title = Cloud.failed; return; }
  if (Cloud.dirty || Cloud.pushing) { el.className = 'save-state'; el.textContent = '저장 중…'; return; }
  el.className = 'save-state ok'; el.title = '입력 내용은 클라우드에 자동 저장되고 팀원 화면에 바로 반영됩니다';
  el.textContent = (Cloud.live ? '● 실시간 · ' : '') + '클라우드 저장됨' + (DB && DB.savedAt ? ' · ' + fmtDT(DB.savedAt) : '');
}
const getP = id => DB.projects.find(p => p.dwgNo === id);

/* ---------------- 첨부파일 (Supabase Storage, 로그인한 팀원만) ---------------- */
const FileStore = {
  key: id => 'f/' + id,
  async put(file) {
    if (file.size > MAX_FILE) throw new Error(`파일이 50MB를 넘습니다 (${(file.size / 1048576).toFixed(1)}MB)`);
    const id = uid('f');
    const { error } = await SB.storage.from(BUCKET).upload(this.key(id), file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    DB.fileMeta = DB.fileMeta || {};
    DB.fileMeta[id] = { name: file.name, type: file.type || '', size: file.size, addedAt: nowISO(), by: who() };
    return id;
  },
  async get(id) {
    const m = (DB.fileMeta || {})[id];
    const { data, error } = await SB.storage.from(BUCKET).download(this.key(id));
    if (error) { if (/not.?found/i.test(error.message || '')) return null; throw error; }
    return { id, name: m ? m.name : id, type: m ? m.type : data.type, size: data.size, blob: data };
  },
  async del(id) {
    const { error } = await SB.storage.from(BUCKET).remove([this.key(id)]);
    if (error) throw error;
    if (DB.fileMeta) delete DB.fileMeta[id];
  },
  async all() { return Object.entries(DB.fileMeta || {}).map(([id, m]) => Object.assign({ id }, m)); },
};

/* ---------------- cost calc ---------------- */
function calcCosts(costs) {
  const r = { quote: 0, confirmed: 0, paid: 0, unpaid: 0, pending: 0, missing: 0 };
  for (const c of costs) {
    r.quote += num(c.quote);
    if (COST_CONFIRMED.includes(c.status)) {
      if (c.status !== '무상') {
        r.confirmed += num(c.confirmed);
        r.paid += num(c.paid);
        r.unpaid += Math.max(0, num(c.confirmed) - num(c.paid));
        if (!isNum(c.confirmed)) r.missing++;
      }
    } else if (COST_PENDING.includes(c.status)) {
      r.pending += num(c.quote);
      if (!isNum(c.quote)) r.missing++;
    }
  }
  return r;
}
// 견적비 = 견적금액(VAT 별도) 합계 (자동), 확정 제작비·실제 지급액 = 직접 입력
function projCost(p) {
  const r = { quote: 0, quotes: 0, confirmed: num(p.costFinal), paid: num(p.costPaid) };
  (p.costs || []).forEach(c => { if (isNum(c.quote)) { r.quote += c.quote; r.quotes++; } });
  return r;
}
function calcAll() {
  const t = { total: DB.projects.length, active: 0, done: 0, confirmed: 0, quote: 0, paid: 0 };
  for (const p of DB.projects) {
    if (['설계 중', '제작 준비', '제작 중', '수정·보완'].includes(p.status)) t.active++;
    if (p.status === '제작 완료') t.done++;
    const c = projCost(p); t.confirmed += c.confirmed; t.quote += c.quote; t.paid += c.paid;
  }
  return t;
}

// 어디에서도 참조하지 않는 브라우저 저장 파일만 삭제 (저장 성공 후에만 호출)
async function gcFiles() {
  try {
    const used = new Set();
    DB.projects.forEach(p => { if (p.imageFileId) used.add(p.imageFileId); p.docs.forEach(d => { if (d.fileId) used.add(d.fileId); }); p.costs.forEach(c => { if (c.quoteFileId) used.add(c.quoteFileId); }); Object.values(p.vendorInfo || {}).forEach(v => { if (v && v.quoteFileId) used.add(v.quoteFileId); }); });
    const all = await FileStore.all(), gone = all.filter(f => !used.has(f.id));
    await Promise.all(gone.map(f => FileStore.del(f.id)));
    if (gone.length) save();
  } catch (e) { /* 정리 실패는 데이터 손실이 아니므로 무시 */ }
}
// 백업 파일의 금형 1건 검증·정리. 문제가 있으면 오류 메시지를 던짐
function sanitizeProject(raw, i) {
  const where = `${i + 1}번째 금형`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where}: 형식 오류`);
  const str = v => (v == null ? '' : String(v));
  const num = v => (v == null || v === '' ? null : (Number.isFinite(+v) ? +v : null));
  const objs = (k) => {
    if (raw[k] == null) return [];
    if (!Array.isArray(raw[k])) throw new Error(`${where}: ${k} 가 목록 형식이 아님`);
    raw[k].forEach((x, j) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${where}: ${k} ${j + 1}번째 항목 형식 오류`); });
    return raw[k];
  };
  const dwgNo = str(raw.dwgNo).trim().toUpperCase();
  if (!dwgNo) throw new Error(`${where}: 도번 없음`);
  if (/[\/\\#?%]/.test(dwgNo)) throw new Error(`${where}: 도번 ${dwgNo} 에 쓸 수 없는 문자(/ \\ # ? %)`);
  const P = {};
  ['model', 'moldType', 'cavities', 'material', 'resin', 'startDate', 'endDate', 'designer', 'maker', 'manager', 'summary', 'folder', 'imagePath', 'viewerPath', 'createdAt', 'updatedAt'].forEach(k => { P[k] = str(raw[k]); });
  P.dwgNo = dwgNo;
  P.status = STATUSES.includes(raw.status) ? raw.status : '';
  P.imageFileId = raw.imageFileId ? str(raw.imageFileId) : null;
  if (!P.createdAt) delete P.createdAt; if (!P.updatedAt) delete P.updatedAt;
  P.costs = objs('costs').map(c => ({ id: str(c.id) || uid('c'), item: str(c.item), vendor: str(c.vendor), quote: num(c.quote), confirmed: num(c.confirmed), paid: num(c.paid),
    vat: VATS.includes(c.vat) ? c.vat : '미확인', status: COST_STATUSES.includes(c.status) ? c.status : '확인 필요', note: str(c.note), quoteFileId: c.quoteFileId ? str(c.quoteFileId) : null }));
  if ('costFinal' in raw) P.costFinal = num(raw.costFinal);
  if ('costPaid' in raw) P.costPaid = num(raw.costPaid);
  P.logs = objs('logs').map(l => ({ id: str(l.id) || uid('l'), date: str(l.date), title: str(l.title), category: LOG_CATS.includes(l.category) ? l.category : '기타', vendor: str(l.vendor),
    detail: str(l.detail), action: str(l.action), state: LOG_STATES.includes(l.state) ? l.state : '참고', files: str(l.files), createdAt: str(l.createdAt) || nowISO() }));
  P.docs = objs('docs').map(x => ({ id: str(x.id) || uid('d'), type: DOC_TYPES.includes(x.type) ? x.type : '기타 자료', name: str(x.name), desc: str(x.desc),
    mode: x.mode === 'stored' ? 'stored' : 'link', path: str(x.path), fileId: x.fileId ? str(x.fileId) : null, date: str(x.date), size: num(x.size) }));
  P.vendorInfo = {};
  if (raw.vendorInfo && typeof raw.vendorInfo === 'object' && !Array.isArray(raw.vendorInfo))
    Object.entries(raw.vendorInfo).forEach(([k, v]) => { if (v && typeof v === 'object') P.vendorInfo[str(k)] = { cost: num(v.cost), memo: str(v.memo), quoteFileId: v.quoteFileId ? str(v.quoteFileId) : null }; });
  return normalizeProject(P);
}

/* ---------------- path / file open ---------------- */
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
// 허용: 상대경로, http(s), file — javascript:, data: 등은 차단
function resolvePath(path) {
  try { const u = new URL(path, location.href); return ['http:', 'https:', 'file:'].includes(u.protocol) ? u.href : null; } catch (e) { return null; }
}
function openTab(url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove(); }
let BLOB_URLS = [];
function releaseBlobs() { BLOB_URLS.forEach(u => URL.revokeObjectURL(u)); BLOB_URLS = []; }
// 연결 경로(index.html 기준 상대경로)를 '클로드 만능봉수' 폴더 기준 경로로 정리 → 클라우드 파일 목록(DB.cloudFiles)의 열쇠
function normPath(path) {
  const s = safeDecode(String(path || '').trim()).replace(/\\/g, '/');
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return null;
  const out = [];
  for (const seg of ('HAERI_MOLD_MANAGER/' + s).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/').normalize('NFC');
}
const isExternal = path => /^https?:\/\//i.test(String(path || '').trim());
function cloudEntry(path) { const np = normPath(path); return np ? (DB.cloudFiles || {})[np] || null : null; }
const MIME = { html: 'text/html', htm: 'text/html', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', json: 'application/json', mp4: 'video/mp4',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const extOf = n => { const m = /\.([a-z0-9]{1,8})$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
const typed = (blob, name) => { const t = MIME[extOf(name)]; return t ? new Blob([blob], { type: t }) : blob; };
async function cloudBlob(key, name) {
  const { data, error } = await SB.storage.from(BUCKET).download(key);
  if (error) throw error;
  return typed(data, name);
}
const NOT_UP = path => `클라우드에 아직 올리지 않은 파일입니다: ${path}\n[설정 및 백업 → 연결 파일 올리기]에서 올려 주세요.`;
// 큰 파일은 받는 데 시간이 걸려 팝업이 막히므로, 클릭하는 순간 새 탭부터 열어 둠
function pendingTab(label) {
  const w = window.open('', '_blank');
  if (w) { try { w.document.title = '불러오는 중…'; w.document.body.style.cssText = 'font-family:sans-serif;background:#1d2229;color:#ccd;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'; w.document.body.textContent = (label || '파일') + ' 불러오는 중…'; } catch (e) {} }
  return w;
}
async function checkPath(path) {
  // returns 'ok' | 'missing' | 'unknown'
  if (!path) return 'missing';
  if (isExternal(path)) return resolvePath(path) ? 'unknown' : 'missing';
  return cloudEntry(path) ? 'ok' : 'missing';
}
async function openPath(path, label) {
  if (!path) { toast((label || '파일') + ' 경로가 지정되지 않았습니다.', 'warn'); return; }
  if (isExternal(path)) { if (!resolvePath(path)) { toast('허용되지 않는 경로입니다: ' + path, 'err'); return; } openTab(resolvePath(path)); return; }
  const ent = cloudEntry(path);
  if (!ent) { toast(NOT_UP(path), 'err'); return; }
  const name = safeDecode(path.split(/[\\/]/).pop());
  const w = pendingTab(label || name);
  try {
    const url = URL.createObjectURL(await cloudBlob(ent.key, name));
    if (w && !w.closed) w.location.href = url; else openTab(url);
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
  } catch (e) { if (w) w.close(); toast('파일 열기 실패: ' + (e.message || e), 'err'); }
}
async function downloadPath(path, name) {
  if (isExternal(path)) {
    if (!resolvePath(path)) { toast('허용되지 않는 경로입니다: ' + path, 'err'); return; }
    const a = document.createElement('a'); a.href = resolvePath(path); a.download = name || ''; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); return;
  }
  const ent = cloudEntry(path);
  if (!ent) { toast(NOT_UP(path), 'err'); return; }
  try {
    toast('내려받는 중…');
    const url = URL.createObjectURL(await cloudBlob(ent.key, name));
    const a = document.createElement('a'); a.href = url; a.download = name || safeDecode(path.split(/[\\/]/).pop()); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast('내려받기 실패: ' + (e.message || e), 'err'); }
}
async function openStored(fileId, download) {
  const m = (DB.fileMeta || {})[fileId], name = m ? m.name : '';
  // HTML·SVG 같은 실행 가능한 문서는 직접 열지 않고 내려받기로 처리
  if (!download && /(^|\.)(html?|svg|xml|js)$/i.test(name)) { download = true; toast('HTML·SVG 파일은 안전을 위해 내려받기로 처리합니다. 3D 뷰어는 ‘경로 연결’ 방식으로 등록하세요.', 'warn'); }
  const w = download ? null : pendingTab(name);
  try {
    const f = await FileStore.get(fileId);
    if (!f) { if (w) w.close(); toast('저장된 파일을 찾을 수 없습니다.', 'err'); return; }
    const url = URL.createObjectURL(typed(f.blob, f.name));
    if (download) { const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
    else if (w && !w.closed) w.location.href = url; else openTab(url);
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
  } catch (e) { if (w) w.close(); toast('파일 열기 실패: ' + (e.message || e), 'err'); }
}
const SIGNED = new Map();   // 이미지 임시 주소 캐시 (key → {url, exp})
async function signedUrl(key) {
  const c = SIGNED.get(key); if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await SB.storage.from(BUCKET).createSignedUrl(key, 3600);
  if (error) throw error;
  SIGNED.set(key, { url: data.signedUrl, exp: Date.now() + 50 * 60000 });
  return data.signedUrl;
}
function hydrateStoredImages(root) {
  $$('img[data-fid]', root).forEach(img => {
    signedUrl(FileStore.key(img.dataset.fid)).then(u => { if (img.isConnected) img.src = u; }).catch(() => { if (img.isConnected) img.replaceWith(document.createTextNode('이미지 없음')); });
  });
  $$('img[data-cpath]', root).forEach(img => {
    const ent = cloudEntry(img.dataset.cpath);
    if (!ent) { img.replaceWith(document.createTextNode('이미지 미업로드')); return; }
    signedUrl(ent.key).then(u => { if (img.isConnected) img.src = u; }).catch(() => { if (img.isConnected) img.replaceWith(document.createTextNode('이미지 오류')); });
  });
}
function thumbHTML(p) {
  if (p.imageFileId) return `<img data-fid="${esc(p.imageFileId)}" alt="">`;
  if (p.imagePath && isExternal(p.imagePath)) return `<img src="${esc(resolvePath(p.imagePath))}" alt="" onerror="this.replaceWith(document.createTextNode('이미지 경로 오류'))">`;
  if (p.imagePath) return `<img data-cpath="${esc(p.imagePath)}" alt="">`;
  return '<span>대표 이미지 없음</span>';
}

/* ---------------- 연결 파일 올리기 ---------------- */
function linkedPaths() {
  const m = new Map();
  const add = (path, label) => { if (!path || isExternal(path)) return; const np = normPath(path); if (np && !m.has(np)) m.set(np, { path, label }); };
  DB.projects.forEach(p => { add(p.imagePath, p.dwgNo + ' 대표 이미지'); add(p.viewerPath, p.dwgNo + ' 3D 뷰어'); p.docs.forEach(d => { if (d.mode !== 'stored') add(d.path, p.dwgNo + ' ' + d.type); }); });
  return m;
}
const RAW_RE = /\.(dwg|dxf|stp|step|igs|iges|x_t|x_b|prt|sldprt|sldasm|catpart|catproduct|ipt|iam)$/i;
function pickFolder() {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
    inp.onchange = () => res([...inp.files]); inp.addEventListener('cancel', () => res([]));
    inp.click();
  });
}
async function sha(s) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32); }
const mbs = n => (n / 1048576).toFixed(1) + 'MB';
async function uploadLinked() {
  const files = await pickFolder(); if (!files.length) return;
  const root = (files[0].webkitRelativePath || '').split('/')[0];
  const byPath = new Map();
  files.forEach(f => { const parts = (f.webkitRelativePath || f.name).split('/'); parts.shift(); let rel = parts.join('/'); if (root === 'HAERI_MOLD_MANAGER') rel = 'HAERI_MOLD_MANAGER/' + rel; byPath.set(rel.normalize('NFC'), f); });
  const cf = DB.cloudFiles || {}, rows = [];
  linkedPaths().forEach((v, np) => { const f = byPath.get(np); rows.push(Object.assign({ np, f, done: !!(cf[np] && f && cf[np].size === f.size), big: !!(f && f.size > MAX_FILE), raw: RAW_RE.test(np) }, v)); });
  const todo = rows.filter(r => r.f && !r.done && !r.big), done = rows.filter(r => r.done);
  const miss = rows.filter(r => !r.f && !cf[r.np]), big = rows.filter(r => r.big);
  const rawTodo = todo.filter(r => r.raw), normTodo = todo.filter(r => !r.raw);
  const sum = a => a.reduce((s, r) => s + r.f.size, 0);
  const li = a => a.map(r => `<div class="path">${esc(r.label)} · ${esc(r.path)}${r.f ? ' (' + mbs(r.f.size) + ')' : ''}</div>`).join('');
  if (!todo.length) {
    return modal('연결 파일 올리기', `<div style="line-height:1.8">선택한 폴더: <b>${esc(root)}</b><br>올릴 새 파일이 없습니다. (이미 올림 ${done.length}개)${miss.length ? `<br><br><b style="color:var(--warn)">폴더에서 찾지 못한 연결 ${miss.length}개</b> — 바탕화면 Ax\\클로드 만능봉수 폴더를 선택했는지 확인하세요.${li(miss)}` : ''}${big.length ? `<br><br><b style="color:var(--warn)">50MB가 넘어 올릴 수 없는 파일 ${big.length}개</b>${li(big)}` : ''}</div>`, [{ text: '닫기' }]);
  }
  modal('연결 파일 올리기', `<div style="line-height:1.8">선택한 폴더: <b>${esc(root)}</b><br>
    올릴 파일: 뷰어·이미지·문서 <b>${normTodo.length}개 (${mbs(sum(normTodo))})</b>${rawTodo.length ? `, 도면 원본(DWG·STP 등) ${rawTodo.length}개 (${mbs(sum(rawTodo))})` : ''}<br>이미 올림: ${done.length}개
    ${rawTodo.length ? `<label style="display:block;margin-top:8px"><input type="checkbox" id="up_raw"> 도면 원본(DWG·STP)도 올리기 — 무료 용량 1GB를 많이 씁니다</label>` : ''}
    ${miss.length ? `<details style="margin-top:8px"><summary style="color:var(--warn)">폴더에서 찾지 못한 연결 ${miss.length}개</summary>${li(miss)}</details>` : ''}
    ${big.length ? `<details style="margin-top:8px"><summary style="color:var(--warn)">50MB가 넘어 올릴 수 없는 파일 ${big.length}개</summary>${li(big)}</details>` : ''}
    <div id="up_prog" class="hint" style="margin-top:10px"></div></div>`, [
    { text: '취소' },
    { text: '올리기', cls: 'pri', fn: async r => {
      const list = ($('#up_raw', r) && $('#up_raw', r).checked) ? todo : normTodo;
      const prog = $('#up_prog', r); let n = 0, fail = [];
      for (const it of list) {
        prog.textContent = `${n + 1}/${list.length} 올리는 중… ${it.path} (${mbs(it.f.size)})`;
        const ext = extOf(it.np), key = 'l/' + await sha(it.np) + (ext ? '.' + ext : '');
        const { error } = await SB.storage.from(BUCKET).upload(key, it.f, { upsert: true, contentType: MIME[ext] || it.f.type || 'application/octet-stream' });
        if (error) { fail.push(it.path + ': ' + error.message); continue; }
        DB.cloudFiles = DB.cloudFiles || {};
        DB.cloudFiles[it.np] = { key, size: it.f.size, at: nowISO(), by: who() };
        n++; save('연결 파일 올리기');
      }
      route();
      if (fail.length) { prog.innerHTML = `<span style="color:var(--bad)">${n}개 올림, ${fail.length}개 실패</span><br>` + fail.map(esc).join('<br>'); return false; }
      toast(`${n}개 파일을 올렸습니다. 이제 팀원도 열 수 있습니다.`);
    } }]);
}

/* ---------------- 도번 ---------------- */
const DWG_RE = /^HR(\d{2})-(\d{2})(\d{2,})$/;
function suggestDwg(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const yy = String(d.getFullYear()).slice(2), mm = String(d.getMonth() + 1).padStart(2, '0');
  let max = 0;
  DB.projects.forEach(p => { const m = DWG_RE.exec(p.dwgNo); if (m && m[1] === yy && m[2] === mm) max = Math.max(max, parseInt(m[3], 10)); });
  return `HR${yy}-${mm}${String(max + 1).padStart(2, '0')}`;
}
function projYear(p) {
  const m = DWG_RE.exec(p.dwgNo); if (m) return '20' + m[1];
  if (p.startDate) return p.startDate.slice(0, 4);
  return '';
}

/* ---------------- routing ---------------- */
const UI = { list: { q: '', year: '', status: '', sort: 'updated', mode: 'card', page: 1 } };
try { Object.assign(UI.list, JSON.parse(localStorage.getItem('haeri_mms_ui') || '{}')); UI.list.page = 1; } catch (e) {}
UI.cur = ''; try { UI.cur = JSON.parse(localStorage.getItem('haeri_mms_ui') || '{}').cur || ''; } catch (e) {}
UI.cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
const saveUI = () => { try { localStorage.setItem('haeri_mms_ui', JSON.stringify({ mode: UI.list.mode, sort: UI.list.sort, cur: UI.cur })); } catch (e) {} };
// 탭 → 왼쪽 메뉴 매핑
const NAV_OF_TAB = { overview: 'overview', history: 'overview', viewer: 'overview', costs: 'costs', vendors: 'vendors', docs: 'docs' };
function renderNav(view, id, tab) {
  if (view === 'project' && getP(id) && UI.cur !== id) { UI.cur = id; saveUI(); }
  const p = UI.cur ? getP(UI.cur) : null;
  const box = $('#navProject');
  if (!p) { box.innerHTML = ''; }
  else {
    const pid = encodeURIComponent(p.dwgNo), on = view === 'project' && id === p.dwgNo ? NAV_OF_TAB[tab || 'overview'] : '';
    const M = [['overview', '◫', '금형 프로젝트'], ['costs', '₩', '제작비 관리'], ['vendors', '⛭', '협력업체 관리'], ['docs', '▤', '문서 관리']];
    box.innerHTML = `<div class="navp"><div class="navp-h"><span>선택한 금형</span><button class="navp-x" data-act="closeProj" title="선택 해제">✕</button></div>
      <div class="navp-t" title="${esc(dispName(p))}">${esc(dispName(p))}</div>
      ${M.map(([k, i, t]) => `<a href="#/project/${pid}/${k}" class="${on === k ? 'on' : ''}"><i>${i}</i>${t}</a>`).join('')}</div>`;
  }
  $$('#nav > a').forEach(a => a.classList.toggle('on', a.dataset.nav === view || (a.dataset.nav === 'projects' && view === 'project')));
}

function route() {
  if (!DB) return;
  releaseBlobs();
  const h = safeDecode(location.hash.replace(/^#\/?/, '')) || 'dashboard';
  const [view, id, tab] = h.split('/');
  renderNav(view, id, tab);
  const main = $('#main');
  main.scrollTop = 0;
  let html = '';
  if (view === 'project') {
    const p = getP(id);
    html = p ? viewDetail(p, tab || 'overview') : `<div class="empty">도번 <b>${esc(id)}</b> 프로젝트를 찾을 수 없습니다. <a href="#/projects">목록으로</a></div>`;
  } else if (view === 'projects') html = viewProjects(false);
  else if (view === 'costs') html = viewCosts();
  else if (view === 'vendors') html = viewVendors();
  else if (view === 'docs') html = viewDocs();
  else if (view === 'settings') html = viewSettings();
  else if (view === 'inventory') html = viewInventory();
  else if (view === 'repair') html = viewRepair();
  else html = viewProjects(true);
  main.innerHTML = `<div class="fade">${html}</div>`;
  hydrateStoredImages(main);
  if (view === 'settings') fillStorageInfo();
}
/* ---------------- 공구·부품 재고 (inventory.html을 안에 띄우고 데이터는 DB.inventory에 저장) ---------------- */
function viewInventory() {
  return `<div class="inv-head"><div><h2 class="inv-t">공구·부품 재고관리</h2><div class="muted">작업 전에 부족한 공구와 부품을 미리 찾습니다. 입력한 내용은 팀원과 함께 보고 자동 저장됩니다.</div></div>
    <button class="btn ghost sm" data-act="invPrd">기획서(PRD) 보기</button></div>
    <iframe id="invFrame" class="inv-frame" src="inventory.html?v=2" title="공구·부품 재고관리"></iframe>`;
}
function sendInv() {
  const f = $('#invFrame'); if (!f || !f.contentWindow || !DB) return;
  f.contentWindow.postMessage({ type: 'inv-data', data: DB.inventory ? jclone(DB.inventory) : null, who: who() }, location.origin);
}
window.addEventListener('message', e => {
  const f = $('#invFrame');
  if (e.origin !== location.origin || !f || e.source !== f.contentWindow || !DB) return;
  const m = e.data || {};
  if (m.type === 'inv-ready') return sendInv();
  if (m.type === 'inv-save' && m.data && Array.isArray(m.data.tools) && Array.isArray(m.data.parts)) {
    if (READONLY) { toast(READONLY, 'err'); return sendInv(); }
    DB.inventory = jclone(m.data); save('공구·부품 재고');
  }
});
function mdToHtml(md) {
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', lst = '';
  const close = () => { if (lst) { html += `</${lst}>`; lst = ''; } };
  md.split(/\r?\n/).forEach(line => {
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); html += `<h${m[1].length + 2}>${inl(m[2])}</h${m[1].length + 2}>`; }
    else if ((m = line.match(/^(\s*)-\s+(.*)/))) { if (lst !== 'ul') { close(); html += '<ul>'; lst = 'ul'; } html += `<li${m[1].length ? ' class="sub"' : ''}>${inl(m[2])}</li>`; }
    else if ((m = line.match(/^\d+\.\s+(.*)/))) { if (lst !== 'ol') { close(); html += '<ol>'; lst = 'ol'; } html += `<li>${inl(m[1])}</li>`; }
    else if (line.trim()) { close(); html += `<p>${inl(line)}</p>`; }
  });
  close(); return html;
}
/* ---------------- 금형수리이력 (repair.html을 안에 띄우고 데이터는 DB.repairHist에 저장) ---------------- */
function viewRepair() {
  return `<div class="inv-head"><div><h2 class="inv-t">금형수리이력</h2><div class="muted">수리·치수수정·설계변경 이력을 3D 부위와 함께 남기고, 계속 고칠지 다시 만들지 판단합니다. 입력한 내용은 팀원과 함께 보고 자동 저장됩니다.</div></div>
    <button class="btn ghost sm" data-act="repPrd">기획서(PRD) 보기</button></div>
    <iframe id="repFrame" class="inv-frame rep-frame" src="repair.html?v=3" title="금형수리이력"></iframe>`;
}
// 금형수리이력 안에 대시보드와 같은 3D 뷰어 파일을 띄움 (한 번 받은 파일은 다시 받지 않음)
const repViewerCache = {};
async function sendRepViewer(id) {
  const f = $('#repFrame'); if (!f || !f.contentWindow) return;
  const reply = o => f.contentWindow && f.contentWindow.postMessage(Object.assign({ type: 'hist-viewer', mold_id: id }, o), location.origin);
  const p = (DB.projects || []).find(x => x.dwgNo === id), path = p && p.viewerPath;
  if (!path) return reply({ err: '이 금형은 3D 뷰어가 아직 없습니다. 대시보드의 3D 뷰어 탭에서 뷰어 파일을 연결하세요.' });
  if (repViewerCache[path]) return reply({ url: repViewerCache[path] });
  if (isExternal(path)) { const u = resolvePath(path); return reply(u ? { url: u } : { err: '허용되지 않는 뷰어 경로입니다.' }); }
  const ent = cloudEntry(path);
  if (!ent) return reply({ err: '3D 뷰어 파일이 아직 클라우드에 올라가 있지 않습니다.' });
  try {
    const url = URL.createObjectURL(await cloudBlob(ent.key, safeDecode(path.split(/[\\/]/).pop())));
    repViewerCache[path] = url; reply({ url });
  } catch (e) { reply({ err: '3D 뷰어를 불러오지 못했습니다: ' + (e.message || e) }); }
}
function sendRep() {
  const f = $('#repFrame'); if (!f || !f.contentWindow || !DB) return;
  const projects = (DB.projects || []).map(p => ({ dwgNo: p.dwgNo, model: p.model, cavities: p.cavities, resin: p.resin, maker: p.maker, designer: p.designer }));
  const pj = JSON.stringify(projects), changed = pj !== sendRep.lastProjects; sendRep.lastProjects = pj;
  f.contentWindow.postMessage({ type: 'hist-data', data: DB.repairHist ? jclone(DB.repairHist) : null, projects, projectsChanged: changed, who: who() }, location.origin);
}
window.addEventListener('message', e => {
  const f = $('#repFrame');
  if (e.origin !== location.origin || !f || e.source !== f.contentWindow || !DB) return;
  const m = e.data || {};
  if (m.type === 'hist-ready') return sendRep();
  if (m.type === 'hist-viewer') return sendRepViewer(String(m.mold_id || ''));
  if (m.type === 'hist-save' && m.data && Array.isArray(m.data.molds) && Array.isArray(m.data.events)) {
    if (READONLY) { toast(READONLY, 'err'); return sendRep(); }
    DB.repairHist = jclone(m.data); save('금형수리이력');
  }
});
async function showRepPrd() {
  let md;
  try { const r = await fetch('docs/repair_prd.md?v=1', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); md = await r.text(); }
  catch (e) { return toast('기획서를 불러오지 못했습니다: ' + e.message, 'err'); }
  modal('금형수리이력 기획서 (PRD)', `<div class="md">${mdToHtml(md)}</div>`, [{ text: '닫기' }]);
}
async function showInvPrd() {
  let md;
  try { const r = await fetch('docs/inventory_prd.md?v=1', { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); md = await r.text(); }
  catch (e) { return toast('기획서를 불러오지 못했습니다: ' + e.message, 'err'); }
  modal('공구·부품 재고관리 기획서 (PRD)', `<div class="md">${mdToHtml(md)}</div>`, [{ text: '닫기' }]);
}
const go = h => { if (location.hash === h) route(); else location.hash = h; };

/* ---------------- views: dashboard / list ---------------- */
function kpis() {
  const t = calcAll();
  return `<div class="kpis">
    <div class="kpi" style="--c:var(--ac2)"><div class="k">전체 등록 금형</div><div class="v">${t.total}<small>건</small></div><div class="d">등록된 모든 프로젝트</div></div>
    <div class="kpi" style="--c:var(--ac)"><div class="k">진행 중</div><div class="v">${t.active}<small>건</small></div><div class="d">설계 중 · 제작 준비 · 제작 중 · 수정·보완</div></div>
    <div class="kpi" style="--c:var(--ok)"><div class="k">제작 완료</div><div class="v">${t.done}<small>건</small></div><div class="d">상태가 ‘제작 완료’인 금형</div></div>
  </div>`;
}
function filteredProjects() {
  const L = UI.list, q = L.q.trim().toLowerCase();
  let arr = DB.projects.filter(p => {
    if (L.year && projYear(p) !== L.year) return false;
    if (L.status === '__none') { if (p.status) return false; }
    else if (L.status && p.status !== L.status) return false;
    if (!q) return true;
    const hay = [p.dwgNo, p.model, dispName(p), p.maker, p.designer, ...p.costs.map(c => c.vendor), ...p.logs.map(l => l.vendor)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const S = {
    updated: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    dwgDesc: (a, b) => b.dwgNo.localeCompare(a.dwgNo, 'ko', { numeric: true }),
    dwgAsc: (a, b) => a.dwgNo.localeCompare(b.dwgNo, 'ko', { numeric: true }),
    start: (a, b) => (b.startDate || '').localeCompare(a.startDate || ''),
    model: (a, b) => a.model.localeCompare(b.model, 'ko'),
    cost: (a, b) => projCost(b).quote - projCost(a).quote,
  };
  return arr.sort(S[L.sort] || S.updated);
}
const PAGE = 24;
function projectListHTML() {
  const arr = filteredProjects(), L = UI.list;
  if (!DB.projects.length) return `<div class="empty">등록된 금형이 없습니다. <button class="btn pri sm" data-act="newProject">＋ 새 금형 등록</button></div>`;
  if (!arr.length) return `<div class="empty">조건에 맞는 금형이 없습니다.</div>`;
  const pages = Math.max(1, Math.ceil(arr.length / PAGE)); L.page = Math.min(L.page, pages);
  const rows = arr.slice((L.page - 1) * PAGE, L.page * PAGE);
  let body;
  if (L.mode === 'table') {
    body = `<div class="tblwrap"><table class="tbl"><thead><tr><th></th><th>도번</th><th>모델명</th><th>상태</th><th>작업 시작</th><th>작업 완료</th><th>제작업체</th><th class="r">견적비</th><th>최종 수정</th></tr></thead><tbody>
      ${rows.map(p => { const c = projCost(p); return `<tr class="click" data-open="${esc(p.dwgNo)}">
        <td><div class="tmini">${thumbHTML(p)}</div></td><td class="mono" style="color:var(--ac)">${esc(p.dwgNo)}</td><td><b>${esc(p.model)}</b></td><td>${badge(p.status)}</td>
        <td>${esc(p.startDate) || '<span class="muted">—</span>'}</td><td>${esc(p.endDate) || '<span class="muted">—</span>'}</td><td>${esc(p.maker) || '<span class="muted">—</span>'}</td>
        <td class="r money">${c.quotes ? won(c.quote) : '—'}</td><td class="muted">${fmtDT(p.updatedAt)}</td></tr>`; }).join('')}
      </tbody></table></div>`;
  } else {
    body = `<div class="pgrid">${rows.map(p => { const c = projCost(p); return `<div class="pcard" data-open="${esc(p.dwgNo)}">
      <div class="thumb">${thumbHTML(p)}<span class="st">${badge(p.status)}</span></div>
      <div class="pbody"><div class="pno">${esc(p.dwgNo)}</div><div class="pname">${esc(p.model) || '<span class="muted">모델명 미입력</span>'}</div>
        <div class="pmeta"><span>작업 기간</span><span>${esc(p.startDate) || '—'} ~ ${esc(p.endDate) || '—'}</span><span>제작업체</span><span>${esc(p.maker) || '—'}</span></div>
        <div class="pfoot"><span>견적 <span class="money">${c.quotes ? won(c.quote) : '—'}</span></span><span>수정 ${fmtD(p.updatedAt)}</span></div></div></div>`; }).join('')}</div>`;
  }
  const pager = pages > 1 ? `<div class="pager"><button class="btn sm" data-page="${L.page - 1}" ${L.page <= 1 ? 'disabled' : ''}>‹ 이전</button> ${L.page} / ${pages} 페이지 · ${arr.length}건 <button class="btn sm" data-page="${L.page + 1}" ${L.page >= pages ? 'disabled' : ''}>다음 ›</button></div>` : `<div class="pager">${arr.length}건</div>`;
  return body + pager;
}
function viewProjects(isDash) {
  const L = UI.list;
  const years = [...new Set(DB.projects.map(projYear).filter(Boolean))].sort().reverse();
  const backupWarn = (() => {
    const last = DB.lastExportAt ? new Date(DB.lastExportAt) : null;
    const days = last ? (Date.now() - last) / 864e5 : Infinity;
    if (days < 7 && !(BackupDir.handle && BackupDir.needPerm)) return '';
    if (BackupDir.handle && BackupDir.needPerm) return `<div class="warnbox"><span>자동 백업 대기 중 — 화면을 한 번 클릭한 뒤 폴더 사용 허용을 눌러 주세요. (‘방문할 때마다 허용’을 고르면 다음부터 묻지 않습니다)</span></div>`;
    return `<div class="warnbox"><span>⚠ ${last ? `마지막 JSON 백업이 ${Math.floor(days)}일 전입니다.` : '아직 JSON 백업을 한 번도 받지 않았습니다.'} 브라우저 저장 데이터는 영구 보관이 보장되지 않습니다 (캐시 삭제·PC 교체 시 사라질 수 있음).</span>${BackupDir.handle ? '<button class="btn sm" data-act="export">지금 백업</button>' : '<button class="btn sm" data-act="linkBackup">data 폴더 연결 (자동 백업)</button>'}</div>`;
  })();
  const dashExtra = isDash ? `${backupWarn}${kpis()}
    <div class="panel calpanel"><h3>작업 일정 <span class="muted" style="font-weight:400;font-size:12px">날짜를 누르면 일정을 추가·삭제할 수 있습니다</span></h3><div id="calBox">${calendarHTML()}</div></div>` : '';
  return `<div class="page-h"><div><h1>${isDash ? '대시보드' : '금형 프로젝트'}</h1><div class="sub">${isDash ? '작업 일정과 금형 목록 · 금형을 누르면 왼쪽에 해당 금형의 관리 메뉴가 열립니다' : '도번 · 모델명 · 협력업체로 검색'}</div></div>
    <button class="btn pri" data-act="newProject">＋ 새 금형 등록</button></div>
    ${dashExtra}
    <div class="panel" style="padding-bottom:20px"><h3>금형 프로젝트 목록</h3>
    <div class="toolbar">
      <div class="search"><input type="search" id="fQ" placeholder="도번, 모델명, 협력업체 검색" value="${esc(L.q)}"></div>
      <select id="fYear"><option value="">전체 연도</option>${years.map(y => `<option ${L.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <select id="fStatus"><option value="">전체 상태</option>${STATUSES.map(s => `<option ${L.status === s ? 'selected' : ''}>${s}</option>`).join('')}<option value="__none" ${L.status === '__none' ? 'selected' : ''}>미입력·확인 필요</option></select>
      <select id="fSort">${[['updated', '최근 수정순'], ['dwgDesc', '도번 내림차순'], ['dwgAsc', '도번 오름차순'], ['start', '작업 시작일순'], ['model', '모델명순'], ['cost', '견적비순']].map(([v, t]) => `<option value="${v}" ${L.sort === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <div class="seg"><button data-mode="card" class="${L.mode === 'card' ? 'on' : ''}">▦ 카드</button><button data-mode="table" class="${L.mode === 'table' ? 'on' : ''}">☰ 표</button></div>
    </div>
    <div id="plist">${projectListHTML()}</div></div>`;
}
/* ---------------- 달력 일정 ---------------- */
const CAL_COLORS = ['#2fc6c0', '#3b8beb', '#f0b543', '#a48cf0', '#3ccf8e', '#ef8a6b'];
function calColor(dwgNo) { if (!dwgNo) return '#7b879c'; let h = 0; for (const ch of dwgNo) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return CAL_COLORS[h % CAL_COLORS.length]; }
// 일정 색: 직접 고른 색이 있으면 그 색, 없으면(예전 일정) 도번으로 정해지던 색
const CAL_PALETTE = [['#e5484d', '빨강'], ['#f76b15', '주황'], ['#f0b543', '노랑'], ['#3ccf8e', '초록'], ['#2fc6c0', '청록'], ['#3b8beb', '파랑'], ['#a48cf0', '보라'], ['#7b879c', '회색']];
const schedColor = x => x.color || calColor(x.dwgNo);
// 달력 표시: 도번 + 내용 (예: HR26-0701 가공)
function schedLabel(x) {
  if (!x.dwgNo || x.title.startsWith(x.dwgNo)) return x.title;
  return x.dwgNo + ' ' + x.title;
}
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function calendarHTML() {
  const { y, m } = UI.cal;
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), tdy = today();
  const byDate = {};
  (DB.schedules || []).forEach(x => { (byDate[x.date] = byDate[x.date] || []).push(x); });
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cday out"></div>');
  for (let d = 1; d <= days; d++) {
    const date = ymd(y, m, d), dow = (first + d - 1) % 7, ev = byDate[date] || [];
    cells.push(`<div class="cday${date === tdy ? ' today' : ''}${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}" data-day="${date}">
      <div class="dn">${d}</div>${ev.slice(0, 3).map(x => `<div class="cev" style="--c:${schedColor(x)}" title="${esc(schedLabel(x))}">${esc(schedLabel(x))}</div>`).join('')}${ev.length > 3 ? `<div class="cmore">+${ev.length - 3}건</div>` : ''}</div>`);
  }
  while (cells.length % 7) cells.push('<div class="cday out"></div>');
  return `<div class="calh"><button class="btn sm" data-cal="-1">‹</button><b>${y}년 ${m + 1}월</b><button class="btn sm" data-cal="1">›</button><button class="btn sm ghost" data-cal="0">오늘</button></div>
  <div class="cal"><div class="cw sun">일</div><div class="cw">월</div><div class="cw">화</div><div class="cw">수</div><div class="cw">목</div><div class="cw">금</div><div class="cw sat">토</div>${cells.join('')}</div>`;
}
function refreshCal() { const el = $('#calBox'); if (el) el.innerHTML = calendarHTML(); }
function dayModal(date) {
  const W = '일월화수목금토'[new Date(date + 'T00:00').getDay()];
  let editing = null;   // 수정 중인 일정 id
  const pal = (cur, attr) => `<div class="cpick">${CAL_PALETTE.map(([c, n]) => `<button type="button" class="csw sm${c === cur ? ' on' : ''}" ${attr}="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}<label class="ccustom" title="다른 색 직접 고르기"><input type="color" data-ecc value="${esc(cur)}" aria-label="다른 색 직접 고르기">직접</label></div>`;
  const editHTML = x => `<div class="sitem sedit" data-sid="${esc(x.id)}"><div class="form" style="width:100%">
      <label>관련 금형<select data-ef="dwgNo"><option value="">(선택 안 함)</option>${DB.projects.map(p => `<option value="${esc(p.dwgNo)}" ${p.dwgNo === x.dwgNo ? 'selected' : ''}>${esc(dispName(p))}</option>`).join('')}</select></label>
      <label>날짜<input type="date" data-ef="date" value="${esc(x.date)}"></label>
      <label>일정 내용 *<input type="text" data-ef="title" value="${esc(x.dwgNo && x.title.startsWith(x.dwgNo + ' ') ? x.title.slice(x.dwgNo.length + 1) : x.title)}" autocomplete="off"></label>
      <div class="full"><div class="clabel">색</div>${pal(schedColor(x), 'data-esw')}<input type="hidden" data-ef="color" value="${esc(schedColor(x))}"></div>
      <div class="full" style="display:flex;gap:6px;justify-content:flex-end;align-items:center"><span class="hint err" data-eerr style="margin-right:auto"></span><button type="button" class="btn sm" data-scancel>취소</button><button type="button" class="btn sm pri" data-ssave="${esc(x.id)}">수정 저장</button></div></div></div>`;
  const listHTML = () => {
    const ev = DB.schedules.filter(x => x.date === date);
    return ev.length ? ev.map(x => x.id === editing ? editHTML(x) : `<div class="sitem"><input type="color" class="scol" data-scol="${esc(x.id)}" value="${esc(schedColor(x))}" title="색 바꾸기" aria-label="일정 색 바꾸기"><div class="stx"><b>${esc(schedLabel(x))}</b>${x.dwgNo && getP(x.dwgNo) && getP(x.dwgNo).model ? `<span class="muted"> · ${esc(getP(x.dwgNo).model)}</span>` : ''}</div><button class="btn sm" data-sedit="${esc(x.id)}">✎ 수정</button><button class="btn sm danger" data-sdel="${esc(x.id)}">삭제</button></div>`).join('')
      : '<div class="muted" style="padding:6px 0">등록된 일정이 없습니다.</div>';
  };
  const cur = UI.cur && getP(UI.cur) ? UI.cur : '';
  if (!/^#[0-9a-f]{6}$/i.test(UI.calColor || '')) UI.calColor = localStorage.getItem('haeri_cal_color') || CAL_PALETTE[5][0];
  const root = modal(`${date} (${W}) 일정`, `<div id="sd_list">${listHTML()}</div>
    <div class="form" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px">
      <label>관련 금형<select id="sd_p"><option value="">(선택 안 함)</option>${DB.projects.map(p => `<option value="${esc(p.dwgNo)}" ${p.dwgNo === cur ? 'selected' : ''}>${esc(dispName(p))}</option>`).join('')}</select></label>
      <label>일정 내용 *<input type="text" id="sd_t" placeholder="예: 가공, 시사출, 몰드베이스 입고" autocomplete="off"></label>
      <div class="full"><div class="clabel">색</div><div class="cpick" id="sd_c" role="radiogroup" aria-label="일정 색">${CAL_PALETTE.map(([c, n]) => `<button type="button" class="csw${c === UI.calColor ? ' on' : ''}" data-csw="${c}" style="--c:${c}" title="${n}" aria-label="${n}" role="radio" aria-checked="${c === UI.calColor}"></button>`).join('')}<label class="ccustom" title="다른 색 직접 고르기"><input type="color" id="sd_cc" value="${esc(UI.calColor)}" aria-label="다른 색 직접 고르기">직접</label></div></div>
      <span class="hint full">금형을 고르면 달력에 ‘도번 + 내용’으로 표시됩니다 (예: HR26-0701 가공). 등록한 일정의 날짜·내용·금형·색은 위 목록의 ‘수정’으로 바꿀 수 있습니다.</span>
      <span class="hint err full" id="sd_err"></span></div>`, [
    { text: '닫기' },
    { text: '일정 추가', cls: 'pri', fn: r => {
      const t = $('#sd_t', r).value.trim();
      if (!t) { $('#sd_err', r).textContent = '일정 내용을 입력하세요.'; $('#sd_t', r).focus(); return false; }
      const b = snap();
      DB.schedules.push({ id: uid('s'), date, title: t, dwgNo: $('#sd_p', r).value, color: UI.calColor });
      if (!save()) { restore(b); return false; }
      $('#sd_t', r).value = ''; $('#sd_err', r).textContent = ''; $('#sd_list', r).innerHTML = listHTML(); refreshCal();
      toast('일정을 추가했습니다'); $('#sd_t', r).focus();
      return false; // 창을 열어 둔 채 계속 추가 가능
    } }]);
  $('#sd_t', root).focus();
  $('#sd_t', root).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); root.querySelector('[data-mbtn="1"]').click(); } });
  const setColor = c => {
    UI.calColor = c; try { localStorage.setItem('haeri_cal_color', c); } catch (e) {}
    root.querySelectorAll('[data-csw]').forEach(s => { const on = s.dataset.csw === c; s.classList.toggle('on', on); s.setAttribute('aria-checked', on); });
    $('#sd_cc', root).value = c;
  };
  $('#sd_cc', root).addEventListener('input', e => setColor(e.target.value.toLowerCase()));
  const box = root.querySelector('.mback');
  const redraw = () => { $('#sd_list', root).innerHTML = listHTML(); refreshCal(); };
  box.addEventListener('input', e => {
    const cc = e.target.closest('[data-ecc]'); if (!cc) return;
    const ed = cc.closest('.sedit'); const c = cc.value.toLowerCase();
    ed.querySelector('[data-ef="color"]').value = c; ed.querySelectorAll('[data-esw]').forEach(s => s.classList.toggle('on', s.dataset.esw === c));
  });
  box.addEventListener('keydown', e => {
    const ed = e.target.closest('.sedit'); if (!ed) return;
    if (e.key === 'Enter' && !e.isComposing && e.target.matches('input[type=text]')) { e.preventDefault(); e.stopPropagation(); ed.querySelector('[data-ssave]').click(); }
  }, true);
  box.addEventListener('change', e => {
    const inp = e.target.closest('[data-scol]'); if (!inp) return;
    const x = DB.schedules.find(s => s.id === inp.dataset.scol); if (!x) return;
    const bk = snap(); x.color = inp.value.toLowerCase();
    if (!save()) { restore(bk); return; }
    redraw();
  });
  let deleting = false;
  box.addEventListener('click', async e => {
    const sw = e.target.closest('[data-csw]'); if (sw) { setColor(sw.dataset.csw); return; }
    const esw = e.target.closest('[data-esw]');
    if (esw) { const ed = esw.closest('.sedit'); ed.querySelector('[data-ef="color"]').value = esw.dataset.esw; ed.querySelector('[data-ecc]').value = esw.dataset.esw; ed.querySelectorAll('[data-esw]').forEach(s => s.classList.toggle('on', s === esw)); return; }
    const be = e.target.closest('[data-sedit]'); if (be) { editing = be.dataset.sedit; redraw(); const t = root.querySelector('.sedit [data-ef="title"]'); if (t) { t.focus(); t.select(); } return; }
    if (e.target.closest('[data-scancel]')) { editing = null; redraw(); return; }
    const bs = e.target.closest('[data-ssave]');
    if (bs) {
      const x = DB.schedules.find(s => s.id === bs.dataset.ssave), ed = bs.closest('.sedit'); if (!x) { editing = null; return redraw(); }
      const title = ed.querySelector('[data-ef="title"]').value.trim();
      if (!title) { ed.querySelector('[data-eerr]').textContent = '일정 내용을 입력하세요.'; return; }
      const nd = ed.querySelector('[data-ef="date"]').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) { ed.querySelector('[data-eerr]').textContent = '날짜를 고르세요.'; return; }
      const bk = snap(); x.title = title; x.dwgNo = ed.querySelector('[data-ef="dwgNo"]').value; x.color = ed.querySelector('[data-ef="color"]').value; x.date = nd;
      if (!save()) { restore(bk); return; }
      editing = null; redraw();
      if (nd !== date) { const [, mm, dd] = nd.split('-').map(Number); toast(`${mm}월 ${dd}일로 옮겼습니다`); } else toast('일정을 수정했습니다');
      return;
    }
    const b = e.target.closest('[data-sdel]'); if (!b || deleting) return;
    const x = DB.schedules.find(s => s.id === b.dataset.sdel); if (!x) return;
    deleting = true;
    const ok = await confirmBox('일정 삭제', `<b>${esc(date)}</b> ‘${esc(schedLabel(x))}’ 일정을 삭제할까요?`, '삭제', true);
    deleting = false; if (!ok) return;
    const bk = snap(); DB.schedules = DB.schedules.filter(s => s !== x);
    if (!save()) { restore(bk); return; }
    if (editing === x.id) editing = null;
    redraw(); toast('일정을 삭제했습니다');
  });
}

function refreshList() { const el = $('#plist'); if (el) { el.innerHTML = projectListHTML(); hydrateStoredImages(el); } }

/* ---------------- views: detail ---------------- */
const TABS = [['overview', '프로젝트 개요'], ['history', '제작 이력·특이사항'], ['viewer', '3D 뷰어'], ['costs', '제작비·견적'], ['vendors', '협력업체'], ['docs', 'BOM·문서']];
function viewDetail(p, tab) {
  const id = encodeURIComponent(p.dwgNo);
  let body = '';
  if (tab === 'costs') body = tabCosts(p);
  else if (tab === 'history') body = tabHistory(p);
  else if (tab === 'viewer') body = tabViewer(p);
  else if (tab === 'docs') body = tabDocs(p);
  else if (tab === 'vendors') body = tabVendors(p);
  else body = tabOverview(p);
  return `<div class="muted" style="margin-bottom:10px;font-size:12px"><a href="#/projects">금형 목록</a> › ${esc(dispName(p))}</div>
  <div class="dhead"><div class="thumb">${thumbHTML(p)}</div>
    <div><div class="t1">${esc(p.dwgNo)}</div><div class="t2">${esc(p.model) || '<span class="muted">모델명 미입력</span>'}</div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${badge(p.status)}<span class="muted" style="font-size:12px">표시명 ${esc(dispName(p))} · 최종 수정 ${fmtDT(p.updatedAt)}</span></div></div>
    <div class="acts"><button class="btn" data-act="openViewer" data-id="${esc(p.dwgNo)}">⬚ 3D 뷰어 열기</button><button class="btn" data-act="editProject" data-id="${esc(p.dwgNo)}">✎ 정보 수정</button><button class="btn danger" data-act="delProject" data-id="${esc(p.dwgNo)}">삭제</button></div></div>
  <div class="tabs">${TABS.map(([k, t]) => `<a href="#/project/${id}/${k}" class="${tab === k ? 'on' : ''}">${t}</a>`).join('')}</div>
  <div id="tabBody" data-id="${esc(p.dwgNo)}">${body}</div>`;
}
function tabOverview(p) {
  const c = projCost(p);
  const important = sortedLogs(p).filter(l => l.state === '미해결' || l.state === '진행 중' || (l.category === '문제 발생' && l.state !== '해결'));
  const solved = sortedLogs(p).filter(l => l.state === '해결');
  const F = [['도번', p.dwgNo], ['모델명', p.model], ['금형 종류', p.moldType], ['캐비티 수', p.cavities], ['금형 재질', p.material], ['수지', p.resin],
    ['작업 시작일', p.startDate], ['작업 완료일', p.endDate], ['작업 상태', null], ['설계 담당자', p.designer], ['제작 담당 업체', p.maker], ['프로젝트 담당자', p.manager], ['프로젝트 폴더', p.folder]];
  return `<div class="grid2"><div>
    <div class="panel"><h3>기본 정보 <button class="btn sm" data-act="editProject" data-id="${esc(p.dwgNo)}">✎ 수정</button></h3>
    <div class="kv">${F.map(([k, v]) => `<div>${k}</div><div>${k === '작업 상태' ? badge(p.status) : k === '프로젝트 폴더' && v ? `<span class="path">${esc(v)}</span>` : valOr(v)}</div>`).join('')}</div></div>
    <div class="panel"><h3>금형 개요</h3><div class="pre" style="line-height:1.7;color:var(--tx2)">${p.summary ? esc(p.summary) : '<span class="empty-v">미입력</span>'}</div></div>
  </div><div>
    <div class="panel"><h3>제작비 요약 <a href="#/project/${encodeURIComponent(p.dwgNo)}/costs" style="font-size:12px;font-weight:500">상세 ›</a></h3>
      <div class="csum">
        <div class="cs main"><span>견적비 <em>VAT 별도</em></span><b>${c.quotes ? won(c.quote) : '<i>미입력</i>'}</b></div></div></div>
    <div class="panel"><h3>주요 특이사항 <a href="#/project/${encodeURIComponent(p.dwgNo)}/history" style="font-size:12px;font-weight:500">전체 이력 ›</a></h3>
      ${important.length ? important.map(l => `<div class="issue" data-go="#/project/${encodeURIComponent(p.dwgNo)}/history"><span class="badge ${LOG_BADGE[l.state]}">${esc(l.state)}</span><div><div class="it">${esc(l.title)}</div><div class="im">${esc(l.category)} · ${esc(l.vendor || '업체 미지정')} · ${esc(l.date || '날짜 미입력')}</div></div></div>`).join('') : '<div class="muted">현재 해결 중인 문제 없음</div>'}
      ${solved.length ? `<div class="issub">해결된 문제 이력 <span>${solved.length}건</span></div>${solved.map(l => `<div class="issue done" data-go="#/project/${encodeURIComponent(p.dwgNo)}/history"><span class="badge ${LOG_BADGE[l.state]}">해결</span><div><div class="it">${esc(l.title)}</div><div class="im">${esc(l.category)} · ${esc(l.vendor || '업체 미지정')} · ${esc(l.date || '날짜 미입력')}</div>${l.action ? `<div class="ia">조치: ${esc(l.action)}</div>` : ''}</div></div>`).join('')}` : ''}</div>
  </div></div>`;
}
function costRow(c) {
  const opt = (arr, v) => arr.map(s => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('');
  const m = v => isNum(v) ? v.toLocaleString('ko-KR') : '';
  return `<tr data-cid="${esc(c.id)}">
    <td class="c dragc"><span class="dragh" data-drag="${esc(c.id)}" tabindex="0" role="button" title="끌어서 순서 바꾸기 (키보드: Alt+↑↓)" aria-label="끌어서 순서 바꾸기">⠿</span></td>
    <td><input data-f="item" value="${esc(c.item)}" placeholder="항목"></td>
    <td><input data-f="vendor" value="${esc(c.vendor)}" placeholder="업체명"></td>
    <td><input class="num" data-f="quote" data-money value="${m(c.quote)}" placeholder="—"></td>
    <td>${quoteCell(c)}</td>
    <td><input data-f="note" value="${esc(c.note)}" placeholder="비고" title="${esc(c.note)}"></td>
    <td class="c"><button class="btn icon sm danger" data-act="delCost" data-cid="${esc(c.id)}" title="행 삭제">✕</button></td></tr>`;
}
// 제작비 요약: 총 합계 + 어디에 많이 들었는지 (항목별/업체별 막대, 큰 순서)
function costSummaryHTML(p) {
  const by = UI.costBy === 'vendor' ? 'vendor' : 'item';
  const g = new Map(); let total = 0, n = 0;
  (p.costs || []).forEach(c => { if (!isNum(c.quote)) return; const k = String(c[by] || '').trim() || (by === 'item' ? '(항목 없음)' : '(업체 없음)'); g.set(k, (g.get(k) || 0) + c.quote); total += c.quote; n++; });
  const arr = [...g.entries()].sort((a, b) => b[1] - a[1]);
  const max = arr.length ? Math.max(...arr.map(x => x[1])) : 0;
  const pct = v => total ? (v / total * 100) : 0;
  const top = arr[0];
  const head = `<div class="csumtop"><div class="ctot"><div class="k">총 합계 <span>견적금액 합 · VAT 별도</span></div><div class="v" id="costQuoteSum">${won(total)}</div>
      <div class="d">VAT 포함 ${won(Math.round(total * 1.1))} · ${n}건</div></div>
    <div class="cbars"><div class="cbh"><b>어디에 가장 많이 들었나?</b><span class="seg"><button type="button" class="${by === 'item' ? 'on' : ''}" data-costby="item">항목별</button><button type="button" class="${by === 'vendor' ? 'on' : ''}" data-costby="vendor">업체별</button></span></div>
      ${top ? `<div class="cbans">가장 큰 지출: <b>${esc(top[0])}</b> · 전체의 <b>${pct(top[1]).toFixed(0)}%</b> (${won(top[1])})</div>` : ''}
      <div class="cbl" role="img" aria-label="${esc(by === 'item' ? '항목별' : '업체별')} 견적금액. ${top ? esc(top[0]) + '이 가장 큼 ' + pct(top[1]).toFixed(0) + '%' : '자료 없음'}">
      ${arr.length ? arr.map(([k, v], i) => `<div class="cbr${i === 0 ? ' top' : ''}"><span class="cbk" title="${esc(k)}">${esc(k)}</span><span class="cbt"><i style="width:${max ? Math.max(2, v / max * 100) : 0}%"></i></span><span class="cbv">${won(v)} <em>${pct(v).toFixed(1)}%</em></span></div>`).join('')
        : '<div class="muted" style="padding:8px 0">견적금액을 입력하면 여기에 보입니다.</div>'}</div></div></div>`;
  return head;
}
function refreshCostSummary(p) { const el = $('#costSummary'); if (el) el.innerHTML = costSummaryHTML(p); }
function costTotalsHTML(p) {
  const c = projCost(p), m = v => isNum(v) ? v.toLocaleString('ko-KR') : '';
  return `<div class="tot main"><div class="k">견적비 <span>VAT 별도 · 자동 합계</span></div><div class="v" id="costQuoteSum">${won(c.quote)}</div></div>`;
}
function quoteCell(c) {
  const id = esc(c.id), fid = c.quoteFileId, m = fid ? (DB.fileMeta || {})[fid] : null;
  return fid ? `<div class="qcell"><button class="btn sm qbtn" data-act="viewQuote" data-cid="${id}" title="${esc(m ? m.name : '견적서')}">📄 견적서 보기</button><button class="btn icon sm" data-act="upQuote" data-cid="${id}" title="다른 파일로 바꾸기">⟳</button><button class="btn icon sm danger" data-act="delQuote" data-cid="${id}" title="견적서 지우기">✕</button></div>`
    : `<button class="btn sm qadd" data-act="upQuote" data-cid="${id}" title="PDF · 사진(JPG·PNG) · 엑셀">＋ 견적서 올리기</button>`;
}
function tabCosts(p) {
  return `<div class="panel"><h3>제작비 및 견적 <span><button class="btn sm pri" data-act="addCost">＋ 행 추가</button></span></h3>
    <div id="costSummary">${costSummaryHTML(p)}</div>
    <div class="tblwrap"><table class="tbl ctbl"><thead><tr><th style="width:40px" class="c" title="끌어서 순서 바꾸기">순서</th><th style="width:19%">항목</th><th style="width:17%">업체명</th><th class="r" style="width:16%">견적금액 (₩, VAT 별도)</th><th style="width:19%">견적서</th><th>비고</th><th style="width:48px" class="c">삭제</th></tr></thead>
    <tbody id="costBody">${p.costs.map(costRow).join('') || ''}</tbody></table>${p.costs.length ? '' : '<div class="empty">제작비 항목이 없습니다. ‘행 추가’를 누르세요.</div>'}</div>
    <div class="note">· 견적금액은 <b>VAT 별도</b> 금액으로 적습니다. 총 합계와 위 막대는 입력하는 대로 바로 바뀝니다. 항목 이름을 ‘재료비’, ‘가공비’처럼 같게 적으면 한 막대로 합쳐집니다.<br>
    · 순서는 행 왼쪽 <b>⠿</b> 손잡이를 잡고 위아래로 끌어다 놓으면 바뀝니다.<br>
    · 견적서는 <b>PDF · 사진(JPG·PNG 등) · 엑셀</b>로 올릴 수 있고, <b>견적서 보기</b>로 대시보드 안에서 바로 열립니다. 입력 즉시 자동 저장됩니다.</div></div>`;
}
function sortedLogs(p) {
  return [...p.logs].sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1; if (!a.date && b.date) return 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}
function tabHistory(p) {
  const logs = sortedLogs(p);
  return `<div class="panel"><h3>제작 이력 및 특이사항 <span class="muted">최근 기록 순 · 날짜 미입력 기록은 아래쪽</span><button class="btn sm pri" data-act="addLog">＋ 기록 추가</button></h3>
  ${logs.length ? logs.map(l => `<div class="log ${LOG_STATE_CLS[l.state] || ''}">
    <div class="lh"><span class="badge ${LOG_BADGE[l.state] || 'b-none'}">${esc(l.state)}</span><span class="tag">${esc(l.category)}</span><span class="lt">${esc(l.title)}</span><span class="ld">${esc(l.date || '날짜 미입력')}</span>
    <div class="la"><button class="btn sm" data-act="editLog" data-lid="${esc(l.id)}">✎ 수정</button><button class="btn sm danger" data-act="delLog" data-lid="${esc(l.id)}">삭제</button></div></div>
    <div class="lb"><span>관련 업체</span><span>${valOr(l.vendor)}</span><span>상세 내용</span><span class="pre">${valOr(l.detail)}</span><span>조치 내용</span><span class="pre">${valOr(l.action)}</span>${l.files ? `<span>첨부</span><span class="path pre">${esc(l.files)}</span>` : ''}</div></div>`).join('') : '<div class="empty">기록이 없습니다.</div>'}</div>`;
}
function tabViewer(p) {
  return `<div class="panel"><h3>3D 뷰어</h3>
    <div class="infobox">기존 3D 뷰어 HTML 파일을 <b>새 탭</b>으로 엽니다. 뷰어 파일은 수정하지 않습니다. 현재 뷰어는 3D 엔진(three.js)을 인터넷에서 불러오므로 <b>뷰어를 볼 때는 인터넷 연결</b>이 필요합니다 (대시보드 자체는 오프라인 동작).</div>
    <div class="form"><label class="full">뷰어 HTML 경로 (index.html 기준 상대경로)
      <div class="rowf"><input type="text" id="viewerPath" value="${esc(p.viewerPath)}" placeholder="예: molds/${esc(dispName(p))}/viewer/뷰어.html"><button class="btn" data-act="saveViewer">경로 저장</button><button class="btn" data-act="checkViewer">경로 확인</button><button class="btn pri" data-act="openViewer" data-id="${esc(p.dwgNo)}">새 탭에서 열기 ↗</button></div>
      <span class="hint" id="viewerCheck">프로젝트마다 다른 뷰어 HTML을 지정할 수 있습니다.</span></label></div></div>`;
}
function tabDocs(p) {
  return `<div class="panel"><h3>BOM 및 문서 <button class="btn sm pri" data-act="addDoc">＋ 문서 등록</button></h3>
  <div class="infobox"><span class="tag link">경로 연결</span> 기존 프로젝트 폴더의 파일을 상대경로로 연결합니다 (파일은 원래 위치 그대로). &nbsp; <span class="tag stored">브라우저 저장</span> 파일을 이 브라우저(IndexedDB)에 복사해 보관합니다 — JSON 백업에 포함되지 않으니 원본 파일은 프로젝트 폴더에 따로 보관하세요.</div>
  ${p.docs.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>종류</th><th>파일명</th><th>설명</th><th>방식</th><th>경로 / 크기</th><th>등록일</th><th class="c" style="width:210px">작업</th></tr></thead><tbody>
    ${p.docs.map(d => `<tr><td><span class="tag">${esc(d.type)}</span></td><td><b>${esc(d.name)}</b></td><td class="muted">${esc(d.desc)}</td>
      <td>${d.mode === 'stored' ? '<span class="tag stored">브라우저 저장</span>' : '<span class="tag link">경로 연결</span>'}</td>
      <td class="path">${d.mode === 'stored' ? (d.size ? (d.size / 1024 / 1024).toFixed(2) + ' MB' : '') : esc(d.path)}</td><td class="muted">${esc(d.date)}</td>
      <td class="c"><button class="btn sm" data-act="openDoc" data-did="${esc(d.id)}">열기</button> <button class="btn sm" data-act="dlDoc" data-did="${esc(d.id)}">다운로드</button> <button class="btn sm danger" data-act="delDoc" data-did="${esc(d.id)}">삭제</button></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">등록된 문서가 없습니다.</div>'}
  <div class="note">권장 폴더: <span class="path">${esc(p.folder || 'molds/' + dispName(p) + '/')}</span> 아래 viewer / bom / manuals / drawings / quotations / images. 기존 파일은 이동하지 않고 현재 위치를 연결해 두었습니다.</div></div>`;
}

/* ---------------- views: 전체 제작비 / 업체 / 문서 / 설정 ---------------- */
function viewCosts() {
  const all = calcAll();
  const rows = [];
  DB.projects.forEach(p => p.costs.forEach(c => rows.push({ p, c })));
  return `<div class="page-h"><div><h1>제작비 관리</h1><div class="sub">모든 금형의 제작비 행 모음 · 수정은 각 금형의 ‘제작비·견적’ 탭에서</div></div></div>
  <div class="totals t1" style="margin:0 0 18px">
    <div class="tot main"><div class="k">견적비 합계 <span>VAT 별도</span></div><div class="v">${won(all.quote)}</div></div></div>
  <div class="tblwrap"><table class="tbl"><thead><tr><th>금형</th><th>항목</th><th>업체</th><th class="r">견적금액 (VAT 별도)</th><th class="c">견적서</th><th>비고</th></tr></thead><tbody>
  ${rows.map(({ p, c }) => `<tr class="click" data-go="#/project/${encodeURIComponent(p.dwgNo)}/costs"><td class="mono" style="color:var(--ac)">${esc(dispName(p))}</td><td>${esc(c.item)}</td><td>${esc(c.vendor)}</td><td class="r money">${won(c.quote)}</td><td class="c">${c.quoteFileId ? '<span class="tag">📄 첨부</span>' : '<span class="muted">—</span>'}</td><td class="muted">${esc(c.note)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">제작비 항목 없음</td></tr>'}
  </tbody></table></div>
  <div class="note">2단계 예정: 업체별 견적 비교, 연도·월별 제작비 통계 차트.</div>`;
}
// '업체A (몰드베이스), 업체B' → [{name:'업체A', note:'몰드베이스'}, {name:'업체B', note:''}]
function splitVendors(txt) {
  return String(txt || '').split(/[,，\/\n]|·/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.match(/^(.*?)\s*[\(（]([^)）]*)[\)）]\s*$/);
    return m ? { name: m[1].trim(), note: m[2].trim() } : { name: x, note: '' };
  }).filter(v => v.name);
}
// 한 금형의 협력업체: 설계 담당자 → '금형 설계', 제작 담당 업체 → '금형 제작', 제작비 행의 업체 → 그 항목
function projVendors(p) {
  const V = new Map();
  const add = (name, role) => {
    const k = String(name || '').trim(); if (!k) return;
    if (!V.has(k)) V.set(k, { name: k, roles: [], issues: 0 });
    const v = V.get(k); if (role && !v.roles.includes(role)) v.roles.push(role);
  };
  splitVendors(p.designer).forEach(v => add(v.name, '금형 설계' + (v.note ? ' (' + v.note + ')' : '')));
  splitVendors(p.maker).forEach(v => add(v.name, '금형 제작' + (v.note ? ' (' + v.note + ')' : '')));
  p.costs.forEach(c => add(c.vendor, c.item || ''));
  p.logs.forEach(l => { const k = String(l.vendor || '').trim(); if (k && V.has(k)) V.get(k).issues++; });
  V.forEach(v => { v.quote = 0; v.hasQuote = false; });
  p.costs.forEach(c => { const v = V.get(String(c.vendor || '').trim()); if (v && isNum(c.quote)) { v.quote += c.quote; v.hasQuote = true; } });
  return [...V.values()].map(v => Object.assign(v, { info: Object.assign({ cost: null, memo: '', quoteFileId: null }, (p.vendorInfo || {})[v.name]) }));
}
function vInfo(p, name) { p.vendorInfo = p.vendorInfo || {}; return p.vendorInfo[name] = Object.assign({ cost: null, memo: '', quoteFileId: null }, p.vendorInfo[name]); }
function tabVendors(p) {
  const arr = projVendors(p);
  const m = v => isNum(v) ? v.toLocaleString('ko-KR') : '';
  return `<div class="panel"><h3>협력업체 <span class="muted" style="font-size:12px;font-weight:400">정보 수정의 설계 담당자 · 제작 담당 업체, 제작비 행의 업체가 자동으로 들어옵니다</span></h3>
  <div class="tblwrap"><table class="tbl vtbl"><thead><tr><th style="width:18%">업체명</th><th style="width:24%">담당 항목</th><th class="r" style="width:16%">견적금액 (VAT 별도)</th><th>메모</th></tr></thead><tbody id="vendBody">
  ${arr.map(v => `<tr data-vn="${esc(v.name)}"><td><b>${esc(v.name)}</b>${v.issues ? `<div><a class="muted" style="font-size:11.5px" href="#/project/${encodeURIComponent(p.dwgNo)}/history">관련 기록 ${v.issues}건</a></div>` : ''}</td>
    <td>${v.roles.length ? v.roles.map(r => `<span class="tag">${esc(r)}</span>`).join(' ') : '<span class="muted">—</span>'}</td>
    <td class="r money">${v.hasQuote ? won(v.quote) : '<span class="muted">—</span>'}</td>
    <td><textarea data-vf="memo" rows="1" placeholder="메모">${esc(v.info.memo)}</textarea></td></tr>`).join('') || '<tr><td colspan="4" class="empty">업체가 없습니다. ‘정보 수정’에서 설계 담당자나 제작 담당 업체를 입력하세요.</td></tr>'}
  </tbody></table></div>
  <div class="note">· 업체가 여러 곳이면 정보 수정에서 쉼표로 나눠 적으세요. 예) 모아텍 (코어 가공), SG몰드코리아 (몰드베이스)<br>· 견적금액과 견적서는 <a href="#/project/${encodeURIComponent(p.dwgNo)}/costs">제작비·견적</a> 탭에서 입력합니다. 메모는 입력 즉시 자동 저장됩니다.</div></div>`;
}
function viewVendors() {
  const V = new Map();
  DB.projects.forEach(p => projVendors(p).forEach(v => {
    if (!V.has(v.name)) V.set(v.name, { name: v.name, roles: new Set(), projects: [], cost: 0, has: false });
    const t = V.get(v.name); v.roles.forEach(r => t.roles.add(r.replace(/\s*\(.*\)$/, ''))); t.projects.push(p); t.cost += v.quote; if (v.hasQuote) t.has = true;
  }));
  const arr = [...V.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return `<div class="page-h"><div><h1>협력업체 관리</h1><div class="sub">각 금형의 설계·제작 담당과 제작비 행에서 자동 집계 · 견적금액은 각 금형의 ‘제작비·견적’ 탭에서 입력</div></div></div>
  <div class="tblwrap"><table class="tbl"><thead><tr><th>업체명</th><th>담당 항목</th><th>관련 금형</th><th class="r">견적금액 합계 (VAT 별도)</th></tr></thead><tbody>
  ${arr.map(v => `<tr><td><b>${esc(v.name)}</b></td><td>${[...v.roles].filter(Boolean).map(r => `<span class="tag">${esc(r)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
    <td>${v.projects.map(p => `<a href="#/project/${encodeURIComponent(p.dwgNo)}/vendors">${esc(dispName(p))}</a>`).join(', ')}</td>
    <td class="r money">${v.has ? won(v.cost) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">업체 데이터 없음</td></tr>'}
  </tbody></table></div><div class="note">금형 이름을 누르면 그 금형의 협력업체 탭으로 갑니다.</div>`;
}
function viewDocs() {
  const rows = []; DB.projects.forEach(p => p.docs.forEach(d => rows.push({ p, d })));
  return `<div class="page-h"><div><h1>문서 관리</h1><div class="sub">모든 금형에 등록된 문서 · 등록·삭제는 각 금형의 ‘BOM·문서’ 탭에서</div></div></div>
  <div class="tblwrap"><table class="tbl"><thead><tr><th>금형</th><th>종류</th><th>파일명</th><th>방식</th><th>등록일</th><th class="c">작업</th></tr></thead><tbody>
  ${rows.map(({ p, d }) => `<tr><td class="mono"><a href="#/project/${encodeURIComponent(p.dwgNo)}/docs">${esc(dispName(p))}</a></td><td><span class="tag">${esc(d.type)}</span></td><td>${esc(d.name)}</td><td>${d.mode === 'stored' ? '<span class="tag stored">브라우저 저장</span>' : '<span class="tag link">경로 연결</span>'}</td><td class="muted">${esc(d.date)}</td>
    <td class="c"><button class="btn sm" data-act="openDoc" data-pid="${esc(p.dwgNo)}" data-did="${esc(d.id)}">열기</button> <button class="btn sm" data-act="dlDoc" data-pid="${esc(p.dwgNo)}" data-did="${esc(d.id)}">다운로드</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">문서 없음</td></tr>'}
  </tbody></table></div><div class="note">2단계 예정: 도면·파일 버전 관리, BOM 자동 분석, PDF 미리보기.</div>`;
}
function viewSettings() {
  const s = DB.settings;
  return `<div class="page-h"><div><h1>설정 및 백업</h1><div class="sub">데이터 백업·복원과 기본 설정</div></div></div>
  ${READONLY ? `<div class="warnbox"><span>⚠ ${esc(READONLY)}</span>${CORRUPT_RAW ? '<button class="btn sm" data-act="dlCorrupt">손상 원문 내려받기</button>' : ''}</div>` : ''}
  <div class="grid2"><div>
  <div class="panel"><h3>JSON 백업 · 복원</h3>
    <div class="infobox" style="display:block">데이터는 <b>클라우드(Supabase)</b>에 저장되어 로그인한 팀원 모두 같은 내용을 봅니다. 그래도 가끔 JSON 백업을 받아 <span class="path">HAERI_MOLD_MANAGER/data/</span>에 보관해 두세요.</div>
    <div class="kv"><div>마지막 자동 저장</div><div>${fmtDT(DB.savedAt)}</div><div>마지막 JSON 백업</div><div>${DB.lastExportAt ? fmtDT(DB.lastExportAt) : '<span style="color:var(--warn)">없음</span>'}</div><div>등록 금형</div><div>${DB.projects.length}건</div><div>자동 백업 폴더</div><div>${BackupDir.handle ? esc(BackupDir.handle.name) + (BackupDir.needPerm ? ' <span style="color:var(--warn)">(허용 필요)</span>' : ' · 하루 1개 파일, 변경 시 덮어씀') : '<span style="color:var(--warn)">연결 안 됨</span>'}</div></div>
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap"><button class="btn pri" data-act="linkBackup">📁 ${BackupDir.handle ? '백업 폴더 다시 연결' : 'data 폴더 연결 (자동 백업)'}</button><button class="btn" data-act="export">⤓ ${BackupDir.handle ? '지금 백업' : 'JSON 백업 내려받기'}</button><button class="btn" data-act="import">⤒ JSON 백업 가져오기</button></div>
    <div class="note">· 백업 파일에는 프로젝트 정보·제작비·특이사항·문서 경로가 들어갑니다.<br>· 클라우드에 올린 파일 본체는 백업 JSON에 포함되지 않습니다. 원본은 PC 폴더에도 보관하세요.<br>· 예전(이 PC 브라우저 저장) 버전의 백업 JSON도 ‘가져오기’로 그대로 옮길 수 있습니다.</div></div>
  <div class="panel"><h3>연결 파일 올리기 (3D 뷰어·대표 이미지·문서)</h3>
    <div class="note" style="margin:0 0 12px">금형에 경로로 연결된 파일은 클라우드에 올려야 팀원이 열 수 있습니다. 버튼을 누르고 바탕화면 <b>Ax\클로드 만능봉수</b> 폴더를 선택하세요. 연결된 파일만 골라 올리고, 이미 올린 파일은 건너뜁니다. (브라우저가 ‘업로드할까요?’라고 물으면 업로드를 누르세요)</div>
    <div id="linkInfo" class="kv"></div>
    <div style="margin-top:12px"><button class="btn pri" data-act="uploadLinked">📤 폴더 선택해서 올리기</button></div></div>
  <div class="panel"><h3>저장 공간</h3><div id="storageInfo" class="muted">확인 중…</div></div>
  <div class="panel"><h3>변경 기록 (최근 30건)</h3><div id="logInfo" class="muted">불러오는 중…</div></div>
  </div><div>
  <div class="panel"><h3>기본 설정</h3><div class="form">
    <label>내 표시 이름 (내 계정에만 적용)<input type="text" id="setUser" value="${esc(who() || s.user)}"></label>
    <label>로그인 계정<input type="text" value="${esc(Cloud.user ? Cloud.user.email : '')}" disabled></label>
    <label>회사명<input type="text" id="setCompany" value="${esc(s.company)}"></label>
    <label class="full">회사 로고 파일 경로 (index.html 기준)<input type="text" id="setLogo" value="${esc(s.logoPath)}"><span class="hint">assets/logo.png 에 로고 파일을 넣으면 상단에 표시됩니다. 파일이 없으면 텍스트 로고로 표시됩니다.</span></label>
  </div><div style="margin-top:14px"><button class="btn pri" data-act="saveSettings">설정 저장</button></div></div>
  <div class="panel"><h3>개발 범위</h3><div class="note" style="margin:0">
    <b style="color:var(--tx)">현재</b> 대시보드 · 금형 등록/수정/삭제 · 상세 관리 · 제작비 자동 계산 · 제작 이력 · 클라우드 자동 저장·실시간 공유 · 팀 로그인 · 변경 기록 · JSON 백업/복원 · 3D 뷰어·문서 클라우드 열람<br>
    <b style="color:var(--tx)">2단계 (미구현)</b> 3D 뷰어 고도화 · BOM 자동 분석 · PDF 연동 · 업체별 견적 비교 · 제작비 통계 · 작업 일정 · 이력 리포트 · 파일 버전 관리</div></div>
  <div class="panel"><h3>데이터 초기화</h3><div class="note" style="margin:0 0 12px">모든 금형 데이터를 지웁니다. 실행 전 자동으로 백업 파일을 내려받습니다.</div><button class="btn danger" data-act="wipe">전체 데이터 삭제</button></div>
  </div></div>`;
}
async function fillStorageInfo() {
  const el = $('#storageInfo'); if (!el) return;
  const kb = new Blob([JSON.stringify(DB)]).size / 1024;
  const fm = Object.values(DB.fileMeta || {}), cf = Object.values(DB.cloudFiles || {});
  const sz = a => a.reduce((s, x) => s + (x.size || 0), 0);
  el.innerHTML = `금형 데이터: 약 ${kb.toFixed(1)} KB (무료 한도 500 MB)<br>연결 파일: ${cf.length}개, ${mbs(sz(cf))}<br>직접 올린 첨부: ${fm.length}개, ${mbs(sz(fm))}<br>파일 합계 무료 한도 1 GB · 파일 하나당 최대 50 MB`;
  const li = $('#linkInfo');
  if (li) { const want = linkedPaths(), cfm = DB.cloudFiles || {}; let up = 0; want.forEach((v, np) => { if (cfm[np]) up++; }); li.innerHTML = `<div>연결된 파일</div><div>${want.size}개</div><div>클라우드에 올림</div><div>${up}개</div><div>아직 안 올림</div><div>${want.size - up ? `<span style="color:var(--warn)">${want.size - up}개</span>` : '0개'}</div>`; }
  const lg = $('#logInfo');
  if (lg) {
    const { data, error } = await SB.from('mold_log').select('at,who,summary').order('id', { ascending: false }).limit(30);
    if (!lg.isConnected) return;
    lg.innerHTML = error ? '변경 기록을 불러오지 못했습니다: ' + esc(error.message)
      : (data.length ? data.map(x => `<div style="padding:3px 0;border-bottom:1px solid var(--line)">${fmtDT(x.at)} · <b>${esc(x.who || '?')}</b> · ${esc(x.summary)}</div>`).join('') : '기록 없음');
  }
}

/* ---------------- 견적서 PDF ---------------- */
function quoteRow(p, cid) { return p && p.costs.find(x => x.id === cid); }
function isQuoteFile(f) { return /\.(pdf|jpe?g|png|gif|webp|bmp|heic|xlsx|xlsm|xls|csv)$/i.test(f.name) || f.type === 'application/pdf' || /^image\//.test(f.type || ''); }
function isXlsMeta(m) { return !!m && /\.(xlsx|xlsm|xls|csv)$/i.test(m.name || ''); }
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; sc.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error('엑셀 보기 도구를 불러오지 못했습니다')); sc.onerror = () => rej(new Error('엑셀 보기 도구를 불러오지 못했습니다 (인터넷 연결 확인)')); document.head.appendChild(sc); });
}
async function showXls(box, blob) {
  const X = await loadXLSX();
  const wb = X.read(await blob.arrayBuffer(), { type: 'array' });
  const names = wb.SheetNames;
  const draw = n => { const t = box.querySelector('.xsheet'); if (t) t.innerHTML = X.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' }); box.querySelectorAll('.xtabs button').forEach(b => b.classList.toggle('pri', b.dataset.sn === n)); };
  box.classList.add('xls');
  box.innerHTML = `${names.length > 1 ? `<div class="xtabs">${names.map(n => `<button class="btn sm" data-sn="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}<div class="xsheet"></div>`;
  box.querySelectorAll('.xtabs button').forEach(b => b.onclick = e => { e.stopPropagation(); draw(b.dataset.sn); });
  draw(names[0]);
}
function isImgMeta(m) { return !!m && (/^image\//.test(m.type || '') || /\.(jpe?g|png|gif|webp|bmp|heic)$/i.test(m.name || '')); }
function quoteName(c) { return [c.vendor, c.item].filter(Boolean).join(' · ') || '견적'; }
function pickQuote(p, cid) {
  const c = quoteRow(p, cid); if (!c) return;
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.gif,.webp,.bmp,.heic,.xlsx,.xls,.xlsm,.csv';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (!isQuoteFile(f)) return toast('PDF·사진(JPG·PNG 등)·엑셀 파일만 올릴 수 있습니다.', 'warn');
    toast('견적서 올리는 중…');
    try {
      const id = await FileStore.put(f);
      const b = snap(); const row = quoteRow(curProject() || p, cid); if (!row) return;
      const old = row.quoteFileId; row.quoteFileId = id; touch(curProject() || p);
      if (!save()) { restore(b); return route(); }
      if (old) gcFiles();
      route(); toast(`${quoteName(row)} 견적서를 올렸습니다`);
    } catch (e) { toast('견적서 올리기 실패: ' + (e.message || e), 'err'); }
  };
  inp.click();
}
async function viewQuote(p, cid) {
  const c = quoteRow(p, cid), fid = c && c.quoteFileId; if (!fid) return;
  const name = quoteName(c);
  const m = (DB.fileMeta || {})[fid], fname = m ? m.name : '견적서';
  const root = modal(`${name} 견적서 · ${fname}`, '<div class="qview"><div class="muted">불러오는 중…</div></div>', [
    { text: '새 탭에서 열기', fn: () => { openStored(fid); return false; } },
    { text: '내려받기', fn: () => { openStored(fid, true); return false; } },
    { text: '닫기', cls: 'pri' }], { xl: true });
  try {
    const isImg = isImgMeta(m), isXls = isXlsMeta(m);
    if (!isImg && !isXls && navigator.pdfViewerEnabled === false) {   // 휴대폰 등 창 안에서 PDF를 못 여는 브라우저
      const box = root.querySelector('.qview');
      if (box) box.innerHTML = '<div class="qfall">이 브라우저는 창 안에서 PDF를 보여 주지 못합니다.<br>아래 <b>새 탭에서 열기</b> 또는 <b>내려받기</b>를 눌러 주세요.</div>';
      return;
    }
    const f = await FileStore.get(fid);
    if (!f) throw new Error('저장된 파일을 찾을 수 없습니다');
    if (isXls) { const box = root.querySelector('.qview'); if (box) await showXls(box, f.blob); return; }
    const url = URL.createObjectURL(isImg ? f.blob : new Blob([f.blob], { type: 'application/pdf' }));
    const box = root.querySelector('.qview'); if (!box) return URL.revokeObjectURL(url);
    box.innerHTML = isImg ? `<img class="qimg" src="${url}" alt="견적서">` : `<iframe src="${url}" title="견적서"></iframe>`;
    setTimeout(() => URL.revokeObjectURL(url), 30 * 60000);
  } catch (e) { const box = root.querySelector('.qview'); if (box) box.innerHTML = `<div class="hint err">견적서를 열지 못했습니다: ${esc(e.message || e)}</div>`; }
}

/* ---------------- modal ---------------- */
function modal(title, bodyHTML, buttons, opts) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="mback"><div class="modal ${opts && opts.sm ? 'sm' : ''} ${opts && opts.xl ? 'xl' : ''}"><div class="mh">${esc(title)}<button class="btn icon sm ghost" data-mclose>✕</button></div><div class="mb">${bodyHTML}</div><div class="mf">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-mbtn="${i}">${esc(b.text)}</button>`).join('')}</div></div></div>`;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-mclose]').onclick = close;
  root.querySelector('.mback').addEventListener('mousedown', e => { if (e.target.classList.contains('mback')) close(); });
  let busy = false;   // 비동기 저장 중 중복 클릭 방지
  buttons.forEach((b, i) => root.querySelector(`[data-mbtn="${i}"]`).onclick = async () => {
    if (busy) return; busy = true;
    const btns = [...root.querySelectorAll('.mf .btn')]; btns.forEach(x => x.disabled = true);
    let r;
    try { r = b.fn ? await b.fn(root) : true; } catch (e) { toast('오류: ' + e.message, 'err'); r = false; }
    busy = false; btns.forEach(x => x.disabled = false);
    if (r !== false) close();
  });
  const f = root.querySelector('input,select,textarea'); if (f) f.focus();
  return root;
}
// 확인창은 별도 레이어 — 열려 있는 입력 폼을 지우지 않음. 어떤 방법으로 닫아도 결과는 한 번만 반환
function confirmBox(title, msg, okText, danger) {
  return new Promise(res => {
    const layer = document.createElement('div');
    layer.innerHTML = `<div class="mback" style="z-index:300"><div class="modal sm"><div class="mh">${esc(title)}<button class="btn icon sm ghost" data-c="0">✕</button></div><div class="mb"><div style="line-height:1.7">${msg}</div></div><div class="mf"><button class="btn" data-c="0">취소</button><button class="btn ${danger ? 'danger' : 'pri'}" data-c="1">${esc(okText || '확인')}</button></div></div></div>`;
    document.body.appendChild(layer);
    let done = false;
    const finish = v => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); layer.remove(); res(v); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    document.addEventListener('keydown', onKey, true);
    layer.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) finish(b.dataset.c === '1'); });
    layer.querySelector('.mback').addEventListener('mousedown', e => { if (e.target.classList.contains('mback')) finish(false); });
    layer.querySelector('[data-c="1"]').focus();
  });
}

/* --- 프로젝트 등록·수정 --- */
function projectForm(p) {
  const isNew = !p;
  p = p || normalizeProject({});
  const sug = suggestDwg();
  const opt = (arr, v) => arr.map(s => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('');
  const body = `<div class="form">
    <label>도번 * <div class="rowf"><input type="text" id="pf_dwg" value="${esc(p.dwgNo)}" placeholder="예: ${esc(sug)}" autocomplete="off"><button class="btn sm" type="button" id="pf_sug">추천 번호 넣기</button></div>
      <span class="hint">규칙 HR+연도2자리-월2자리+순번 · 추천: <b id="pf_sugv">${esc(sug)}</b> (직접 정해서 입력하세요)</span><span class="hint err" id="pf_err"></span></label>
    <label>모델명 *<input type="text" id="pf_model" value="${esc(p.model)}"></label>
    <label>금형 종류<input type="text" id="pf_type" value="${esc(p.moldType)}" placeholder="예: 사출금형"></label>
    <label>캐비티 수<input type="text" id="pf_cav" value="${esc(p.cavities)}"></label>
    <label>금형 재질<input type="text" id="pf_mat" value="${esc(p.material)}"></label>
    <label>수지<input type="text" id="pf_resin" value="${esc(p.resin)}"></label>
    <label>작업 시작일<input type="date" id="pf_start" value="${esc(p.startDate)}"></label>
    <label>작업 완료일<input type="date" id="pf_end" value="${esc(p.endDate)}"></label>
    <label>작업 상태<select id="pf_status"><option value="">미입력·확인 필요</option>${opt(STATUSES, p.status)}</select></label>
    <label>설계 담당자 (업체)<input type="text" id="pf_designer" value="${esc(p.designer)}" placeholder="예: DS TECH"><span class="hint">협력업체 탭에 ‘금형 설계’로 자동 등록</span></label>
    <label>제작 담당 업체<input type="text" id="pf_maker" value="${esc(p.maker)}" placeholder="예: 모아텍"><span class="hint">협력업체 탭에 ‘금형 제작’으로 자동 등록 · 여러 곳은 쉼표로</span></label>
    <label>프로젝트 담당자<input type="text" id="pf_manager" value="${esc(isNew ? (who() || DB.settings.user) : p.manager)}"></label>
    <label class="full">금형 개요<textarea id="pf_summary">${esc(p.summary)}</textarea></label>
    <label class="full">프로젝트 폴더 (상대경로)<input type="text" id="pf_folder" value="${esc(p.folder)}" placeholder="molds/도번_모델명/"></label>
    <label class="full">대표 이미지 — 경로 연결<input type="text" id="pf_img" value="${esc(p.imagePath)}" placeholder="예: molds/HR26-0901_모델/images/main.jpg"></label>
    <label class="full">대표 이미지 — 파일 직접 올리기 (클라우드 저장, 선택 시 경로보다 우선)<input type="file" id="pf_imgfile" accept="image/*">${p.imageFileId ? '<span class="hint">현재 클라우드에 올린 이미지 있음 · <a href="#" id="pf_imgdel">저장 이미지 지우기</a></span>' : ''}</label>
    <label class="full">3D 뷰어 HTML 경로<input type="text" id="pf_viewer" value="${esc(p.viewerPath)}"></label>
  </div>`;
  const root = modal(isNew ? '새 금형 등록' : '금형 정보 수정 — ' + dispName(p), body, [
    { text: '취소' },
    { text: isNew ? '등록' : '저장', cls: 'pri', fn: async r => {
      const v = id => $('#' + id, r).value.trim();
      const dwg = v('pf_dwg').toUpperCase(), model = v('pf_model');
      const err = $('#pf_err', r);
      if (!dwg) { err.textContent = '도번을 입력하세요.'; return false; }
      if (!model) { err.textContent = '모델명을 입력하세요.'; return false; }
      if (/[\/\\#?%]/.test(dwg)) { err.textContent = '도번에 / \\ # ? % 문자는 쓸 수 없습니다.'; return false; }
      if (DB.projects.some(x => x.dwgNo === dwg && x !== target)) { err.textContent = `도번 ${dwg} 은(는) 이미 등록되어 있습니다.`; return false; }
      if (!DWG_RE.test(dwg) && !(await confirmBox('도번 형식 확인', `<b>${esc(dwg)}</b> 은(는) HR26-0801 형식과 다릅니다. 그대로 저장할까요?`, '그대로 저장'))) return false;
      const before0 = snap();
      const oldNo = target ? target.dwgNo : '';
      const obj = target || normalizeProject({});
      Object.assign(obj, { dwgNo: dwg, model, moldType: v('pf_type'), cavities: v('pf_cav'), material: v('pf_mat'), resin: v('pf_resin'), startDate: v('pf_start'), endDate: v('pf_end'),
        status: $('#pf_status', r).value, designer: v('pf_designer'), maker: v('pf_maker'), manager: v('pf_manager'), summary: $('#pf_summary', r).value.trim(),
        folder: v('pf_folder') || `molds/${dwg}_${model}/`, imagePath: v('pf_img'), viewerPath: v('pf_viewer') });
      const file = $('#pf_imgfile', r).files[0];
      let newImg = null;
      if (file) { try { newImg = await FileStore.put(file); } catch (e) { restore(before0); err.textContent = '이미지 저장 실패: ' + e.message; return false; } }
      if (oldNo && oldNo !== dwg) { DB.schedules.forEach(x => { if (x.dwgNo === oldNo) x.dwgNo = dwg; }); if (UI.cur === oldNo) { UI.cur = dwg; saveUI(); } }
      const before = before0;
      if (newImg) obj.imageFileId = newImg; else if (r._delImg) obj.imageFileId = null;
      touch(obj);
      if (!target) DB.projects.push(obj);
      if (!save()) { restore(before); if (newImg) FileStore.del(newImg).catch(() => {}); route(); return false; }
      gcFiles();
      toast(isNew ? `${dispName(obj)} 등록 완료` : '저장되었습니다');
      setTimeout(() => go('#/project/' + encodeURIComponent(obj.dwgNo) + '/overview'), 0);
    } }]);
  const target = isNew ? null : p;
  $('#pf_sug', root).onclick = () => { const d = $('#pf_start', root).value; const s = suggestDwg(d || undefined); $('#pf_dwg', root).value = s; $('#pf_sugv', root).textContent = s; };
  $('#pf_start', root).addEventListener('change', e => { $('#pf_sugv', root).textContent = suggestDwg(e.target.value || undefined); });
  $('#pf_dwg', root).addEventListener('input', e => { const d = e.target.value.trim().toUpperCase(); $('#pf_err', root).textContent = DB.projects.some(x => x.dwgNo === d && x !== target) ? `도번 ${d} 은(는) 이미 등록되어 있습니다.` : ''; });
  const del = $('#pf_imgdel', root); if (del) del.onclick = e => { e.preventDefault(); root._delImg = true; del.parentElement.textContent = '저장 시 브라우저 저장 이미지를 지웁니다.'; };
}

/* --- 특이사항 --- */
function logForm(p, l) {
  const isNew = !l;
  l = l || { date: today(), title: '', category: '기타', vendor: '', detail: '', action: '', state: '미해결', files: '' };
  const opt = (arr, v) => arr.map(s => `<option ${s === v ? 'selected' : ''}>${s}</option>`).join('');
  modal(isNew ? '제작 이력 기록 추가' : '기록 수정', `<div class="form">
    <label>기록 날짜<input type="date" id="lf_date" value="${esc(l.date)}"><span class="hint">모르면 비워 두세요</span></label>
    <label>분류<select id="lf_cat">${opt(LOG_CATS, l.category)}</select></label>
    <label class="full">제목 *<input type="text" id="lf_title" value="${esc(l.title)}"></label>
    <label>관련 업체<input type="text" id="lf_vendor" value="${esc(l.vendor)}" list="vendorList"></label>
    <label>처리 상태<select id="lf_state">${opt(LOG_STATES, l.state)}</select></label>
    <label class="full">상세 내용<textarea id="lf_detail" rows="4">${esc(l.detail)}</textarea></label>
    <label class="full">조치 내용<textarea id="lf_action" rows="3">${esc(l.action)}</textarea></label>
    <label class="full">관련 첨부파일 (파일 경로 또는 파일명, 여러 개는 줄바꿈)<textarea id="lf_files" rows="2">${esc(l.files)}</textarea><span class="hint">실제 파일은 ‘BOM·문서’ 탭에 등록하고 여기에는 파일명을 적어 두세요.</span></label>
    <datalist id="vendorList">${[...new Set(DB.projects.flatMap(x => x.costs.map(c => c.vendor).concat(x.logs.map(y => y.vendor))).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('')}</datalist>
    <span class="hint err full" id="lf_err"></span></div>`, [
    { text: '취소' },
    { text: isNew ? '추가' : '저장', cls: 'pri', fn: r => {
      const g = id => $('#' + id, r).value.trim();
      if (!g('lf_title')) { $('#lf_err', r).textContent = '제목을 입력하세요.'; return false; }
      const before = snap();
      const obj = isNew ? { id: uid('l'), createdAt: nowISO() } : l;
      Object.assign(obj, { date: g('lf_date'), category: g('lf_cat'), title: g('lf_title'), vendor: g('lf_vendor'), state: g('lf_state'), detail: $('#lf_detail', r).value.trim(), action: $('#lf_action', r).value.trim(), files: $('#lf_files', r).value.trim() });
      if (isNew) p.logs.push(obj);
      touch(p);
      if (!save()) { restore(before); route(); return false; }
      route(); toast(isNew ? '기록이 추가되었습니다' : '저장되었습니다');
    } }]);
}

/* --- 문서 --- */
function docForm(p) {
  const opt = DOC_TYPES.map(s => `<option>${s}</option>`).join('');
  const root = modal('문서 등록', `<div class="form">
    <label>종류<select id="df_type">${opt}</select></label>
    <label>등록 방식<div class="radio"><label><input type="radio" name="df_mode" value="link" checked> 경로 연결</label><label><input type="radio" name="df_mode" value="stored"> 파일 직접 올리기</label></div></label>
    <label class="full" id="df_linkbox">파일 경로 (index.html 기준 상대경로)<input type="text" id="df_path" placeholder="예: molds/${esc(dispName(p))}/bom/BOM.xlsx"><span class="hint">경로만 기록합니다. 팀원이 열려면 등록 뒤 [설정 및 백업 → 연결 파일 올리기]로 파일을 올려야 합니다. 다른 폴더라면 ../ 로 올라가서 지정하세요.</span></label>
    <label class="full" id="df_filebox" hidden>파일 선택<input type="file" id="df_file"><span class="hint">클라우드에 올려 팀원 모두 열 수 있습니다 (파일당 최대 50MB). JSON 백업에는 파일 본체가 들어가지 않습니다.</span></label>
    <label class="full">파일명 (비우면 경로/파일에서 자동)<input type="text" id="df_name"></label>
    <label class="full">설명<input type="text" id="df_desc"></label>
    <span class="hint err full" id="df_err"></span></div>`, [
    { text: '취소' },
    { text: '등록', cls: 'pri', fn: async r => {
      const mode = $('input[name=df_mode]:checked', r).value, err = $('#df_err', r);
      const d = { id: uid('d'), type: $('#df_type', r).value, desc: $('#df_desc', r).value.trim(), mode, date: today() };
      if (mode === 'link') {
        const path = $('#df_path', r).value.trim(); if (!path) { err.textContent = '경로를 입력하세요.'; return false; }
        const st = await checkPath(path);
        if (st === 'missing' && !(await confirmBox('파일 없음', `해당 경로에서 파일을 찾지 못했습니다.<br><span class="path">${esc(path)}</span><br>그래도 등록할까요?`, '그래도 등록'))) return false;
        d.path = path; d.name = $('#df_name', r).value.trim() || safeDecode(path.split(/[\\/]/).pop());
      } else {
        const f = $('#df_file', r).files[0]; if (!f) { err.textContent = '파일을 선택하세요.'; return false; }
        try { d.fileId = await FileStore.put(f); } catch (e) { err.textContent = '저장 실패: ' + e.message; return false; }
        d.size = f.size; d.name = $('#df_name', r).value.trim() || f.name;
      }
      const before = snap();
      p.docs.push(d); touch(p);
      if (!save()) { restore(before); if (d.fileId) FileStore.del(d.fileId).catch(() => {}); route(); return false; }
      route(); toast('문서가 등록되었습니다');
    } }]);
  $$('input[name=df_mode]', root).forEach(x => x.onchange = () => { const s = $('input[name=df_mode]:checked', root).value === 'stored'; $('#df_linkbox', root).hidden = s; $('#df_filebox', root).hidden = !s; });
}

/* ---------------- backup ---------------- */
const BackupDir = {
  handle: null, writing: false, timer: null, needPerm: false,
  ok() { return !!(window.showDirectoryPicker); },
  db() { return new Promise((res, rej) => { const r = indexedDB.open('haeri_mms_backupdir', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async loadHandle() { try { const db = await this.db(); this.handle = await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { this.handle = null; } return this.handle; },
  async saveHandle(h) { const db = await this.db(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(h, 'dir'); t.oncomplete = res; t.onerror = () => rej(t.error); }); this.handle = h; },
  async perm(ask) { if (!this.handle) return false; const o = { mode: 'readwrite' }; if (await this.handle.queryPermission(o) === 'granted') return true; if (!ask) return false; return (await this.handle.requestPermission(o)) === 'granted'; },
  async connect() {
    if (!this.ok()) return toast('이 브라우저는 폴더 자동 저장을 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요.', 'warn');
    let h; try { h = await window.showDirectoryPicker({ id: 'haeri-data', mode: 'readwrite', startIn: 'desktop' }); } catch (e) { return; }
    if (h.name !== 'data' && !(await confirmBox('폴더 확인', `선택한 폴더는 <b>${esc(h.name)}</b> 입니다. HAERI_MOLD_MANAGER 안의 <b>data</b> 폴더를 권장합니다. 이 폴더로 연결할까요?`, '연결'))) return;
    await this.saveHandle(h); this.needPerm = false;
    if (await this.write()) toast(`백업 폴더(${h.name})를 연결했습니다. 이제 변경할 때마다 자동으로 저장됩니다.`);
    route();
  },
  fileName() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `HAERI_금형관리_백업_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`; },
  async write() {
    if (!this.handle || !(await this.perm(false))) { if (this.handle) this.needPerm = true; return false; }
    const data = JSON.stringify({ app: 'HAERI_MOLD_MANAGER', exportedAt: nowISO(), ...DB, lastExportAt: undefined }, null, 2);
    try {
      const fh = await this.handle.getFileHandle(this.fileName(), { create: true });
      const w = await fh.createWritable(); await w.write(data); await w.close();
      DB.lastExportAt = nowISO();
      return true;
    } catch (e) { toast('자동 백업 실패: ' + e.message, 'err'); return false; }
  },
  schedule() { if (!this.handle) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.write(), 2000); },
};
BackupDir.loadHandle().then(async h => { if (h && !(await BackupDir.perm(false))) BackupDir.needPerm = true; if (h && DB) route(); });
// 브라우저를 다시 켜면 폴더 쓰기 권한을 한 번 다시 물어봄 (사용자 클릭이 있어야 요청 가능)
document.addEventListener('pointerdown', async () => { if (!BackupDir.needPerm || !BackupDir.handle) return; BackupDir.needPerm = false; if (await BackupDir.perm(true)) { await BackupDir.write(); route(); } }, true);

async function exportJSON() {
  if (BackupDir.handle && await BackupDir.perm(true)) { if (await BackupDir.write()) { toast(`data 폴더에 저장했습니다: ${BackupDir.fileName()}`); route(); } return; }
  const data = JSON.stringify({ app: 'HAERI_MOLD_MANAGER', exportedAt: nowISO(), ...DB, lastExportAt: undefined }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `HAERI_금형관리_백업_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  DB.lastExportAt = nowISO();
  toast('백업 파일을 내려받았습니다. [설정 및 백업]에서 data 폴더를 연결하면 다음부터 자동 저장됩니다.');
}
function importJSON(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let d;
    try { d = JSON.parse(rd.result); } catch (e) { toast('JSON 형식이 아닙니다: ' + e.message, 'err'); return; }
    if (!d || !Array.isArray(d.projects)) { toast('금형 관리 백업 파일이 아닙니다 (projects 없음).', 'err'); return; }
    let incoming;
    try { incoming = d.projects.map(sanitizeProject); } catch (e) { toast('가져오기 중단 — ' + e.message + '. 현재 데이터는 바뀌지 않았습니다.', 'err'); return; }
    const seen = new Set(), inDup = [];
    incoming.forEach(p => { if (seen.has(p.dwgNo)) inDup.push(p.dwgNo); seen.add(p.dwgNo); });
    if (inDup.length) { toast('가져오기 중단 — 백업 파일 안에 같은 도번이 중복됩니다: ' + [...new Set(inDup)].join(', '), 'err'); return; }
    const dup = incoming.filter(p => getP(p.dwgNo)).length;
    modal('백업 가져오기', `<div style="line-height:1.8">파일: <b>${esc(file.name)}</b><br>백업 시각: ${fmtDT(d.exportedAt || d.savedAt)}<br>백업 안 금형: <b>${incoming.length}건</b> (현재 데이터와 같은 도번 ${dup}건)<br>현재 등록 금형: <b>${DB.projects.length}건</b><br><br>
      · <b>추가만</b>: 현재 데이터 유지, 없는 도번만 추가 (같은 도번은 건너뜀)<br>· <b>전체 덮어쓰기</b>: 현재 데이터를 모두 지우고 백업 내용으로 교체</div>`, [
      { text: '취소' },
      { text: '추가만', fn: () => {
        const before = snap(); let n = 0;
        incoming.forEach(p => { if (!getP(p.dwgNo)) { DB.projects.push(p); n++; } });
        const ids = new Set(DB.schedules.map(x => x.id)); sanitizeSchedules(d.schedules).forEach(x => { if (!ids.has(x.id)) DB.schedules.push(x); });
        if (!save()) { restore(before); route(); return false; }
        route(); toast(`${n}건 추가, ${incoming.length - n}건 건너뜀`);
      } },
      { text: '전체 덮어쓰기', cls: 'danger', fn: async () => {
        if (!(await confirmBox('덮어쓰기 확인', `현재 금형 ${DB.projects.length}건을 지우고 백업 ${incoming.length}건으로 교체합니다. 되돌릴 수 없습니다. 계속할까요?`, '덮어쓰기', true))) return;
        const before = snap(), beforeSet = DB.settings;
        DB.projects = incoming; DB.schedules = sanitizeSchedules(d.schedules);
        if (d.settings && typeof d.settings === 'object') { const ns = emptyDB().settings; Object.keys(ns).forEach(k => { if (d.settings[k] != null) ns[k] = String(d.settings[k]); }); DB.settings = ns; }
        // 사용자가 직접 복구하는 경우이므로 손상 데이터 잠금을 풀고 저장
        if (!save(true)) { restore(before); DB.settings = beforeSet; route(); return false; }
        READONLY = ''; CORRUPT_RAW = null; renderSaveState();
        gcFiles(); applySettings(); route(); toast('백업으로 교체했습니다');
      } }]);
  };
  rd.readAsText(file, 'utf-8');
}
function applySettings() {
  const s = DB.settings;
  const nm = who() || s.user || '사용자'; $('#userName').textContent = nm; $('#userAvatar').textContent = nm.slice(0, 1);
  $('.brand-sub').textContent = (s.company || '') + ' 금형 통합관리 시스템';
  const img = $('#logoImg');
  if (s.logoPath) {
    img.onload = () => { img.hidden = false; $('#logoText').hidden = true; };
    img.onerror = () => { img.hidden = true; $('#logoText').hidden = false; };
    img.src = s.logoPath;
  } else { img.hidden = true; $('#logoText').hidden = false; }
}

/* ---------------- events ---------------- */
function curProject() { const tb = $('#tabBody'); return tb ? getP(tb.dataset.id) : null; }
function findDoc(btn) {
  const p = btn.dataset.pid ? getP(btn.dataset.pid) : curProject();
  return p ? { p, d: p.docs.find(x => x.id === btn.dataset.did) } : {};
}

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-costby]'); if (!b) return;
  UI.costBy = b.dataset.costby; const p = curProject(); if (p) refreshCostSummary(p);
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act],[data-open],[data-go],[data-mode],[data-page],[data-search],[data-day],[data-cal]');
  if (!t) return;
  if (t.dataset.day) return dayModal(t.dataset.day);
  if (t.dataset.cal) {
    const k = +t.dataset.cal, c = UI.cal;
    if (k === 0) { const n = new Date(); c.y = n.getFullYear(); c.m = n.getMonth(); }
    else { const n = new Date(c.y, c.m + k, 1); c.y = n.getFullYear(); c.m = n.getMonth(); }
    return refreshCal();
  }
  if (t.dataset.open) return go('#/project/' + encodeURIComponent(t.dataset.open) + '/overview');
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.mode) { UI.list.mode = t.dataset.mode; saveUI(); $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === UI.list.mode)); return refreshList(); }
  if (t.dataset.page) { UI.list.page = +t.dataset.page; return refreshList(); }
  if (t.dataset.search) { UI.list.q = t.dataset.search; UI.list.page = 1; return go('#/projects'); }
  const act = t.dataset.act, p = t.dataset.id ? getP(t.dataset.id) : curProject();
  switch (act) {
    case 'newProject': return projectForm(null);
    case 'closeProj': UI.cur = ''; saveUI(); return go('#/dashboard');
    case 'editProject': return projectForm(p);
    case 'delProject':
      if (await confirmBox('금형 삭제', `<b>${esc(dispName(p))}</b> 와 제작비 ${p.costs.length}행, 특이사항 ${p.logs.length}건, 문서 ${p.docs.length}건을 삭제합니다.<br>되돌릴 수 없습니다. 먼저 백업을 받아 두는 것을 권장합니다.`, '삭제', true)) {
        const before = snap();
        DB.projects = DB.projects.filter(x => x !== p);
        // 달력 일정은 지우지 않고 금형 연결만 해제 (표시 이름은 남김)
        DB.schedules.forEach(x => { if (x.dwgNo === p.dwgNo) { if (p.model && !x.title.startsWith(p.model)) x.title = p.model + ' ' + x.title; x.dwgNo = ''; } });
        if (!save()) { restore(before); return route(); }
        if (UI.cur === p.dwgNo) { UI.cur = ''; saveUI(); }
        gcFiles(); toast('삭제했습니다'); go('#/dashboard');
      }
      return;
    case 'openViewer': return openPath(p && p.viewerPath, '3D 뷰어');
    case 'saveViewer': { const b = snap(); p.viewerPath = $('#viewerPath').value.trim(); touch(p); if (!save()) { restore(b); return route(); } return toast('뷰어 경로를 저장했습니다'); }
    case 'checkViewer': {
      const path = $('#viewerPath').value.trim(), el = $('#viewerCheck');
      const st = path ? await checkPath(path) : 'missing';
      el.innerHTML = st === 'ok' ? '<span style="color:var(--ok)">✔ 클라우드에 올라간 파일입니다.</span>' : st === 'missing' ? '<span style="color:var(--bad)">✖ 클라우드에 없는 파일입니다. 경로를 확인하고 [설정 및 백업 → 연결 파일 올리기]로 올려 주세요.</span>' : '<span style="color:var(--warn)">외부 주소라 확인할 수 없습니다.</span>';
      return;
    }
    case 'addCost': { const b = snap(); p.costs.push({ id: uid('c'), item: '', vendor: '', quote: null, confirmed: null, paid: null, vat: '미확인', status: '견적 요청', note: '', quoteFileId: null }); touch(p); if (!save()) { restore(b); return route(); } } route(); { const rows = $$('#costBody tr'); const last = rows[rows.length - 1]; if (last) last.querySelector('input').focus(); } return;
    case 'mvCost': {
      const i = p.costs.findIndex(x => x.id === t.dataset.cid), j = i + Number(t.dataset.dir);
      if (i < 0 || j < 0 || j >= p.costs.length) return;
      const b = snap(); [p.costs[i], p.costs[j]] = [p.costs[j], p.costs[i]]; touch(p);
      if (!save()) { restore(b); return route(); }
      route(); { const btn = document.querySelector(`#costBody tr[data-cid="${CSS.escape(t.dataset.cid)}"] [data-act="mvCost"][data-dir="${t.dataset.dir}"]`); if (btn) btn.focus(); }
      return;
    }
    case 'delCost': {
      const c = p.costs.find(x => x.id === t.dataset.cid);
      if (await confirmBox('행 삭제', `<b>${esc(c.item || '(항목 없음)')}</b> / ${esc(c.vendor || '업체 없음')} 행을 삭제할까요?`, '삭제', true)) { const b = snap(); p.costs = p.costs.filter(x => x !== c); touch(p); if (!save()) restore(b); else if (c.quoteFileId) gcFiles(); route(); }
      return;
    }
    case 'addLog': return logForm(p, null);
    case 'editLog': return logForm(p, p.logs.find(x => x.id === t.dataset.lid));
    case 'delLog': {
      const l = p.logs.find(x => x.id === t.dataset.lid);
      if (await confirmBox('기록 삭제', `<b>${esc(l.title)}</b> 기록을 삭제할까요?`, '삭제', true)) { const b = snap(); p.logs = p.logs.filter(x => x !== l); touch(p); if (!save()) restore(b); route(); }
      return;
    }
    case 'addDoc': return docForm(p);
    case 'upQuote': return pickQuote(p, t.dataset.cid);
    case 'viewQuote': return viewQuote(p, t.dataset.cid);
    case 'delQuote': {
      const vi = quoteRow(p, t.dataset.cid);
      if (!vi || !vi.quoteFileId || !(await confirmBox('견적서 지우기', `<b>${esc(quoteName(vi))}</b> 견적서를 지울까요? 클라우드에 올린 파일도 함께 지워집니다.`, '지우기', true))) return;
      const b = snap(); vi.quoteFileId = null; touch(p); if (!save()) { restore(b); return route(); } gcFiles(); route(); return toast('견적서를 지웠습니다');
    }
    case 'openDoc': case 'dlDoc': {
      const { d } = findDoc(t); if (!d) return;
      if (d.mode === 'stored') return openStored(d.fileId, act === 'dlDoc');
      if (act === 'dlDoc') { const st = await checkPath(d.path); if (st === 'missing') return toast('파일을 찾을 수 없습니다: ' + d.path, 'err'); return downloadPath(d.path, d.name); }
      return openPath(d.path, d.name);
    }
    case 'delDoc': {
      const { p: pp, d } = findDoc(t);
      const msg = d.mode === 'stored' ? `<b>${esc(d.name)}</b> 를 삭제합니다. 클라우드에 올린 파일도 함께 지워집니다.` : `<b>${esc(d.name)}</b> 의 연결을 삭제합니다. 실제 파일은 지워지지 않습니다.`;
      if (await confirmBox('문서 삭제', msg, '삭제', true)) { const b = snap(); pp.docs = pp.docs.filter(x => x !== d); touch(pp); if (!save()) { restore(b); return route(); } gcFiles(); route(); }
      return;
    }
    case 'export': return exportJSON();
    case 'invPrd': return showInvPrd();
    case 'repPrd': return showRepPrd();
    case 'linkBackup': return BackupDir.connect();
    case 'import': $('#importInput').value = ''; return $('#importInput').click();
    case 'saveSettings': {
      const nm = $('#setUser').value.trim();
      if (nm && nm !== who()) { const { data, error } = await SB.auth.updateUser({ data: { name: nm } }); if (error) return toast('이름 저장 실패: ' + error.message, 'err'); Cloud.user = data.user; }
      const comp = $('#setCompany').value.trim(), logo = $('#setLogo').value.trim();
      if (comp !== DB.settings.company || logo !== DB.settings.logoPath) { DB.settings.company = comp; DB.settings.logoPath = logo; save(); }
      applySettings(); return toast('설정을 저장했습니다');
    }
    case 'uploadLinked': return uploadLinked();
    case 'logout':
      if ((Cloud.dirty || Cloud.pushing) && !(await confirmBox('로그아웃', '아직 저장 중인 내용이 있습니다. 그래도 로그아웃할까요?', '로그아웃', true))) return;
      await SB.auth.signOut(); location.hash = '#/dashboard'; return location.reload();
    case 'dlCorrupt': { if (!CORRUPT_RAW) return; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CORRUPT_RAW], { type: 'text/plain' })); a.download = 'HAERI_손상데이터_원문.txt'; document.body.appendChild(a); a.click(); a.remove(); return; }
    case 'wipe':
      if (await confirmBox('전체 데이터 삭제', `금형 ${DB.projects.length}건의 모든 데이터를 삭제합니다. 확인을 누르면 먼저 백업 파일을 내려받은 뒤 삭제합니다.`, '백업 후 삭제', true)) {
        exportJSON(); const b = snap(); DB.projects = [];
        if (!save()) { restore(b); return route(); }
        await gcFiles();
        route(); toast('모든 데이터를 삭제했습니다');
      }
      return;
  }
});

// 제작비 인라인 편집: 값 변경 시 저장 + 합계만 갱신 (포커스 유지)
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'importInput' && el.files[0]) return importJSON(el.files[0]);
  if (el.id === 'fYear') { UI.list.year = el.value; UI.list.page = 1; return refreshList(); }
  if (el.id === 'fStatus') { UI.list.status = el.value; UI.list.page = 1; return refreshList(); }
  if (el.id === 'fSort') { UI.list.sort = el.value; saveUI(); return refreshList(); }
  const vr = el.closest('#vendBody tr');
  if (vr && el.dataset.vf) {
    const p = curProject(); if (!p) return;
    const vi = vInfo(p, vr.dataset.vn);
    if (el.dataset.vf === 'cost') { const n = parseMoney(el.value); vi.cost = n; el.value = isNum(n) ? n.toLocaleString('ko-KR') : ''; }
    else vi.memo = el.value;
    touch(p); if (!save()) return;
    return;
  }
  if (el.dataset.pf && el.closest('#costTotals')) {
    const p = curProject(); if (!p) return;
    const n = parseMoney(el.value); p[el.dataset.pf] = n; el.value = isNum(n) ? n.toLocaleString('ko-KR') : '';
    touch(p); save(); return;
  }
  const tr = el.closest('#costBody tr');
  if (tr && el.dataset.f) {
    const p = curProject(); const c = p && p.costs.find(x => x.id === tr.dataset.cid); if (!c) return;
    if (el.hasAttribute('data-money')) { const n = parseMoney(el.value); c[el.dataset.f] = n; el.value = isNum(n) ? n.toLocaleString('ko-KR') : ''; }
    else c[el.dataset.f] = el.value;
    touch(p);
    if (!save()) return; // 실패 표시는 save()가 함. 입력값은 화면에 남겨 다시 시도 가능
    refreshCostSummary(p);
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'fQ') { UI.list.q = e.target.value; UI.list.page = 1; clearTimeout(window.__qt); window.__qt = setTimeout(refreshList, 120); }
  if (e.target.matches('#costBody input[data-money], #vendBody input[data-money], #costTotals input[data-money]')) e.target.value = e.target.value.replace(/[^\d,\-]/g, '');
  if (e.target.matches('#vendBody textarea')) { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }
});
window.addEventListener('hashchange', route);

/* ---------------- 로그인 · 시작 ---------------- */
function authUI(mode, msg) {
  let root = $('#authRoot');
  if (!root) { root = document.createElement('div'); root.id = 'authRoot'; document.body.appendChild(root); }
  const T = { login: 'HAERI 금형관리 로그인', setpw: '비밀번호 정하기', error: '연결 오류' };
  root.innerHTML = `<div class="mback" style="z-index:500;background:rgba(10,14,22,.97)"><div class="modal sm"><div class="mh">${T[mode]}</div><div class="mb"><div class="form">
    ${msg ? `<div class="full" style="line-height:1.6">${esc(msg)}</div>` : ''}
    ${mode === 'login' ? `<label class="full">이메일<input type="email" id="au_email" autocomplete="username"></label><label class="full">비밀번호<input type="password" id="au_pw" autocomplete="current-password"></label><span class="hint full">초대받은 팀원만 로그인할 수 있습니다. 계정이 없으면 관리자에게 초대를 요청하세요.</span>` : ''}
    ${mode === 'setpw' ? `<label class="full">새 비밀번호 (8자 이상)<input type="password" id="au_pw" autocomplete="new-password"></label><label class="full">새 비밀번호 확인<input type="password" id="au_pw2" autocomplete="new-password"></label>` : ''}
    <span class="hint err full" id="au_err"></span></div></div>
    <div class="mf">${mode === 'login' ? '<button class="btn" id="au_forgot">비밀번호 재설정 메일</button><button class="btn pri" id="au_go">로그인</button>' : mode === 'setpw' ? '<button class="btn pri" id="au_go">저장하고 시작</button>' : '<button class="btn" id="au_out">로그아웃</button><button class="btn pri" id="au_retry">다시 시도</button>'}</div></div></div>`;
  const err = $('#au_err', root), go = $('#au_go', root);
  const busy = (b, t) => { $$('.mf .btn', root).forEach(x => x.disabled = b); if (t != null) err.textContent = t; };
  if (mode === 'login') {
    const submit = async () => {
      const email = $('#au_email', root).value.trim(), password = $('#au_pw', root).value;
      if (!email || !password) return busy(false, '이메일과 비밀번호를 입력하세요.');
      busy(true, '로그인 중…');
      const { data, error } = await SB.auth.signInWithPassword({ email, password });
      if (error) return busy(false, /invalid login/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다.' : '로그인 실패: ' + error.message);
      Cloud.user = data.user; start();
    };
    go.onclick = submit;
    $$('input', root).forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    $('#au_forgot', root).onclick = async () => {
      const email = $('#au_email', root).value.trim(); if (!email) return busy(false, '먼저 이메일을 입력하세요.');
      busy(true, '메일 보내는 중…');
      const { error } = await SB.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      busy(false, error ? '보내기 실패: ' + error.message : '재설정 메일을 보냈습니다. 메일의 링크를 누르면 새 비밀번호를 정할 수 있습니다.');
    };
    $('#au_email', root).focus();
  } else if (mode === 'setpw') {
    const submit = async () => {
      const a = $('#au_pw', root).value, b = $('#au_pw2', root).value;
      if (a.length < 8) return busy(false, '비밀번호는 8자 이상이어야 합니다.');
      if (a !== b) return busy(false, '두 비밀번호가 다릅니다.');
      busy(true, '저장 중…');
      const { data, error } = await SB.auth.updateUser({ password: a });
      if (error) return busy(false, '저장 실패: ' + error.message);
      Cloud.user = data.user; toast('비밀번호를 정했습니다. 다음부터 이메일과 이 비밀번호로 로그인하세요.'); start();
    };
    go.onclick = submit;
    $$('input', root).forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    $('#au_pw', root).focus();
  } else {
    $('#au_retry', root).onclick = () => start();
    $('#au_out', root).onclick = async () => { await SB.auth.signOut(); location.reload(); };
  }
}
const closeAuth = () => { const r = $('#authRoot'); if (r) r.remove(); };
let started = false;
async function start() {
  try { await load(); } catch (e) { return authUI('error', '데이터를 불러오지 못했습니다: ' + ((e && e.message) || e) + '\n인터넷 연결을 확인하고 다시 시도하세요. (무료 플랜은 1주일 동안 아무도 안 쓰면 일시정지되니, 관리자가 Supabase에서 Restore를 눌러야 할 수 있습니다)'); }
  closeAuth();
  if (!started) {
    started = true;
    addFireProjects();
    fixFireViewerPaths();
    fixHarryPaths();
    fix0702MidPlate();
    subscribe();
  }
  applySettings();
  renderSaveState();
  if (READONLY) toast(READONLY, 'err');
  route();
}
async function boot() {
  const hp = new URLSearchParams(INIT_HASH.replace(/^#/, ''));
  const linkType = hp.get('type');
  const linkErr = hp.get('error_description') || hp.get('error');
  let session = null;
  try { session = (await SB.auth.getSession()).data.session; } catch (e) {}
  if (hp.get('access_token') || linkErr) history.replaceState(null, '', location.pathname + location.search + '#/dashboard');
  SB.auth.onAuthStateChange((ev, s) => { if (s) Cloud.user = s.user; if (ev === 'SIGNED_OUT' && started) location.reload(); });
  if (!session) return authUI('login', linkErr ? '링크가 만료되었거나 이미 사용되었습니다. 관리자에게 초대(또는 재설정 메일)를 다시 요청하세요.' : '');
  Cloud.user = session.user;
  if (linkType === 'invite' || linkType === 'recovery' || linkType === 'signup') return authUI('setpw', linkType === 'recovery' ? '새 비밀번호를 정해 주세요.' : '초대를 수락했습니다. 앞으로 로그인에 쓸 비밀번호를 정해 주세요.');
  start();
}
if (!window.supabase || !CFG.url) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">클라우드 연결 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.</p>'; return; }
boot();

/* ---------------- 제작비 행 끌어서 순서 바꾸기 ---------------- */
function commitCostOrder(tb) {
  const p = getP($('#tabBody') && $('#tabBody').dataset.id); if (!p) return;
  const ids = [...tb.querySelectorAll('tr[data-cid]')].map(r => r.dataset.cid);
  if (ids.join() === p.costs.map(c => c.id).join()) return;
  const b = snap(); const map = new Map(p.costs.map(c => [c.id, c]));
  p.costs = ids.map(i => map.get(i)).filter(Boolean).concat(p.costs.filter(c => !ids.includes(c.id))); touch(p);
  if (!save()) { restore(b); route(); return; }
  toast('순서를 바꿨습니다');
}
document.addEventListener('pointerdown', e => {
  const h = e.target.closest && e.target.closest('[data-drag]'); if (!h || e.button > 0) return;
  const row = h.closest('tr'), tb = row && row.parentElement; if (!tb) return;
  e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch (er) {}
  row.classList.add('dragging'); document.body.classList.add('rowdrag');
  const move = ev => {
    const y = ev.clientY;
    const rows = [...tb.querySelectorAll('tr[data-cid]')].filter(r => r !== row);
    const after = rows.find(r => { const bb = r.getBoundingClientRect(); return y < bb.top + bb.height / 2; });
    if (after) { if (row.nextElementSibling !== after) tb.insertBefore(row, after); } else if (tb.lastElementChild !== row) tb.appendChild(row);
    if (y < 60) window.scrollBy(0, -12); else if (y > innerHeight - 60) window.scrollBy(0, 12);
  };
  const up = () => {
    h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
    row.classList.remove('dragging'); document.body.classList.remove('rowdrag');
    commitCostOrder(tb);
  };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
});
document.addEventListener('keydown', e => {
  const h = e.target.closest && e.target.closest('[data-drag]'); if (!h || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  e.preventDefault(); const row = h.closest('tr'), tb = row.parentElement;
  if (e.key === 'ArrowUp' && row.previousElementSibling) tb.insertBefore(row, row.previousElementSibling);
  else if (e.key === 'ArrowDown' && row.nextElementSibling) tb.insertBefore(row.nextElementSibling, row);
  else return;
  const id = row.dataset.cid; commitCostOrder(tb);
  const nh = document.querySelector(`[data-drag="${CSS.escape(id)}"]`); if (nh) nh.focus();
});

/* ---------------- 화면 테마 · 글꼴 (이 컴퓨터에 저장) ---------------- */
const THEMES = [['navy', '남색', '#0d1420', '#2fc6c0', '#e3e9f3'], ['light', '밝은 회색', '#e8ecf1', '#0a7a75', '#1b2431'], ['charcoal', '차콜', '#16171a', '#f0a24a', '#e9e9eb'], ['black', '블랙', '#0b0b0d', '#c4ec52', '#ededf0']];
const FONTS = [['pretendard', '깔끔', '"Pretendard Variable",sans-serif', null],
  ['round', '둥근', '"NanumSquareRound",sans-serif', 'https://hangeul.pstatic.net/hangeul_static/css/nanum-square-round.css'],
  ['plex', '반듯', '"IBM Plex Sans KR",sans-serif', 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap']];
const curTheme = () => document.documentElement.dataset.theme || 'navy';
try { { const o = localStorage.getItem('haeri_theme'); if (o === 'paper' || o === 'sage') localStorage.setItem('haeri_theme', 'charcoal'); } } catch (e) {}
const curFont = () => document.documentElement.dataset.font || 'pretendard';
function fontLink(doc, key) {
  const f = FONTS.find(x => x[0] === key); if (!f || !f[3]) return;
  if (doc.querySelector(`link[data-hfont="${key}"]`)) return;
  const l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = f[3]; l.dataset.hfont = key; doc.head.appendChild(l);
}
// 안쪽 화면(iframe)에 같은 색·글꼴 입히기
function themeFrame(fr) {
  let doc; try { doc = fr.contentDocument; } catch (e) { return; } if (!doc || !doc.head) return;
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  const t = curTheme(), light = t === 'light', tint = t !== 'navy', font = v('--font');
  FONTS.forEach(f => { if (f[0] === curFont()) fontLink(doc, f[0]); });
  if (fr.id === 'repFrame') doc.documentElement.dataset.theme = light ? 'light' : 'dark';
  let st = doc.getElementById('haeriTheme'); if (!st) { st = doc.createElement('style'); st.id = 'haeriTheme'; doc.head.appendChild(st); }
  const vars = fr.id === 'invFrame'
    ? (tint ? `--bg:${v('--bg')};--panel:${v('--panel')};--panel2:${v('--panel2')};--line:${v('--line')};--line2:${v('--line2')};--ink:${v('--tx')};--mut:${v('--tx2')};--dim:${v('--tx3')};--ac:${v('--ac')};--acbg:${v('--acbg')};--ok:${v('--ok')};--warn:${v('--warn')};--red:${v('--bad')};--blue:${v('--ac2')};color-scheme:${light ? 'light' : 'dark'};` : '')
    : (tint ? `--bg:${v('--bg')};--surface:${v('--panel')};--ink:${v('--tx')};--muted:${v('--tx2')};--line:${v('--line')};--accent:${v('--ac')};--accent-soft:${v('--acbg')};` : '');
  st.textContent = `:root,:root[data-theme]{${vars}--font-body:${font};}body,button,input,select,textarea{font-family:${font}!important}`;
}
function applyLook(theme, font) {
  const d = document.documentElement;
  if (theme) { if (theme === 'navy') delete d.dataset.theme; else d.dataset.theme = theme; try { localStorage.setItem('haeri_theme', theme); } catch (e) {} }
  if (font) { fontLink(document, font); d.dataset.font = font; try { localStorage.setItem('haeri_font', font); } catch (e) {} }
  document.querySelectorAll('#invFrame,#repFrame').forEach(themeFrame);
  const pop = document.getElementById('thPop'); if (pop) pop.outerHTML = thPopHTML();
}
function thPopHTML() {
  return `<div class="thpop" id="thPop" role="dialog" aria-label="화면 설정">
    <h4>색</h4><div class="thopts c4">${THEMES.map(([k, n, bg, ac, tx]) => `<button type="button" class="thopt${curTheme() === k ? ' on' : ''}" data-theme-pick="${k}" aria-pressed="${curTheme() === k}"><span class="sw" style="background:${bg}"><b style="background:${tx}"></b><i style="background:${ac}"></i></span><span>${n}</span></button>`).join('')}</div>
    <h4>글꼴</h4><div class="thopts">${FONTS.map(([k, n, ff]) => `<button type="button" class="thopt fnopt${curFont() === k ? ' on' : ''}" data-font-pick="${k}" aria-pressed="${curFont() === k}"><span class="fs" style="font-family:${ff}">가나 12</span><span style="font-family:${ff}">${n}</span></button>`).join('')}</div>
    <div class="thhint">고른 색·글꼴은 이 컴퓨터에 저장돼 다음에도 그대로 열립니다.</div></div>`;
}
fontLink(document, curFont());
document.addEventListener('click', e => {
  const tb = e.target.closest && e.target.closest('#thBtn');
  const pop = document.getElementById('thPop');
  if (tb) { if (pop) { pop.remove(); tb.setAttribute('aria-expanded', 'false'); } else { FONTS.forEach(f => fontLink(document, f[0])); tb.parentElement.insertAdjacentHTML('beforeend', thPopHTML()); tb.setAttribute('aria-expanded', 'true'); } return; }
  const tp = e.target.closest && e.target.closest('[data-theme-pick]'); if (tp) return applyLook(tp.dataset.themePick, null);
  const fp = e.target.closest && e.target.closest('[data-font-pick]'); if (fp) return applyLook(null, fp.dataset.fontPick);
  if (pop && !e.target.closest('#thPop')) { pop.remove(); const b = document.getElementById('thBtn'); if (b) b.setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const p = document.getElementById('thPop'); if (p) p.remove(); } });
document.addEventListener('load', e => { const t = e.target; if (t && (t.id === 'invFrame' || t.id === 'repFrame')) themeFrame(t); }, true);
window.__HAERI = { get DB() { return DB; }, Cloud, SB, merge3, normPath, calcCosts, calcAll, suggestDwg, FileStore, save, getP, projectForm, logForm, confirmBox, sanitizeProject, resolvePath, safeDecode }; // 테스트·디버그용
})();
