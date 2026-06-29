/* =========================================================
   裁档 · 衣样图录  —  本地离线数据管理
   数据结构（单条记录 record）：
   {
     id: string,
     images: [{ id, dataUrl, calibration }],
              // 多张图片，每张有自己的id、base64数据、独立的量尺校准数据
              // images[0] 作为左侧列表的封面缩略图
     owner: string,           // 归属人（固定字段）
     fabric: string,          // 布料（固定字段）
     collectDate: string,     // 收录日期 (固定字段)
     makeDate: string,        // 制作日期 (固定字段)
     settleDate: string,      // 结算日期 (固定字段，留空=未结算)
     settleAmount: string,    // 结算金额 (固定字段)
     remark: string,          // 备注 (固定字段)
     archived: boolean,       // 是否已归档（手动点击触发，按钮文案为"结算"）
     customFields: [{id, label, value}],  // 自定义字段
     createdAt: number
   }
   单张图片对象（images数组里的元素）：
   {
     id: string,
     dataUrl: string,          // base64 dataURL
     calibration: { realLength: number, pixelsPerCm: number, p1:{x,y}, p2:{x,y} } | null
   }
   ========================================================= */

const STORAGE_KEY = 'garmentArchive.records.v1';

let records = [];
let activeId = null;
let activeImageId = null;     // 当前在右侧详情区被选中查看/编辑的图片id
let pendingUploadImages = []; // 新建记录弹窗里，已选但还未保存的图片列表 [{id, dataUrl}]

/* ---------- persistence ---------- */
function loadRecords(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    records = raw ? JSON.parse(raw) : [];
    records.forEach(migrateRecordToMultiImage);
  }catch(e){
    console.error('读取本地数据失败', e);
    records = [];
  }
}

// 兼容旧版本数据：旧记录是单张图片 record.image + record.calibration，
// 自动迁移成新版的 record.images 数组结构，迁移后删除旧字段，避免冗余。
function migrateRecordToMultiImage(r){
  if(Array.isArray(r.images)) return; // 已经是新结构
  r.images = [];
  if(r.image){
    r.images.push({
      id: uid(),
      dataUrl: r.image,
      calibration: r.calibration || null
    });
  }
  delete r.image;
  delete r.calibration;
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
function coverImage(r){
  return (r.images && r.images.length) ? r.images[0] : null;
}
function findImage(r, imageId){
  return (r.images||[]).find(im=>im.id===imageId) || null;
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
      if(window.innerWidth <= 860){
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
  const cover = coverImage(r);
  const thumb = cover
    ? `<img src="${cover.dataUrl}" alt="">`
    : `<svg class="placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
  const imgCount = (r.images||[]).length;
  const countTag = imgCount > 1 ? `<span class="card-img-count">${imgCount}图</span>` : '';
  const metaParts = [];
  if(r.fabric) metaParts.push(r.fabric);
  if(r.collectDate) metaParts.push('收录 ' + r.collectDate);
  return `
    <div class="card${active}${archivedClass}" data-id="${r.id}">
      ${badge}
      <div class="card-thumb">${thumb}${countTag}</div>
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

  const photoGridHtml = (r.images||[]).map((im, idx)=>`
    <div class="photo-thumb" data-image-id="${im.id}">
      <img src="${im.dataUrl}" alt="">
      ${idx===0 ? `<span class="cover-tag">封面</span>` : ''}
      <span class="zoom-hint small"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M9 8v6M6 11h6"/></svg></span>
      <button class="photo-remove" data-remove-image="${im.id}" title="删除这张图">&times;</button>
    </div>
  `).join('');

  const addPhotoTile = `
    <div class="photo-thumb add-tile" id="addPhotoTile">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      <span>加图片</span>
    </div>`;

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

    <div class="record-title-block" style="margin-bottom:14px;">
      ${statusChip}
      <h2 id="ownerTitle">${escapeHtml(r.owner) || '未命名'}</h2>
      <div class="subline">${escapeHtml(r.fabric) || '尚未填写布料'}</div>
    </div>

    <div class="photo-grid" id="photoGrid">
      ${photoGridHtml}
      ${addPhotoTile}
    </div>
    <input type="file" id="addPhotoInput" accept="image/*" multiple style="display:none;">

    <div class="record-actions" style="margin-bottom:22px;">
      <button class="btn btn-archive ${r.archived?'is-archived':''}" id="archiveBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 13h4"/></svg>
        ${r.archived ? '取消结算' : '结算'}
      </button>
      <button class="btn" id="shareBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
        分享PDF
      </button>
      <button class="btn btn-danger" id="deleteBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
        删除
      </button>
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

  const replaceBtn = document.getElementById('shareBtn');
  if(replaceBtn){
    replaceBtn.addEventListener('click', ()=> shareRecordAsPdf(r.id));
  }

  const backBtn = document.getElementById('backToList');
  if(backBtn){
    backBtn.addEventListener('click', ()=> showMobilePane('images'));
  }

  // ----- 图片网格：点击放大查看 / 删除单张 / 添加图片 -----
  scroll.querySelectorAll('.photo-thumb[data-image-id]').forEach(tile=>{
    tile.addEventListener('click', (e)=>{
      if(e.target.closest('.photo-remove')) return; // 删除按钮单独处理，不触发放大
      openImageViewer(r.id, tile.dataset.imageId);
    });
  });
  scroll.querySelectorAll('[data-remove-image]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const imgId = btn.dataset.removeImage;
      if(!confirm('删除这张图片？此操作无法撤销。')) return;
      r.images = (r.images||[]).filter(im=>im.id!==imgId);
      saveRecords();
      renderList();
      renderData();
      showToast('已删除这张图片');
    });
  });

  const addPhotoTile = document.getElementById('addPhotoTile');
  const addPhotoInput = document.getElementById('addPhotoInput');
  if(addPhotoTile && addPhotoInput){
    addPhotoTile.addEventListener('click', ()=> addPhotoInput.click());
    addPhotoInput.addEventListener('change', (e)=>{
      const files = Array.from(e.target.files||[]);
      if(!files.length) return;
      let loaded = 0;
      files.forEach(file=>{
        const reader = new FileReader();
        reader.onload = (ev)=>{
          r.images = r.images || [];
          r.images.push({ id: uid(), dataUrl: ev.target.result, calibration: null });
          loaded++;
          if(loaded === files.length){
            saveRecords();
            renderList();
            renderData();
            showToast(files.length>1 ? `已添加 ${files.length} 张图片` : '已添加图片');
          }
        };
        reader.readAsDataURL(file);
      });
      addPhotoInput.value = '';
    });
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
  pendingUploadImages = [];
  renderUploadPreviewGrid();
  document.getElementById('uploadHint').textContent = '点击或拖拽图片到此处（可一次选多张）';
  document.getElementById('newOwner').value = '';
  document.getElementById('newFabric').value = '';
  document.getElementById('newCollectDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('fileInput').value = '';
  document.getElementById('addModal').classList.add('show');
}
function closeAddModal(){
  document.getElementById('addModal').classList.remove('show');
}

function renderUploadPreviewGrid(){
  const grid = document.getElementById('uploadPreviewGrid');
  grid.innerHTML = pendingUploadImages.map(im=>`
    <div class="preview-tile" data-temp-id="${im.id}">
      <img src="${im.dataUrl}" alt="">
      <button class="remove-preview" data-remove-temp="${im.id}">&times;</button>
    </div>
  `).join('');
  document.getElementById('uploadHint').textContent = pendingUploadImages.length
    ? `已选择 ${pendingUploadImages.length} 张图片，可继续添加或点x移除`
    : '点击或拖拽图片到此处（可一次选多张）';
  grid.querySelectorAll('[data-remove-temp]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const tid = btn.dataset.removeTemp;
      pendingUploadImages = pendingUploadImages.filter(im=>im.id!==tid);
      renderUploadPreviewGrid();
    });
  });
}

