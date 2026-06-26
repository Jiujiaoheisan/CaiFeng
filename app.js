/* =========================================================
   裁档 · 衣样图录  —  本地离线数据管理
   数据结构（单条记录 record）：
   {
     id: string,
     image: string (base64 dataURL),
     owner: string,           // 归属人（固定字段）
     fabric: string,          // 布料（固定字段）
     collectDate: string,     // 收录日期 (固定字段)
     makeDate: string,        // 制作日期 (固定字段)
     settleDate: string,      // 结算日期 (固定字段，留空=未结算)
     settleAmount: string,    // 结算金额 (固定字段)
     remark: string,          // 备注 (固定字段)
     archived: boolean,       // 是否已归档（手动点击触发，按钮文案为"结算"）
     calibration: { realLength: number, unit: 'cm', p1: {x,y}, p2: {x,y}, naturalWidth, naturalHeight } | null,
                               // 量尺校准数据：记录两个标定点在图片原始像素坐标中的位置，
                               // 以及用户输入的真实距离，用于换算厘米/市寸刻度
     customFields: [{id, label, value}],  // 自定义字段
     createdAt: number
   }
   ========================================================= */

const STORAGE_KEY = 'garmentArchive.records.v1';

let records = [];
let activeId = null;
let pendingUploadDataUrl = null;

/* ---------- persistence ---------- */
function loadRecords(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    records = raw ? JSON.parse(raw) : [];
  }catch(e){
    console.error('读取本地数据失败', e);
    records = [];
  }
}
function saveRecords(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }catch(e){
    console.error('保存失败', e);
    showToast('保存失败，存储空间可能已满');
  }
}

function uid(){
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

/* ---------- helpers ---------- */
function fmtDate(d){
  if(!d) return '';
  return d;
}
function isPending(r){
  return !r.settleDate;
}
function escapeHtml(s){
  if(s==null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- rendering: left list ---------- */
function renderList(){
  const list = document.getElementById('imageList');
  const q = document.getElementById('searchInput').value.trim().toLowerCase();

  const filtered = records.filter(r=>{
    if(!q) return true;
    const hay = [r.owner, r.fabric, r.remark, ...(r.customFields||[]).map(f=>f.value)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  document.getElementById('paneCount').textContent = records.length + ' 件';

  if(filtered.length === 0){
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <p>${records.length===0 ? '还没有任何衣样' : '没有匹配的结果'}</p>
        <p class="hint">${records.length===0 ? '点击右上角"新增"添加第一张图片' : '换个关键词试试'}</p>
      </div>`;
    return;
  }

  const pending = filtered.filter(r=>!r.archived && isPending(r))
    .sort((a,b)=>b.createdAt-a.createdAt);
  const settledNotArchived = filtered.filter(r=>!r.archived && !isPending(r))
    .sort((a,b)=>b.createdAt-a.createdAt);
  const archived = filtered.filter(r=>r.archived)
    .sort((a,b)=>b.createdAt-a.createdAt);

  let html = '';

  if(pending.length){
    html += `<div class="section-label pending">待结算 · ${pending.length}</div>`;
    html += pending.map(r=>cardHtml(r)).join('');
  }
  if(settledNotArchived.length){
    html += `<div class="section-label">已填结算信息 · 待结算</div>`;
    html += settledNotArchived.map(r=>cardHtml(r)).join('');
  }
  if(archived.length){
    html += `<div class="section-label">已结算 · ${archived.length}</div>`;
    html += archived.map(r=>cardHtml(r)).join('');
  }

  list.innerHTML = html;

  list.querySelectorAll('.card').forEach(el=>{
    el.addEventListener('click', ()=>{
      selectRecord(el.dataset.id);
      if(window.innerWidth <= 680){
        showMobilePane('data');
      }
    });
  });
}

function cardHtml(r){
  const active = r.id === activeId ? ' active' : '';
  const archivedClass = r.archived ? ' archived' : '';
  let badge = '';
  if(!r.archived && isPending(r)){
    badge = `<span class="card-pin">待结算</span>`;
  } else if(r.archived){
    badge = `<span class="card-archived-tag">已结算</span>`;
  }
  const thumb = r.image
    ? `<img src="${r.image}" alt="">`
    : `<svg class="placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
  const metaParts = [];
  if(r.fabric) metaParts.push(r.fabric);
  if(r.collectDate) metaParts.push('收录 ' + r.collectDate);
  return `
    <div class="card${active}${archivedClass}" data-id="${r.id}">
      ${badge}
      <div class="card-thumb">${thumb}</div>
      <div class="card-body">
        <div class="card-name">${escapeHtml(r.owner) || '未填写归属人'}</div>
        <div class="card-meta">${escapeHtml(metaParts.join(' · ')) || '暂无备注'}</div>
      </div>
    </div>`;
}

/* ---------- rendering: right data pane ---------- */
function renderData(){
  const scroll = document.getElementById('dataScroll');
  const r = records.find(x=>x.id===activeId);

  if(!r){
    scroll.innerHTML = `
      <div class="data-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 17V9m6 8V5M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
        <h3>选择一张图片</h3>
        <p>点击左侧图片库中的任意一件衣样，在这里查看与编辑它的详细档案数据。</p>
      </div>`;
    return;
  }

  const pending = isPending(r);
  const statusChip = r.archived
    ? `<span class="status-chip done"><span class="dot"></span>已结算</span>`
    : pending
      ? `<span class="status-chip pending"><span class="dot"></span>待结算</span>`
      : `<span class="status-chip done"><span class="dot"></span>已填结算信息 · 待确认</span>`;

  const photo = r.image
    ? `<img src="${r.image}" alt="">`
    : `<svg class="placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;

  const customFieldsHtml = (r.customFields||[]).map(f=>`
    <div class="field" data-cf-id="${f.id}">
      <label>${escapeHtml(f.label)} <span class="remove-field" data-remove-cf="${f.id}">&times;</span></label>
      <input type="text" data-cf-value="${f.id}" value="${escapeHtml(f.value)}" placeholder="填写内容">
    </div>
  `).join('');

  scroll.innerHTML = `
    <button class="back-btn" id="backToList">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m7-7l-7 7 7 7"/></svg>
      返回图片库
    </button>

    <div class="record-photo-row">
      <div class="record-photo" id="recordPhotoBtn">
        ${photo}
        ${r.image ? `<span class="zoom-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M9 8v6M6 11h6"/></svg></span>` : ''}
      </div>
      <div class="record-title-block">
        ${statusChip}
        <h2 id="ownerTitle">${escapeHtml(r.owner) || '未命名'}</h2>
        <div class="subline">${escapeHtml(r.fabric) || '尚未填写布料'}</div>
      </div>
    </div>

    <div class="record-actions" style="margin-bottom:22px;">
      <button class="btn btn-archive ${r.archived?'is-archived':''}" id="archiveBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 13h4"/></svg>
        ${r.archived ? '取消结算' : '结算'}
      </button>
      <button class="btn" id="replaceImgBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
        更换图片
      </button>
      <button class="btn btn-danger" id="deleteBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
        删除
      </button>
      <input type="file" id="replaceImgInput" accept="image/*" style="display:none;">
    </div>

    <div class="field-grid">
      <div class="field">
        <label>归属人</label>
        <input type="text" data-field="owner" value="${escapeHtml(r.owner)}" placeholder="填写归属人姓名">
      </div>
      <div class="field">
        <label>布料</label>
        <input type="text" data-field="fabric" value="${escapeHtml(r.fabric)}" placeholder="例如：真丝双绉">
      </div>
    </div>

    <div class="field-grid">
      <div class="field date">
        <label>收录日期</label>
        <input type="date" data-field="collectDate" value="${r.collectDate||''}">
      </div>
      <div class="field date">
        <label>制作日期</label>
        <input type="date" data-field="makeDate" value="${r.makeDate||''}">
      </div>
    </div>

    <div class="field-grid">
      <div class="field date">
        <label>结算日期 <span style="font-weight:400; text-transform:none; letter-spacing:0;">（留空表示未结算）</span></label>
        <input type="date" data-field="settleDate" value="${r.settleDate||''}">
      </div>
      <div class="field">
        <label>结算金额</label>
        <input type="text" inputmode="decimal" data-field="settleAmount" value="${escapeHtml(r.settleAmount)}" placeholder="例如：280">
      </div>
    </div>

    <div class="field-grid full">
      <div class="field">
        <label>备注</label>
        <textarea data-field="remark" rows="3" placeholder="填写其他需要记录的信息">${escapeHtml(r.remark)}</textarea>
      </div>
    </div>

    <div class="divider"></div>

    <div class="fields-section">
      <div class="fields-section-head">
        <span class="label">自定义字段</span>
        <button class="add-field-btn" id="addFieldBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          添加字段
        </button>
      </div>
      <div class="field-grid" id="customFieldsGrid">
        ${customFieldsHtml || ''}
      </div>
      ${(r.customFields||[]).length===0 ? `<p style="font-size:12.5px; color:var(--ink-soft); margin:4px 4px 0;">还没有自定义字段，例如"工时"、"客户电话"、"特殊要求"等，点击右上角添加。</p>` : ''}
    </div>
  `;

  bindDataPaneEvents(r);
}

function bindDataPaneEvents(r){
  const scroll = document.getElementById('dataScroll');

  scroll.querySelectorAll('input[data-field], textarea[data-field]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const field = inp.dataset.field;
      r[field] = inp.value;
      saveRecords();
      if(field==='owner'){
        document.getElementById('ownerTitle').textContent = inp.value || '未命名';
      }
      if(field==='fabric' || field==='owner' || field==='settleDate'){
        renderList(); // re-sort / re-label without losing focus elsewhere
      }
    });
  });

  scroll.querySelectorAll('input[data-cf-value]').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      const cfId = inp.dataset.cfValue;
      const cf = r.customFields.find(f=>f.id===cfId);
      if(cf){ cf.value = inp.value; saveRecords(); }
    });
  });

  scroll.querySelectorAll('[data-remove-cf]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cfId = btn.dataset.removeCf;
      r.customFields = (r.customFields||[]).filter(f=>f.id!==cfId);
      saveRecords();
      renderData();
    });
  });

  const addFieldBtn = document.getElementById('addFieldBtn');
  if(addFieldBtn){
    addFieldBtn.addEventListener('click', ()=>{
      const label = prompt('新字段名称，例如：工时 / 客户电话 / 特殊要求');
      if(!label || !label.trim()) return;
      r.customFields = r.customFields || [];
      r.customFields.push({ id: uid(), label: label.trim(), value: '' });
      saveRecords();
      renderData();
    });
  }

  const archiveBtn = document.getElementById('archiveBtn');
  archiveBtn.addEventListener('click', ()=>{
    if(!r.archived){
      // 即将"结算"：检查必填项
      const missing = [];
      if(!r.settleDate) missing.push('结算日期');
      if(!r.settleAmount || !String(r.settleAmount).trim()) missing.push('结算金额');
      if(missing.length){
        showToast(`请先填写${missing.join('、')}才能结算`);
        return;
      }
    }
    r.archived = !r.archived;
    saveRecords();
    renderList();
    renderData();
    showToast(r.archived ? '已结算' : '已取消结算');
  });

  document.getElementById('deleteBtn').addEventListener('click', ()=>{
    if(!confirm('确定要删除这条衣样档案吗？此操作无法撤销。')) return;
    records = records.filter(x=>x.id!==r.id);
    activeId = null;
    saveRecords();
    renderList();
    renderData();
    showToast('已删除');
  });

  const replaceBtn = document.getElementById('replaceImgBtn');
  const replaceInput = document.getElementById('replaceImgInput');
  replaceBtn.addEventListener('click', ()=> replaceInput.click());
  replaceInput.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      r.image = ev.target.result;
      saveRecords();
      renderList();
      renderData();
      showToast('图片已更新');
    };
    reader.readAsDataURL(file);
  });

  const backBtn = document.getElementById('backToList');
  if(backBtn){
    backBtn.addEventListener('click', ()=> showMobilePane('images'));
  }

  const photoBtn = document.getElementById('recordPhotoBtn');
  if(photoBtn && r.image){
    photoBtn.addEventListener('click', ()=> openImageViewer(r.id));
  }
}

function selectRecord(id){
  activeId = id;
  renderList();
  renderData();
}

/* ---------- mobile pane switching ---------- */
function showMobilePane(which){
  const imgPane = document.getElementById('imagePane');
  const dataPane = document.getElementById('dataPane');
  const tabImages = document.getElementById('tabImages');
  const tabData = document.getElementById('tabData');
  if(which === 'data'){
    imgPane.classList.add('hide-mobile');
    dataPane.classList.add('show-mobile');
    tabImages.classList.remove('active');
    tabData.classList.add('active');
  } else {
    imgPane.classList.remove('hide-mobile');
    dataPane.classList.remove('show-mobile');
    tabImages.classList.add('active');
    tabData.classList.remove('active');
  }
}

/* ---------- add new record modal ---------- */
function openAddModal(){
  pendingUploadDataUrl = null;
  document.getElementById('uploadPreview').style.display = 'none';
  document.getElementById('uploadPreview').src = '';
  document.getElementById('uploadHint').textContent = '点击或拖拽图片到此处';
  document.getElementById('newOwner').value = '';
  document.getElementById('newFabric').value = '';
  document.getElementById('newCollectDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('fileInput').value = '';
  document.getElementById('addModal').classList.add('show');
}
function closeAddModal(){
  document.getElementById('addModal').classList.remove('show');
}

function handleFileSelect(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    pendingUploadDataUrl = e.target.result;
    const preview = document.getElementById('uploadPreview');
    preview.src = pendingUploadDataUrl;
    preview.style.display = 'block';
    document.getElementById('uploadHint').textContent = '已选择图片，点击可重新选择';
  };
  reader.readAsDataURL(file);
}

function confirmAddRecord(){
  const owner = document.getElementById('newOwner').value.trim();
  const fabric = document.getElementById('newFabric').value.trim();
  const collectDate = document.getElementById('newCollectDate').value;

  if(!pendingUploadDataUrl && !owner){
    showToast('请至少上传图片或填写归属人');
    return;
  }

  const rec = {
    id: uid(),
    image: pendingUploadDataUrl || '',
    owner, fabric, collectDate,
    makeDate: '',
    settleDate: '',
    settleAmount: '',
    remark: '',
    archived: false,
    calibration: null,
    customFields: [],
    createdAt: Date.now()
  };
  records.push(rec);
  saveRecords();
  closeAddModal();
  selectRecord(rec.id);
  if(window.innerWidth <= 680) showMobilePane('data');
  showToast('已新增衣样档案');
}

/* ---------- export / import backup ---------- */
function exportBackup(){
  const payload = {
    app: 'garment-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `裁档备份_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`已导出 ${records.length} 条档案`);
}

let pendingImportData = null;
function openImportModal(){
  pendingImportData = null;
  document.getElementById('importFileInput').value = '';
  document.getElementById('importFileName').style.display = 'none';
  document.getElementById('confirmImport').disabled = true;
  document.getElementById('importModal').classList.add('show');
}
function closeImportModal(){
  document.getElementById('importModal').classList.remove('show');
}

function handleImportFile(file){
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e)=>{
    try{
      const data = JSON.parse(e.target.result);
      if(!data.records || !Array.isArray(data.records)){
        throw new Error('文件格式不正确');
      }
      pendingImportData = data.records;
      document.getElementById('importFileName').textContent = `已选择：${file.name}（包含 ${data.records.length} 条记录）`;
      document.getElementById('importFileName').style.display = 'block';
      document.getElementById('confirmImport').disabled = false;
    }catch(err){
      showToast('文件解析失败，请确认是正确的备份文件');
      pendingImportData = null;
      document.getElementById('confirmImport').disabled = true;
    }
  };
  reader.readAsText(file);
}

function confirmImportRecords(){
  if(!pendingImportData) return;
  const existingIds = new Set(records.map(r=>r.id));
  let added = 0, updated = 0;
  pendingImportData.forEach(incoming=>{
    const idx = records.findIndex(r=>r.id===incoming.id);
    if(idx >= 0){
      records[idx] = incoming;
      updated++;
    } else {
      records.push(incoming);
      added++;
    }
  });
  saveRecords();
  closeImportModal();
  renderList();
  renderData();
  showToast(`导入完成：新增 ${added} 条，更新 ${updated} 条`);
}

/* ---------- toast ---------- */
let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2400);
}

/* =========================================================
   图片查看器 + 校准量尺
   ========================================================= */
const CM_PER_CUN = 10/3; // 1 市寸 ≈ 3.3333 厘米（1 市尺 = 10 市寸 = 100/3 厘米）

const viewer = {
  recordId: null,
  scale: 1,
  minScale: 0.1,
  maxScale: 8,
  tx: 0, ty: 0,           // 自然像素(0,0) 在 stage 坐标系中的位置
  naturalWidth: 0,
  naturalHeight: 0,
  rulerUnit: 'cm',         // 'cm' | 'cun'
  calibrating: false,
  calibConfirmedOnce: false, // 本次校准会话中是否已经放置过点
  p1: null, p2: null,      // 校准两端点（自然像素坐标）
  draggingHandle: null,    // 'p1' | 'p2' | null
  isPanning: false,
  panStart: null,
  pinch: null,             // {startDist, startScale, midScreen}
};

/* ---------- 视口高度同步（应对手机浏览器地址栏动态收起/展开） ---------- */
/* ---------- 浮动窗口：可拖拽 + 安全定位 ---------- */
// 记录每个浮窗当前是否已经被用户手动拖动过（拖动过的就不再自动重新定位，尊重用户摆放）
const floatingPanelDragged = {};

function resetFloatingPanelPosition(elId){
  if(floatingPanelDragged[elId]) return; // 用户已手动摆放过，不要打断
  const el = document.getElementById(elId);
  if(!el) return;
  // 清除可能残留的手动拖拽样式，恢复CSS默认（居中）定位
  el.style.left = '';
  el.style.top = '';
  el.style.right = '';
  el.style.bottom = '';
  el.style.transform = '';
  if(elId === 'calibPanel'){
    el.style.bottom = '18px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
  } else if(elId === 'calibBanner'){
    // 工具条在手机上可能换行为两行，用实际高度+间距来定位，避免重叠
    const topbar = document.querySelector('.viewer-topbar');
    const topbarBottom = topbar ? topbar.getBoundingClientRect().bottom : 36;
    el.style.top = (topbarBottom + 10) + 'px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
  }
}

function clampToViewport(left, top, width, height){
  const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const margin = 6;
  const maxLeft = vw - width - margin;
  const maxTop = vh - height - margin;
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top))
  };
}