function handleFileSelect(files){
  const list = Array.from(files||[]);
  if(!list.length) return;
  let loaded = 0;
  list.forEach(file=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      pendingUploadImages.push({ id: uid(), dataUrl: e.target.result });
      loaded++;
      if(loaded === list.length){
        renderUploadPreviewGrid();
      }
    };
    reader.readAsDataURL(file);
  });
}

function confirmAddRecord(){
  const owner = document.getElementById('newOwner').value.trim();
  const fabric = document.getElementById('newFabric').value.trim();
  const collectDate = document.getElementById('newCollectDate').value;

  if(!pendingUploadImages.length && !owner){
    showToast('请至少上传图片或填写归属人');
    return;
  }

  const rec = {
    id: uid(),
    images: pendingUploadImages.map(im=>({ id: im.id, dataUrl: im.dataUrl, calibration: null })),
    owner, fabric, collectDate,
    makeDate: '',
    settleDate: '',
    settleAmount: '',
    remark: '',
    archived: false,
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
/* =========================================================
   百度网盘云同步（简化模式 OAuth，纯前端，无自建服务器）
   ========================================================= */
// ⚠️ 这里必须填百度开发者后台的 App Key（client_id），不是 App Secret。
// 如果填错/应用不存在/应用被停用，百度会返回 invalid_client / unknown client_id。
// 你的回调地址需要在后台配置为： https://jiujiaoheisan.github.io/CaiFeng/index.html
const BAIDU_APP_KEY = '请把这里替换成你的百度AppKey';
const BAIDU_REDIRECT_URI = 'https://jiujiaoheisan.github.io/CaiFeng/index.html';
const BAIDU_AUTH_STORAGE_KEY = 'garmentArchive.baiduAuth.v1';
const BAIDU_SYNC_PATH = '/apps/裁档衣样图录/sync-data.json'; // 网盘里固定存放同步数据的位置
const BAIDU_LAST_SYNC_KEY = 'garmentArchive.lastSyncAt.v1';

let baiduAuth = null; // { access_token, expires_at }

function loadBaiduAuth(){
  try{
    const raw = localStorage.getItem(BAIDU_AUTH_STORAGE_KEY);
    baiduAuth = raw ? JSON.parse(raw) : null;
    if(baiduAuth && baiduAuth.expires_at && Date.now() > baiduAuth.expires_at){
      baiduAuth = null; // 已过期，当作未登录
      localStorage.removeItem(BAIDU_AUTH_STORAGE_KEY);
    }
  }catch(e){
    baiduAuth = null;
  }
}

function saveBaiduAuth(accessToken, expiresInSeconds){
  baiduAuth = {
    access_token: accessToken,
    expires_at: Date.now() + (expiresInSeconds*1000)
  };
  localStorage.setItem(BAIDU_AUTH_STORAGE_KEY, JSON.stringify(baiduAuth));
}

function clearBaiduAuth(){
  baiduAuth = null;
  localStorage.removeItem(BAIDU_AUTH_STORAGE_KEY);
}

// 页面加载时检查网址末尾是否带着百度跳转回来的登录令牌（#access_token=...），有就解析出来存好，并清掉网址里的痕迹
function checkBaiduAuthRedirect(){
  const hash = window.location.hash || '';
  const query = window.location.search || '';

  // 百度授权失败时，有些错误会带在 query 里，有些会带在 hash 里；这里都兼容显示。
  const errorParams = new URLSearchParams((hash.startsWith('#') ? hash.slice(1) : hash) || (query.startsWith('?') ? query.slice(1) : query));
  const err = errorParams.get('error');
  const errDesc = errorParams.get('error_description') || errorParams.get('error_msg');
  if(err){
    showToast('百度授权失败：' + err + (errDesc ? ' / ' + errDesc : ''));
    console.warn('百度授权失败：', err, errDesc);
    return;
  }

  if(hash.indexOf('access_token=') === -1) return;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in'), 10) || 86400;
  if(token){
    saveBaiduAuth(token, expiresIn);
    showToast('百度网盘登录成功');
  }
  // 清掉网址末尾的令牌信息，避免刷新/分享时泄露
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function startBaiduLogin(){
  const appKey = String(BAIDU_APP_KEY || '').trim();
  if(!appKey || appKey.includes('请把这里替换')){
    showToast('请先在 app.js 里填写百度 App Key');
    console.error('缺少百度 App Key：请把 BAIDU_APP_KEY 改成百度开发者后台的 App Key/client_id。');
    return;
  }

  const state = Math.random().toString(36).slice(2);
  sessionStorage.setItem('baidu_oauth_state', state);

  const authUrl = 'https://openapi.baidu.com/oauth/2.0/authorize'
    + '?response_type=token'
    + '&client_id=' + encodeURIComponent(appKey)
    + '&redirect_uri=' + encodeURIComponent(BAIDU_REDIRECT_URI)
    + '&scope=' + encodeURIComponent('basic,netdisk')
    + '&display=page'
    + '&state=' + encodeURIComponent(state);

  console.log('即将跳转百度 OAuth：', authUrl);
  window.location.href = authUrl;
}

function baiduLogout(){
  clearBaiduAuth();
  updateSyncModalView();
  showToast('已退出百度网盘登录（如需彻底解除授权，请到百度网盘App的账号管理里操作）');
}

function syncLog(msg){
  const el = document.getElementById('syncLog');
  if(!el) return;
  el.style.display = 'block';
  el.textContent += (el.textContent ? '\n' : '') + msg;
  el.scrollTop = el.scrollHeight;
}
function syncLogClear(){
  const el = document.getElementById('syncLog');
  if(el){ el.style.display='none'; el.textContent=''; }
}

// 把当前数据打包成跟“导出备份”一样的JSON，上传到百度网盘固定路径（覆盖式同步，不做多版本管理）
async function syncUploadToBaidu(){
  if(!baiduAuth){ showToast('请先登录百度网盘'); return; }
  syncLogClear();
  syncLog('准备上传数据…');

  const payload = {
    app: 'garment-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    records
  };
  const jsonText = JSON.stringify(payload);
  const fileBytes = new TextEncoder().encode(jsonText);

  try{
    syncLog('第1步：申请上传（precreate）…');
    const precreateResp = await baiduApiCall('https://pan.baidu.com/rest/2.0/xpan/file', {
      method: 'precreate',
      extraParams: { path: BAIDU_SYNC_PATH, size: String(fileBytes.length), isdir: '0', autoinit: '1',
        block_list: JSON.stringify([md5Hex(fileBytes)]) }
    }, 'POST');

    if(precreateResp.errno !== 0){
      throw new Error('precreate失败，errno=' + precreateResp.errno + '（' + (precreateResp.errmsg||'未知错误') + '）');
    }
    const uploadId = precreateResp.uploadid;
    syncLog('已获得上传任务，开始上传文件内容…');

    syncLog('第2步：上传文件内容（superfile2）…');
    const form = new FormData();
    form.append('file', new Blob([fileBytes], {type:'application/json'}), 'sync-data.json');
    const uploadUrl = 'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2'
      + '?method=upload'
      + '&access_token=' + encodeURIComponent(baiduAuth.access_token)
      + '&path=' + encodeURIComponent(BAIDU_SYNC_PATH)
      + '&uploadid=' + encodeURIComponent(uploadId)
      + '&partseq=0';
    const uploadResp = await fetch(uploadUrl, { method:'POST', body: form });
    const uploadJson = await uploadResp.json();
    if(uploadJson.error_code){
      throw new Error('文件内容上传失败：' + JSON.stringify(uploadJson));
    }
    syncLog('文件内容上传完成。');

    syncLog('第3步：确认创建文件（create）…');
    const createResp = await baiduApiCall('https://pan.baidu.com/rest/2.0/xpan/file', {
      method: 'create',
      extraParams: { path: BAIDU_SYNC_PATH, size: String(fileBytes.length), isdir: '0',
        uploadid: uploadId, block_list: JSON.stringify([md5Hex(fileBytes)]), rtype: '3' }
    }, 'POST');
    if(createResp.errno !== 0){
      throw new Error('create失败，errno=' + createResp.errno + '（' + (createResp.errmsg||'未知错误') + '）');
    }

    localStorage.setItem(BAIDU_LAST_SYNC_KEY, String(Date.now()));
    syncLog('✓ 同步完成！数据已上传到网盘 ' + BAIDU_SYNC_PATH);
    updateSyncModalView();
    showToast('已同步到百度网盘');
  }catch(err){
    console.error('百度网盘同步上传失败', err);
    syncLog('✗ 同步失败：' + err.message);
    syncLog('（如果浏览器控制台显示 CORS / Cross-Origin 相关报错，说明百度的接口暂不支持网页直接访问，需要换个方案，请把这里的报错截图给我）');
    showToast('同步失败，详情见同步面板里的日志');
  }
}

// 从云端下载最新的同步文件，与本地数据合并（按id覆盖，逻辑跟“导入备份”一致）
async function syncDownloadFromBaidu(){
  if(!baiduAuth){ showToast('请先登录百度网盘'); return; }
  syncLogClear();
  syncLog('正在获取云端文件信息…');

  try{
    const metaResp = await baiduApiCall('https://pan.baidu.com/rest/2.0/xpan/multimedia', {
      method: 'filemetas',
      extraParams: { fsids: '', path: BAIDU_SYNC_PATH, dlink: '1' }
    }, 'GET');

    // 用filemanager的list接口获取该路径文件的dlink（不同版本接口字段略有差异，这里用list兜底）
    const listResp = await baiduApiCall('https://pan.baidu.com/rest/2.0/xpan/file', {
      method: 'list',
      extraParams: { dir: '/apps/裁档衣样图录' }
    }, 'GET');

    if(listResp.errno !== 0){
      throw new Error('获取云端文件列表失败，errno=' + listResp.errno + '（可能还没同步过，或者目录不存在）');
    }
    const fileEntry = (listResp.list||[]).find(f => f.path === BAIDU_SYNC_PATH);
    if(!fileEntry){
      throw new Error('云端还没有找到同步文件，请先在另一台设备上点一次"立即同步"');
    }

    syncLog('找到云端文件，开始下载内容…');
    const dlink = fileEntry.dlink + '&access_token=' + encodeURIComponent(baiduAuth.access_token);
    const fileResp = await fetch(dlink);
    if(!fileResp.ok){
      throw new Error('下载文件内容失败，HTTP状态码 ' + fileResp.status);
    }
    const data = await fileResp.json();
    if(!data.records || !Array.isArray(data.records)){
      throw new Error('云端文件格式不正确');
    }

    data.records.forEach(migrateRecordToMultiImage);
    let added = 0, updated = 0;
    data.records.forEach(incoming=>{
      const idx = records.findIndex(r=>r.id===incoming.id);
      if(idx >= 0){ records[idx] = incoming; updated++; }
      else { records.push(incoming); added++; }
    });
    saveRecords();
    renderList();
    renderData();

    localStorage.setItem(BAIDU_LAST_SYNC_KEY, String(Date.now()));
    syncLog(`✓ 拉取完成：新增 ${added} 条，更新 ${updated} 条`);
    updateSyncModalView();
    showToast('已从云端同步最新数据');
  }catch(err){
    console.error('百度网盘同步下载失败', err);
    syncLog('✗ 拉取失败：' + err.message);
    syncLog('（如果浏览器控制台显示 CORS / Cross-Origin 相关报错，说明百度的接口暂不支持网页直接访问，需要换个方案，请把这里的报错截图给我）');
    showToast('拉取失败，详情见同步面板里的日志');
  }
}

// 统一处理百度网盘接口调用（自动带上access_token，GET用query string，POST用x-www-form-urlencoded）
async function baiduApiCall(baseUrl, { method, extraParams }, httpMethod){
  const params = new URLSearchParams({
    method,
    access_token: baiduAuth.access_token,
    ...extraParams
  });
  let resp;
  if(httpMethod === 'GET'){
    resp = await fetch(baseUrl + '?' + params.toString());
  } else {
    resp = await fetch(baseUrl + '?method=' + method + '&access_token=' + encodeURIComponent(baiduAuth.access_token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: (()=>{ const p2 = new URLSearchParams(extraParams); return p2.toString(); })()
    });
  }
  return await resp.json();
}

// 百度上传接口要求提供文件内容真实的MD5（创建文件时会校验，传错会导致create失败），
// 但浏览器内置WebCrypto不支持MD5算法，所以这里用一份精简的纯JS MD5实现来算真实值。
function md5Hex(bytes){
  function toUtf8Bytes(){ return bytes; } // 已经是Uint8Array，直接用
  function safeAdd(x,y){ const lsw=(x&0xffff)+(y&0xffff); const msw=(x>>16)+(y>>16)+(lsw>>16); return (msw<<16)|(lsw&0xffff); }
  function bitRotateLeft(num,cnt){ return (num<<cnt)|(num>>>(32-cnt)); }
  function md5cmn(q,a,b,x,s,t){ return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b); }
  function md5ff(a,b,c,d,x,s,t){ return md5cmn((b&c)|((~b)&d),a,b,x,s,t); }
  function md5gg(a,b,c,d,x,s,t){ return md5cmn((b&d)|(c&(~d)),a,b,x,s,t); }
  function md5hh(a,b,c,d,x,s,t){ return md5cmn(b^c^d,a,b,x,s,t); }
  function md5ii(a,b,c,d,x,s,t){ return md5cmn(c^(b|(~d)),a,b,x,s,t); }

  function md5cycle(x, k){
    let a=x[0], b=x[1], c=x[2], d=x[3];
    a=md5ff(a,b,c,d,k[0],7,-680876936); d=md5ff(d,a,b,c,k[1],12,-389564586);
    c=md5ff(c,d,a,b,k[2],17,606105819); b=md5ff(b,c,d,a,k[3],22,-1044525330);
    a=md5ff(a,b,c,d,k[4],7,-176418897); d=md5ff(d,a,b,c,k[5],12,1200080426);
    c=md5ff(c,d,a,b,k[6],17,-1473231341); b=md5ff(b,c,d,a,k[7],22,-45705983);
    a=md5ff(a,b,c,d,k[8],7,1770035416); d=md5ff(d,a,b,c,k[9],12,-1958414417);
    c=md5ff(c,d,a,b,k[10],17,-42063); b=md5ff(b,c,d,a,k[11],22,-1990404162);
    a=md5ff(a,b,c,d,k[12],7,1804603682); d=md5ff(d,a,b,c,k[13],12,-40341101);
    c=md5ff(c,d,a,b,k[14],17,-1502002290); b=md5ff(b,c,d,a,k[15],22,1236535329);
    a=md5gg(a,b,c,d,k[1],5,-165796510); d=md5gg(d,a,b,c,k[6],9,-1069501632);
    c=md5gg(c,d,a,b,k[11],14,643717713); b=md5gg(b,c,d,a,k[0],20,-373897302);
    a=md5gg(a,b,c,d,k[5],5,-701558691); d=md5gg(d,a,b,c,k[10],9,38016083);
    c=md5gg(c,d,a,b,k[15],14,-660478335); b=md5gg(b,c,d,a,k[4],20,-405537848);
    a=md5gg(a,b,c,d,k[9],5,568446438); d=md5gg(d,a,b,c,k[14],9,-1019803690);
    c=md5gg(c,d,a,b,k[3],14,-187363961); b=md5gg(b,c,d,a,k[8],20,1163531501);
    a=md5gg(a,b,c,d,k[13],5,-1444681467); d=md5gg(d,a,b,c,k[2],9,-51403784);
    c=md5gg(c,d,a,b,k[7],14,1735328473); b=md5gg(b,c,d,a,k[12],20,-1926607734);
    a=md5hh(a,b,c,d,k[5],4,-378558); d=md5hh(d,a,b,c,k[8],11,-2022574463);
    c=md5hh(c,d,a,b,k[11],16,1839030562); b=md5hh(b,c,d,a,k[14],23,-35309556);
    a=md5hh(a,b,c,d,k[1],4,-1530992060); d=md5hh(d,a,b,c,k[4],11,1272893353);
    c=md5hh(c,d,a,b,k[7],16,-155497632); b=md5hh(b,c,d,a,k[10],23,-1094730640);
    a=md5hh(a,b,c,d,k[13],4,681279174); d=md5hh(d,a,b,c,k[0],11,-358537222);
    c=md5hh(c,d,a,b,k[3],16,-722521979); b=md5hh(b,c,d,a,k[6],23,76029189);
    a=md5hh(a,b,c,d,k[9],4,-640364487); d=md5hh(d,a,b,c,k[12],11,-421815835);
    c=md5hh(c,d,a,b,k[15],16,530742520); b=md5hh(b,c,d,a,k[2],23,-995338651);
    a=md5ii(a,b,c,d,k[0],6,-198630844); d=md5ii(d,a,b,c,k[7],10,1126891415);
    c=md5ii(c,d,a,b,k[14],15,-1416354905); b=md5ii(b,c,d,a,k[5],21,-57434055);
    a=md5ii(a,b,c,d,k[12],6,1700485571); d=md5ii(d,a,b,c,k[3],10,-1894986606);
    c=md5ii(c,d,a,b,k[10],15,-1051523); b=md5ii(b,c,d,a,k[1],21,-2054922799);
    a=md5ii(a,b,c,d,k[8],6,1873313359); d=md5ii(d,a,b,c,k[15],10,-30611744);
    c=md5ii(c,d,a,b,k[6],15,-1560198380); b=md5ii(b,c,d,a,k[13],21,1309151649);
    a=md5ii(a,b,c,d,k[4],6,-145523070); d=md5ii(d,a,b,c,k[11],10,-1120210379);
    c=md5ii(c,d,a,b,k[2],15,718787259); b=md5ii(b,c,d,a,k[9],21,-343485551);
    x[0]=safeAdd(a,x[0]); x[1]=safeAdd(b,x[1]); x[2]=safeAdd(c,x[2]); x[3]=safeAdd(d,x[3]);
  }

  function md5blk(s){
    const md5blks = [];
    for(let i=0;i<64;i+=4){
      md5blks[i>>2] = s[i] + (s[i+1]<<8) + (s[i+2]<<16) + (s[i+3]<<24);
    }
    return md5blks;
  }

  function rstr2hex(input){
    const hexChars = '0123456789abcdef';
    let output = '';
    for(let i=0;i<input.length;i++){
      const x = input.charCodeAt(i);
      output += hexChars.charAt((x>>4)&0x0F) + hexChars.charAt(x&0x0F);
    }
    return output;
  }

  function md51(s){
    const n = s.length;
    const state = [1732584193,-271733879,-1732584194,271733878];
    let i;
    for(i=64;i<=n;i+=64){ md5cycle(state, md5blk(s.slice(i-64,i))); }
    s = s.slice(i-64);
    const tail = new Array(16).fill(0);
    for(i=0;i<s.length;i++){ tail[i>>2] |= s[i] << ((i%4)<<3); }
    tail[i>>2] |= 0x80 << ((i%4)<<3);
    if(i > 55){
      md5cycle(state, tail);
      for(i=0;i<16;i++) tail[i]=0;
    }
    tail[14] = n*8;
    md5cycle(state, tail);
    return state;
  }

  // bytes 是 Uint8Array，转成普通数组方便按字节切片处理
  const arr = Array.from(bytes);
  const state = md51(arr);
  let out = '';
  for(let i=0;i<4;i++){
    out += String.fromCharCode(state[i]&0xff, (state[i]>>8)&0xff, (state[i]>>16)&0xff, (state[i]>>24)&0xff);
  }
  return rstr2hex(out);
}

function updateSyncModalView(){
  const loggedOutView = document.getElementById('syncLoggedOutView');
  const loggedInView = document.getElementById('syncLoggedInView');
  const syncDot = document.getElementById('syncDot');
  if(baiduAuth){
    loggedOutView.style.display = 'none';
    loggedInView.style.display = 'block';
    syncDot.style.display = 'block';
    const lastSync = localStorage.getItem(BAIDU_LAST_SYNC_KEY);
    document.getElementById('syncStatusText').textContent = lastSync
      ? '上次同步：' + new Date(parseInt(lastSync,10)).toLocaleString('zh-CN')
      : '尚未同步';
  } else {
    loggedOutView.style.display = 'block';
    loggedInView.style.display = 'none';
    syncDot.style.display = 'none';
  }
}

function openSyncModal(){
  updateSyncModalView();
  document.getElementById('syncModal').classList.add('show');
}
function closeSyncModal(){
  document.getElementById('syncModal').classList.remove('show');
}

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
  pendingImportData.forEach(migrateRecordToMultiImage);
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
   订单 PDF 生成与分享
   思路：先把订单信息+图片渲染成一段带样式的隐藏HTML（中文交给浏览器原生渲染，
   避免jsPDF默认字体不支持中文的问题），再用 html2canvas 把这段HTML拍成图片，
   按A4页面尺寸切片嵌入PDF，最后调用系统分享面板（用户在面板里选微信、选好友）。
   ========================================================= */

function buildPdfHtml(r){
  const statusText = r.archived ? '已结算' : (isPending(r) ? '待结算' : '已填结算信息');
  const statusColor = r.archived ? '#5B6478' : (isPending(r) ? '#C4432F' : '#5B6478');
  const statusBg = r.archived ? 'rgba(91,100,120,0.12)' : (isPending(r) ? 'rgba(196,67,47,0.12)' : 'rgba(91,100,120,0.12)');

  const fields = [
    ['归属人', r.owner || '—'],
    ['布料', r.fabric || '—'],
    ['收录日期', r.collectDate || '—'],
    ['制作日期', r.makeDate || '—'],
    ['结算日期', r.settleDate || '—'],
    ['结算金额', r.settleAmount ? String(r.settleAmount) : '—'],
  ];
  (r.customFields||[]).forEach(f=> fields.push([f.label || '自定义字段', f.value || '—']));

  const fieldsHtml = fields.map(([label,val])=>`
    <div style="display:flex; padding:9px 0; border-bottom:1px solid #E0D9C5;">
      <div style="width:96px; flex-shrink:0; color:#5B6478; font-size:13px;">${escapeHtml(label)}</div>
      <div style="flex:1; color:#2B3344; font-size:13px; font-weight:500;">${escapeHtml(String(val))}</div>
    </div>
  `).join('');

  const remarkHtml = r.remark ? `
    <div style="margin-top:16px;">
      <div style="color:#5B6478; font-size:12px; margin-bottom:5px;">备注</div>
      <div style="color:#2B3344; font-size:13px; line-height:1.65; white-space:pre-wrap;">${escapeHtml(r.remark)}</div>
    </div>` : '';

  const photoCount = (r.images||[]).length;
  const photoNoteHtml = photoCount ? `
    <div style="margin-top:18px; font-size:12px; color:#8B8678;">
      衣样照片共 ${photoCount} 张，附在本文档之后（每张单独一页，保留完整原图）。
    </div>` : '';

  return `
    <div style="font-family:'Noto Sans SC', sans-serif; color:#2B3344; width:100%; box-sizing:border-box;">
      <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:2px;">
        <span style="font-family:'Noto Serif SC', serif; font-weight:700; font-size:21px; color:#222B3E;">裁档 · 衣样图录</span>
        <span style="font-size:11px; color:#8B8678; letter-spacing:2px;">订单凭证</span>
      </div>
      <div style="height:1px; background:#D8CFB9; margin:12px 0 20px;"></div>

      <div style="display:flex; align-items:baseline; justify-content:space-between; margin-bottom:18px;">
        <h1 style="font-family:'Noto Serif SC', serif; font-size:27px; margin:0; color:#222B3E;">${escapeHtml(r.owner) || '未命名订单'}</h1>
        <span style="font-size:12px; font-weight:700; padding:5px 12px; border-radius:3px; background:${statusBg}; color:${statusColor}; white-space:nowrap;">${statusText}</span>
      </div>

      <div style="margin-bottom:8px;">${fieldsHtml}</div>
      ${remarkHtml}
      ${photoNoteHtml}

      <div style="margin-top:26px; padding-top:14px; border-top:1px solid #D8CFB9; font-size:10.5px; color:#A6A18F;">
        生成时间：${new Date().toLocaleString('zh-CN')}
      </div>
    </div>
  `;
}

// 读取一张base64图片的原始像素宽高（用于按真实比例把整张原图嵌入PDF页面，不裁切、不缩成小图）
function getImageNaturalSize(dataUrl){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=> resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = ()=> resolve({ width: 1, height: 1 }); // 容错：万一某张图损坏，不让整个PDF生成卡死
    img.src = dataUrl;
  });
}