function makeDraggable(panelId, handleId){
  const panel = document.getElementById(panelId);
  const handle = document.getElementById(handleId);
  if(!panel || !handle) return;

  let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  handle.addEventListener('pointerdown', (e)=>{
    dragging = true;
    floatingPanelDragged[panelId] = true;
    const rect = panel.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    // 切换为像素定位，脱离原来的 left:50%/transform 居中方式
    panel.style.left = startLeft + 'px';
    panel.style.top = startTop + 'px';
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.transform = 'none';
    handle.setPointerCapture && handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = panel.getBoundingClientRect();
    const clamped = clampToViewport(startLeft+dx, startTop+dy, rect.width, rect.height);
    panel.style.left = clamped.left + 'px';
    panel.style.top = clamped.top + 'px';
  });

  ['pointerup','pointercancel'].forEach(evt=>{
    window.addEventListener(evt, ()=>{ dragging = false; });
  });
}

function openImageViewer(recordId){
  const r = records.find(x=>x.id===recordId);
  if(!r || !r.image) return;
  viewer.recordId = recordId;
  viewer.rulerUnit = 'cm';
  viewer.calibrating = false;
  viewer.p1 = null; viewer.p2 = null;

  // 每次重新打开查看器，浮窗都恢复默认安全位置（不沿用上一次拖动的位置）
  floatingPanelDragged.calibPanel = false;
  floatingPanelDragged.calibBanner = false;
  resetFloatingPanelPosition('calibPanel');
  resetFloatingPanelPosition('calibBanner');

  document.getElementById('unitToggle').querySelectorAll('button').forEach(b=>{
    b.classList.toggle('active', b.dataset.unit==='cm');
  });
  document.getElementById('calibrateBtn').classList.remove('active');
  document.getElementById('calibPanel').style.display = 'none';
  document.getElementById('calibBanner').style.display = 'none';

  document.getElementById('viewerOverlay').classList.add('show');

  const img = document.getElementById('viewerImg');
  img.onload = ()=>{
    viewer.naturalWidth = img.naturalWidth;
    viewer.naturalHeight = img.naturalHeight;
    img.style.width = viewer.naturalWidth + 'px';
    img.style.height = viewer.naturalHeight + 'px';
    document.getElementById('calibLayer').setAttribute('width', viewer.naturalWidth);
    document.getElementById('calibLayer').setAttribute('height', viewer.naturalHeight);
    document.getElementById('calibLayer').setAttribute('viewBox', `0 0 ${viewer.naturalWidth} ${viewer.naturalHeight}`);

    // 载入已保存的校准点（如果有）
    if(r.calibration && r.calibration.p1 && r.calibration.p2){
      viewer.p1 = {...r.calibration.p1};
      viewer.p2 = {...r.calibration.p2};
    }

    fitImageToStage();
    renderCalibLayer();
    drawRulers();
    updateCalibrateBtnLabel();
  };
  img.src = r.image;

  document.getElementById('viewerTitle').textContent = (r.owner ? r.owner + ' · ' : '') + (r.fabric || '衣样大图');
}

function closeImageViewer(){
  document.getElementById('viewerOverlay').classList.remove('show');
  viewer.recordId = null;
  viewer.calibrating = false;
}

function updateCalibrateBtnLabel(){
  const r = records.find(x=>x.id===viewer.recordId);
  const btn = document.getElementById('calibrateBtn');
  const hasCalib = r && r.calibration;
  btn.querySelector('.full-label').textContent = viewer.calibrating
    ? '取消校准'
    : (hasCalib ? '重新校准' : '校准比例尺');
}

function fitImageToStage(){
  const stage = document.getElementById('viewerStage');
  const rect = stage.getBoundingClientRect();

  // 容器尺寸异常（例如刚切换布局、尚未完成排版）时，下一帧再试一次，而不是用坏数据算出图片消失
  if(!rect.width || !rect.height || !isFinite(rect.width) || !isFinite(rect.height)){
    requestAnimationFrame(fitImageToStage);
    return;
  }

  const padding = 24;
  const availW = Math.max(40, rect.width - padding*2);
  const availH = Math.max(40, rect.height - padding*2);
  const scaleW = availW / viewer.naturalWidth;
  const scaleH = availH / viewer.naturalHeight;
  let scale = Math.min(scaleW, scaleH, 1.5);
  if(!isFinite(scale) || scale <= 0) scale = 1;
  viewer.scale = scale;

  let tx = (rect.width - viewer.naturalWidth*viewer.scale) / 2;
  let ty = (rect.height - viewer.naturalHeight*viewer.scale) / 2;
  if(!isFinite(tx)) tx = 0;
  if(!isFinite(ty)) ty = 0;
  viewer.tx = tx;
  viewer.ty = ty;

  applyViewerTransform();
}