function detectImageFormat(dataUrl){
  if(/^data:image\/png/i.test(dataUrl)) return 'PNG';
  if(/^data:image\/webp/i.test(dataUrl)) return 'WEBP';
  return 'JPEG'; // 手机拍照默认多为JPEG，兜底也用JPEG
}

async function shareRecordAsPdf(recordId){
  const r = records.find(x=>x.id===recordId);
  if(!r) return;

  const shareBtn = document.getElementById('shareBtn');
  const originalLabel = shareBtn ? shareBtn.innerHTML : '';
  if(shareBtn){
    shareBtn.disabled = true;
    shareBtn.innerHTML = '<span class="full-label">生成中…</span>';
  }

  const renderArea = document.createElement('div');
  renderArea.id = 'pdfRenderArea';
  renderArea.style.position = 'fixed';
  renderArea.style.left = '-9999px';
  renderArea.style.top = '0';
  renderArea.style.width = '700px';
  renderArea.style.background = '#F3EFE6';
  renderArea.style.padding = '32px';
  renderArea.style.boxSizing = 'border-box';
  renderArea.innerHTML = buildPdfHtml(r); // 此处只有文字字段，不含任何<img>，不会被压缩/裁切
  document.body.appendChild(renderArea);

  try{
    const canvas = await html2canvas(renderArea, { scale: 2, backgroundColor: '#F3EFE6', useCORS: true });

    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const imgWidthPt = pageWidth - margin*2;
    const pxPerPt = canvas.width / imgWidthPt; // 画布像素 与 PDF点 的比例（水平方向）
    const pageUsableHeightPt = pageHeight - margin*2;
    const pageUsableHeightPx = pageUsableHeightPt * pxPerPt;

    let sourceY = 0;
    let remainingPx = canvas.height;
    let firstPage = true;

    while(remainingPx > 0){
      const sliceHeightPx = Math.min(pageUsableHeightPx, remainingPx);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = sliceHeightPx;
      const ctx = sliceCanvas.getContext('2d');
      ctx.drawImage(canvas, 0, sourceY, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx);
      const sliceDataUrl = sliceCanvas.toDataURL('image/jpeg', 0.92);
      const sliceHeightPt = sliceHeightPx / pxPerPt;

      if(!firstPage) pdf.addPage();
      pdf.addImage(sliceDataUrl, 'JPEG', margin, margin, imgWidthPt, sliceHeightPt);

      sourceY += sliceHeightPx;
      remainingPx -= sliceHeightPx;
      firstPage = false;
    }

    // ---- 衣样照片：每张原图单独占一整页，按原始宽高比完整嵌入，绝不裁切、不缩成小缩略图 ----
    const images = r.images || [];
    for(let i=0; i<images.length; i++){
      const im = images[i];
      const dims = await getImageNaturalSize(im.dataUrl);

      pdf.addPage();

      const captionY = margin + 4;
      pdf.setFontSize(10);
      pdf.setTextColor(139, 134, 120);
      pdf.text(`衣样照片 ${i+1} / ${images.length}`, margin, captionY);

      const captionSpace = 18;
      const availW = pageWidth - margin*2;
      const availH = pageHeight - margin*2 - captionSpace;
      const ratio = dims.width / dims.height;

      let drawW = availW;
      let drawH = drawW / ratio;
      if(drawH > availH){
        drawH = availH;
        drawW = drawH * ratio;
      }
      const drawX = margin + (availW - drawW) / 2;
      const drawY = margin + captionSpace + (availH - drawH) / 2;

      const format = detectImageFormat(im.dataUrl);
      pdf.addImage(im.dataUrl, format, drawX, drawY, drawW, drawH);
    }

    const safeOwner = (r.owner || '未命名').replace(/[\\/:*?"<>|]/g,'').trim() || '未命名';
    const safeDate = (r.collectDate || '').replace(/-/g,'') || '';
    const fileName = `订单-${safeOwner}${safeDate?'-'+safeDate:''}.pdf`;
    const pdfBlob = pdf.output('blob');

    await sharePdfBlob(pdfBlob, fileName);

  }catch(err){
    console.error('生成PDF失败', err);
    showToast('生成PDF失败，请重试');
  }finally{
    renderArea.remove();
    if(shareBtn){
      shareBtn.disabled = false;
      shareBtn.innerHTML = originalLabel;
    }
  }
}

// 判断是否为手机/平板等移动设备。
// 桌面端浏览器调用系统分享面板时，微信桌面客户端常常"打开了但接不住文件"
// （它没有正确实现Windows的文件分享接收），表现为分享面板弹出、点了微信、
// 微信被唤起，但里面什么都没有——这是微信桌面端自身的问题，网页代码无法强制它接收。
// 所以桌面端直接跳过"系统分享"这一步，改成更可靠的"直接下载，让你自己手动拖进微信"。
function isMobileDevice(){
  const uaString = navigator.userAgent || '';
  if(/Android|iPhone|iPad|iPod/i.test(uaString)) return true;
  if(navigator.userAgentData && navigator.userAgentData.mobile === true) return true;
  return false;
}

async function sharePdfBlob(blob, fileName){
  const file = new File([blob], fileName, { type: 'application/pdf' });

  const canTrySystemShare = isMobileDevice() && navigator.canShare && navigator.canShare({ files: [file] });

  if(canTrySystemShare){
    try{
      await navigator.share({ files: [file], title: fileName });
      return;
    }catch(err){
      if(err && err.name === 'AbortError') return; // 用户自己取消了分享，不算错误
      console.warn('系统分享失败，改为直接下载', err);
    }
  }

  // 桌面端 / 不支持系统分享 / 分享失败时，直接下载到本机，用户可自行拖入微信、QQ等聊天窗口发送
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(isMobileDevice()
    ? '当前设备不支持直接分享，已改为下载PDF，可手动发送给微信好友'
    : 'PDF已下载到本机，请在微信/QQ聊天窗口里手动选择该文件发送');
}

/* =========================================================
   图片查看器 + 校准量尺
   ========================================================= */
const viewer = {
  recordId: null,
  imageId: null,           // 当前正在查看的具体图片id
  scale: 1,
  minScale: 0.1,
  maxScale: 8,
  tx: 0, ty: 0,           // 自然像素(0,0) 在 stage 坐标系中的位置
  naturalWidth: 0,
  naturalHeight: 0,
  isPanning: false,
  panStart: null,
  pinch: null,             // {startDist, startScale, midScreen}
};

function openImageViewer(recordId, imageId){
  const r = records.find(x=>x.id===recordId);
  if(!r || !r.images || !r.images.length) return;
  const targetImageId = imageId || r.images[0].id;
  loadImageIntoViewer(recordId, targetImageId);
  document.getElementById('viewerOverlay').classList.add('show');
}

function loadImageIntoViewer(recordId, imageId){
  const r = records.find(x=>x.id===recordId);
  if(!r) return;
  const im = findImage(r, imageId);
  if(!im) return;

  viewer.recordId = recordId;
  viewer.imageId = imageId;

  const img = document.getElementById('viewerImg');
  img.onload = ()=>{
    viewer.naturalWidth = img.naturalWidth;
    viewer.naturalHeight = img.naturalHeight;
    img.style.width = viewer.naturalWidth + 'px';
    img.style.height = viewer.naturalHeight + 'px';

    fitImageToStage();
  };
  img.src = im.dataUrl;

  document.getElementById('viewerTitle').textContent = (r.owner ? r.owner + ' · ' : '') + (r.fabric || '衣样大图');
  renderViewerThumbStrip(r);
}

function renderViewerThumbStrip(r){
  const strip = document.getElementById('viewerThumbStrip');
  if(!strip) return;
  if(!r.images || r.images.length <= 1){
    strip.innerHTML = '';
    strip.style.display = 'none';
    return;
  }
  strip.style.display = 'flex';
  strip.innerHTML = r.images.map(im=>`
    <button class="viewer-thumb ${im.id===viewer.imageId?'active':''}" data-thumb-image-id="${im.id}">
      <img src="${im.dataUrl}" alt="">
    </button>
  `).join('');
  strip.querySelectorAll('[data-thumb-image-id]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      loadImageIntoViewer(viewer.recordId, btn.dataset.thumbImageId);
    });
  });
}

function closeImageViewer(){
  document.getElementById('viewerOverlay').classList.remove('show');
  viewer.recordId = null;
  viewer.imageId = null;
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

  // ----- pan (mouse drag) -----
  stage.addEventListener('pointerdown', (e)=>{
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
}

function bindViewerControls(){
  document.getElementById('viewerClose').addEventListener('click', closeImageViewer);
  document.getElementById('viewerOverlay').addEventListener('click', (e)=>{
    if(e.target.id === 'viewerOverlay') closeImageViewer();
  });

  document.getElementById('zoomInBtn').addEventListener('click', ()=> zoomBy(1.25));
  document.getElementById('zoomOutBtn').addEventListener('click', ()=> zoomBy(1/1.25));
  document.getElementById('zoomResetBtn').addEventListener('click', fitImageToStage);

  initViewerInteractions();
}

/* ---------- wire up ---------- */
function init(){
  loadRecords();
  loadBaiduAuth();
  checkBaiduAuthRedirect();
  renderList();
  renderData();

  document.getElementById('searchInput').addEventListener('input', renderList);

  document.getElementById('addBtn').addEventListener('click', openAddModal);
  document.getElementById('closeAddModal').addEventListener('click', closeAddModal);
  document.getElementById('cancelAdd').addEventListener('click', closeAddModal);
  document.getElementById('confirmAdd').addEventListener('click', confirmAddRecord);

  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', (e)=>{ handleFileSelect(e.target.files); fileInput.value=''; });
  uploadZone.addEventListener('dragover', (e)=>{ e.preventDefault(); uploadZone.style.borderColor = 'var(--indigo)'; });
  uploadZone.addEventListener('dragleave', ()=>{ uploadZone.style.borderColor = ''; });
  uploadZone.addEventListener('drop', (e)=>{
    e.preventDefault();
    uploadZone.style.borderColor = '';
    if(e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
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

  // 百度网盘云同步
  document.getElementById('syncBtn').addEventListener('click', openSyncModal);
  document.getElementById('closeSyncModal').addEventListener('click', closeSyncModal);
  document.getElementById('baiduLoginBtn').addEventListener('click', startBaiduLogin);
  document.getElementById('baiduLogoutBtn').addEventListener('click', baiduLogout);
  document.getElementById('syncNowBtn').addEventListener('click', syncUploadToBaidu);
  document.getElementById('syncDownloadBtn').addEventListener('click', syncDownloadFromBaidu);

  // close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(ov=>{
    ov.addEventListener('click', (e)=>{
      if(e.target === ov) ov.classList.remove('show');
    });
  });

  bindViewerControls();
}

document.addEventListener('DOMContentLoaded', init);