function applyViewerTransform(){
  // 防御：任何环节算出 NaN/Infinity 都不要写进 transform，否则图片会整个不见
  if(!isFinite(viewer.scale) || viewer.scale <= 0) viewer.scale = 1;
  if(!isFinite(viewer.tx)) viewer.tx = 0;
  if(!isFinite(viewer.ty)) viewer.ty = 0;
  viewer.scale = Math.max(viewer.minScale, Math.min(viewer.maxScale, viewer.scale));

  const wrap = document.getElementById('viewerCanvasWrap');
  wrap.style.transform = `translate(${viewer.tx}px, ${viewer.ty}px) scale(${viewer.scale})`;
  document.getElementById('zoomLabel').textContent = Math.round(viewer.scale*100) + '%';
  updateHandleSizes();
  drawRulers();
}

function screenToNatural(clientX, clientY){
  const rect = document.getElementById('viewerStage').getBoundingClientRect();
  const sx = clientX - rect.left;
  const sy = clientY - rect.top;
  return {
    x: (sx - viewer.tx) / viewer.scale,
    y: (sy - viewer.ty) / viewer.scale
  };
}

function zoomBy(factor, screenX, screenY){
  if(!isFinite(factor) || factor <= 0) return; // 非法缩放比例直接忽略，绝不让状态变坏

  const stage = document.getElementById('viewerStage');
  const rect = stage.getBoundingClientRect();
  if(!rect.width || !rect.height) return;

  const cx = screenX!=null ? screenX - rect.left : rect.width/2;
  const cy = screenY!=null ? screenY - rect.top : rect.height/2;

  const before = { x:(cx - viewer.tx)/viewer.scale, y:(cy - viewer.ty)/viewer.scale };
  let newScale = viewer.scale * factor;
  newScale = Math.max(viewer.minScale, Math.min(viewer.maxScale, newScale));
  if(!isFinite(newScale) || newScale <= 0) return;

  viewer.scale = newScale;
  let tx = cx - before.x*viewer.scale;
  let ty = cy - before.y*viewer.scale;
  viewer.tx = isFinite(tx) ? tx : viewer.tx;
  viewer.ty = isFinite(ty) ? ty : viewer.ty;
  applyViewerTransform();
}

/* ---------- ruler drawing ---------- */
function drawRulers(){
  const r = records.find(x=>x.id===viewer.recordId);
  const topCanvas = document.getElementById('rulerTop');
  const rightCanvas = document.getElementById('rulerRight');
  const dpr = window.devicePixelRatio || 1;

  [topCanvas, rightCanvas].forEach(c=>{
    const cssW = c.clientWidth, cssH = c.clientHeight;
    if(c.width !== cssW*dpr) c.width = cssW*dpr;
    if(c.height !== cssH*dpr) c.height = cssH*dpr;
  });

  const ctxTop = topCanvas.getContext('2d');
  const ctxRight = rightCanvas.getContext('2d');
  ctxTop.save(); ctxTop.scale(dpr,dpr);
  ctxRight.save(); ctxRight.scale(dpr,dpr);
  ctxTop.clearRect(0,0,topCanvas.clientWidth, topCanvas.clientHeight);
  ctxRight.clearRect(0,0,rightCanvas.clientWidth, rightCanvas.clientHeight);

  const calibrated = r && r.calibration && r.calibration.pixelsPerCm > 0;

  if(!calibrated){
    drawUncalibratedHint(ctxTop, topCanvas.clientWidth, topCanvas.clientHeight, true);
    drawUncalibratedHint(ctxRight, rightCanvas.clientWidth, rightCanvas.clientHeight, false);
    ctxTop.restore(); ctxRight.restore();
    return;
  }

  const pixelsPerCm = r.calibration.pixelsPerCm;
  const screenPxPerCm = pixelsPerCm * viewer.scale;
  const stepUnitCm = viewer.rulerUnit === 'cm' ? 1 : CM_PER_CUN;
  const screenPxPerStep = screenPxPerCm * stepUnitCm;

  // 主刻度分组：厘米 每5格一个数字、每10格加粗；市寸 每5寸（半尺）一个数字，每10寸（1尺）加粗
  const majorEvery = 5;
  const boldEvery = 10;
  const unitLabel = viewer.rulerUnit === 'cm' ? 'cm' : '寸';

  drawRulerAxis(ctxTop, topCanvas.clientWidth, topCanvas.clientHeight, viewer.tx, screenPxPerStep, majorEvery, boldEvery, unitLabel, true);
  drawRulerAxis(ctxRight, rightCanvas.clientHeight, rightCanvas.clientWidth, viewer.ty, screenPxPerStep, majorEvery, boldEvery, unitLabel, false);

  ctxTop.restore(); ctxRight.restore();
}

function drawUncalibratedHint(ctx, w, h, isHorizontal){
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#6B7186';
  ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.textBaseline = 'middle';
  if(isHorizontal){
    ctx.textAlign = 'center';
    ctx.fillText('未校准比例尺 · 点击上方"校准比例尺"', w/2, h/2);
  }
  // 竖直方向窄，不放文字，留空即可
}

function drawRulerAxis(ctx, lengthPx, thicknessPx, origin, pxPerStep, majorEvery, boldEvery, unitLabel, isHorizontal){
  ctx.font = '11px "Noto Sans SC", sans-serif';
  ctx.lineWidth = 1;

  if(pxPerStep < 2) return; // 太密集就不画，避免卡顿

  const nStart = Math.floor((0 - origin) / pxPerStep) - 1;
  const nEnd = Math.ceil((lengthPx - origin) / pxPerStep) + 1;

  for(let n = nStart; n <= nEnd; n++){
    const pos = origin + n*pxPerStep;
    if(pos < -2 || pos > lengthPx+2) continue;
    const isBold = (n % boldEvery === 0);
    const isMajor = (n % majorEvery === 0);
    const tickLen = isBold ? thicknessPx*0.68 : isMajor ? thicknessPx*0.5 : thicknessPx*0.3;

    ctx.beginPath();
    ctx.strokeStyle = isBold ? '#FFB37A' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = isBold ? 2 : 1.3;
    if(isHorizontal){
      ctx.moveTo(pos, thicknessPx);
      ctx.lineTo(pos, thicknessPx - tickLen);
    } else {
      ctx.moveTo(thicknessPx, pos);
      ctx.lineTo(thicknessPx - tickLen, pos);
    }
    ctx.stroke();

    if(isMajor){
      const label = String(n);
      ctx.fillStyle = isBold ? '#FFD9B3' : '#F0EEE6';
      ctx.font = isBold ? 'bold 11px "Noto Sans SC", sans-serif' : '11px "Noto Sans SC", sans-serif';
      if(isHorizontal){
        ctx.textAlign = 'center';
        ctx.fillText(label, pos, thicknessPx - tickLen - 6);
      } else {
        ctx.save();
        ctx.translate(thicknessPx - tickLen - 6, pos);
        ctx.rotate(-Math.PI/2);
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }

  // 单位标签，画在起点角落
  ctx.fillStyle = '#D8D4C8';
  ctx.font = 'bold 10px "Noto Sans SC", sans-serif';
  if(isHorizontal){
    ctx.textAlign = 'left';
    ctx.fillText(unitLabel, 4, thicknessPx-3);
  }
}

/* ---------- calibration handle layer ---------- */
function renderCalibLayer(){
  const svg = document.getElementById('calibLayer');
  svg.innerHTML = '';
  if(!viewer.p1 || !viewer.p2) return;

  const line = document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('class','calib-line');
  line.setAttribute('x1', viewer.p1.x); line.setAttribute('y1', viewer.p1.y);
  line.setAttribute('x2', viewer.p2.x); line.setAttribute('y2', viewer.p2.y);
  svg.appendChild(line);

  ['p1','p2'].forEach(key=>{
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('class','calib-handle');
    c.setAttribute('data-handle', key);
    c.setAttribute('cx', viewer[key].x);
    c.setAttribute('cy', viewer[key].y);
    c.setAttribute('r', 10/viewer.scale);
    if(!viewer.calibrating) c.setAttribute('style','pointer-events:none;');
    svg.appendChild(c);
  });
}

function updateHandleSizes(){
  const svg = document.getElementById('calibLayer');
  if(!svg) return;
  svg.querySelectorAll('.calib-handle').forEach(c=>{
    c.setAttribute('r', 10/viewer.scale);
  });
}

function startCalibration(){
  viewer.calibrating = true;
  document.getElementById('calibrateBtn').classList.add('active');
  resetFloatingPanelPosition('calibBanner');
  document.getElementById('calibBanner').style.display = 'flex';
  document.getElementById('calibPanel').style.display = 'none';

  if(!viewer.p1 || !viewer.p2){
    // 给一个默认的居中参考线，宽度约为图片宽度的 30%
    const cx = viewer.naturalWidth/2, cy = viewer.naturalHeight/2;
    const half = viewer.naturalWidth*0.15;
    viewer.p1 = { x: cx-half, y: cy };
    viewer.p2 = { x: cx+half, y: cy };
  }
  renderCalibLayer();
  updateCalibrateBtnLabel();
}

function cancelCalibration(){
  viewer.calibrating = false;
  document.getElementById('calibrateBtn').classList.remove('active');
  document.getElementById('calibBanner').style.display = 'none';
  document.getElementById('calibPanel').style.display = 'none';

  const r = records.find(x=>x.id===viewer.recordId);
  if(r && r.calibration){
    viewer.p1 = {...r.calibration.p1};
    viewer.p2 = {...r.calibration.p2};
  } else {
    viewer.p1 = null; viewer.p2 = null;
  }
  renderCalibLayer();
  drawRulers();
  updateCalibrateBtnLabel();
}

function openCalibPanel(){
  document.getElementById('calibBanner').style.display = 'none';
  resetFloatingPanelPosition('calibPanel');
  document.getElementById('calibPanel').style.display = 'flex';
  document.getElementById('calibLengthInput').value = '';
  document.getElementById('calibLengthInput').focus();
}

function confirmCalibration(){
  const val = parseFloat(document.getElementById('calibLengthInput').value);
  if(!val || val <= 0){
    showToast('请输入大于 0 的实际长度（厘米）');
    return;
  }
  const r = records.find(x=>x.id===viewer.recordId);
  if(!r) return;
  const dx = viewer.p2.x - viewer.p1.x;
  const dy = viewer.p2.y - viewer.p1.y;
  const naturalDist = Math.sqrt(dx*dx + dy*dy);
  if(naturalDist < 1){
    showToast('参考线太短，请拉开一点距离再校准');
    return;
  }
  const pixelsPerCm = naturalDist / val;
  r.calibration = {
    realLength: val,
    pixelsPerCm,
    p1: {...viewer.p1},
    p2: {...viewer.p2}
  };
  saveRecords();

  viewer.calibrating = false;
  document.getElementById('calibrateBtn').classList.remove('active');
  document.getElementById('calibBanner').style.display = 'none';
  document.getElementById('calibPanel').style.display = 'none';
  renderCalibLayer();
  drawRulers();
  updateCalibrateBtnLabel();
  showToast('校准完成，比例尺已生效并保存');
}

/* ---------- pointer interactions on stage ---------- */
function getDist(t1, t2){
  return Math.hypot(t1.clientX-t2.clientX, t1.clientY-t2.clientY);
}
function getMid(t1, t2){
  return { x:(t1.clientX+t2.clientX)/2, y:(t1.clientY+t2.clientY)/2 };
}

function initViewerInteractions(){
  const stage = document.getElementById('viewerStage');

  // ----- mouse wheel zoom (desktop) -----
  stage.addEventListener('wheel', (e)=>{
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive:false });

  // ----- calibration handle drag (mouse + touch via pointer events) -----
  const calibLayer = document.getElementById('calibLayer');
  calibLayer.addEventListener('pointerdown', (e)=>{
    if(!viewer.calibrating) return;
    const target = e.target.closest('.calib-handle');
    if(!target) return;
    e.stopPropagation();
    viewer.draggingHandle = target.dataset.handle;
    target.setPointerCapture && target.setPointerCapture(e.pointerId);
  });

  window.addEventListener('pointermove', (e)=>{
    if(viewer.draggingHandle){
      const nat = screenToNatural(e.clientX, e.clientY);
      viewer[viewer.draggingHandle] = nat;
      renderCalibLayer();
    }
  });
  window.addEventListener('pointerup', ()=>{
    if(viewer.draggingHandle){
      viewer.draggingHandle = null;
      if(document.getElementById('calibPanel').style.display !== 'flex'){
        openCalibPanel();
      }
    }
  });

  // ----- pan (mouse drag) -----
  stage.addEventListener('pointerdown', (e)=>{
    if(viewer.calibrating) return; // 校准模式下交给 calibLayer 处理把手拖拽，空白处不平移，避免误触
    if(e.target.closest('.calib-handle')) return;
    viewer.isPanning = true;
    viewer.panStart = { x:e.clientX, y:e.clientY, tx:viewer.tx, ty:viewer.ty };
    stage.classList.add('panning');
    stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e)=>{
    if(!viewer.isPanning) return;
    viewer.tx = viewer.panStart.tx + (e.clientX - viewer.panStart.x);
    viewer.ty = viewer.panStart.ty + (e.clientY - viewer.panStart.y);
    applyViewerTransform();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
    stage.addEventListener(evt, ()=>{
      viewer.isPanning = false;
      stage.classList.remove('panning');
    });
  });

  // ----- pinch zoom (touch) -----
  stage.addEventListener('touchstart', (e)=>{
    if(e.touches.length === 2){
      viewer.isPanning = false;
      const startDist = getDist(e.touches[0], e.touches[1]);
      // 两指距离太近（误触/手指刚接触）时不开始缩放手势，避免 factor 突变
      if(startDist < 10) { viewer.pinch = null; return; }
      viewer.pinch = {
        startDist,
        startScale: viewer.scale
      };
    }
  }, { passive:true });
  stage.addEventListener('touchmove', (e)=>{
    if(e.touches.length === 2 && viewer.pinch){
      const dist = getDist(e.touches[0], e.touches[1]);
      if(dist < 10) return; // 同样防止极端比例
      const mid = getMid(e.touches[0], e.touches[1]); // 用实时中点，手势中心可随手指移动
      const factor = dist / viewer.pinch.startDist;
      if(!isFinite(factor) || factor <= 0) return;
      const newScale = Math.max(viewer.minScale, Math.min(viewer.maxScale, viewer.pinch.startScale*factor));
      const ratio = newScale / viewer.scale;
      if(isFinite(ratio) && ratio > 0) zoomBy(ratio, mid.x, mid.y);
    }
  }, { passive:true });
  stage.addEventListener('touchend', (e)=>{
    if(e.touches.length < 2) viewer.pinch = null;
  });

  // resize: refit ruler canvases
  window.addEventListener('resize', ()=>{
    if(document.getElementById('viewerOverlay').classList.contains('show')){
      drawRulers();
    }
  });
}

function bindViewerControls(){
  document.getElementById('viewerClose').addEventListener('click', closeImageViewer);
  document.getElementById('viewerOverlay').addEventListener('click', (e)=>{
    if(e.target.id === 'viewerOverlay') closeImageViewer();
  });

  document.getElementById('zoomInBtn').addEventListener('click', ()=> zoomBy(1.25));
  document.getElementById('zoomOutBtn').addEventListener('click', ()=> zoomBy(1/1.25));
  document.getElementById('zoomResetBtn').addEventListener('click', fitImageToStage);

  document.getElementById('unitToggle').addEventListener('click', (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    viewer.rulerUnit = btn.dataset.unit;
    document.getElementById('unitToggle').querySelectorAll('button').forEach(b=>{
      b.classList.toggle('active', b===btn);
    });
    drawRulers();
  });

  document.getElementById('calibrateBtn').addEventListener('click', ()=>{
    if(viewer.calibrating){
      cancelCalibration();
    } else {
      startCalibration();
    }
  });

  document.getElementById('calibConfirmBtn').addEventListener('click', confirmCalibration);
  document.getElementById('calibCancelBtn').addEventListener('click', ()=>{
    document.getElementById('calibPanel').style.display = 'none';
    resetFloatingPanelPosition('calibBanner');
    document.getElementById('calibBanner').style.display = 'flex';
  });

  makeDraggable('calibPanel', 'calibPanelHandle');
  makeDraggable('calibBanner', 'calibBanner');

  initViewerInteractions();
}

/* ---------- wire up ---------- */
function init(){
  loadRecords();
  renderList();
  renderData();

  document.getElementById('searchInput').addEventListener('input', renderList);

  document.getElementById('addBtn').addEventListener('click', openAddModal);
  document.getElementById('closeAddModal').addEventListener('click', closeAddModal);
  document.getElementById('cancelAdd').addEventListener('click', closeAddModal);
  document.getElementById('confirmAdd').addEventListener('click', confirmAddRecord);

  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', (e)=> handleFileSelect(e.target.files[0]));
  uploadZone.addEventListener('dragover', (e)=>{ e.preventDefault(); uploadZone.style.borderColor = 'var(--indigo)'; });
  uploadZone.addEventListener('dragleave', ()=>{ uploadZone.style.borderColor = ''; });
  uploadZone.addEventListener('drop', (e)=>{
    e.preventDefault();
    uploadZone.style.borderColor = '';
    if(e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  });

  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', openImportModal);
  document.getElementById('closeImportModal').addEventListener('click', closeImportModal);
  document.getElementById('cancelImport').addEventListener('click', closeImportModal);
  document.getElementById('confirmImport').addEventListener('click', confirmImportRecords);

  const importFileInput = document.getElementById('importFileInput');
  const importZone = document.getElementById('importZone');
  importFileInput.addEventListener('change', (e)=> handleImportFile(e.target.files[0]));
  importZone.addEventListener('dragover', (e)=>{ e.preventDefault(); importZone.style.borderColor = 'var(--indigo)'; });
  importZone.addEventListener('dragleave', ()=>{ importZone.style.borderColor = ''; });
  importZone.addEventListener('drop', (e)=>{
    e.preventDefault();
    importZone.style.borderColor = '';
    if(e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
  });

  document.getElementById('tabImages').addEventListener('click', ()=> showMobilePane('images'));
  document.getElementById('tabData').addEventListener('click', ()=> showMobilePane('data'));

  // close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(ov=>{
    ov.addEventListener('click', (e)=>{
      if(e.target === ov) ov.classList.remove('show');
    });
  });

  bindViewerControls();
}

document.addEventListener('DOMContentLoaded', init);

/* ---------- PWA: 注册 Service Worker，使App可安装、可离线启动 ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service Worker 注册失败（不影响App内数据功能）：', err);
    });
  });
}
