import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, addDoc, updateDoc, 
  query, onSnapshot, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBToAzkMoWVnWYIZnhdplJ50P6G9n6ZUtE",
  authDomain: "design-tracker-96d1e.firebaseapp.com",
  projectId: "design-tracker-96d1e",
  storageBucket: "design-tracker-96d1e.firebasestorage.app",
  messagingSenderId: "277352763092",
  appId: "1:277352763092:web:f4ebc36c496b81f498f541",
  measurementId: "G-WLKSM8JS99"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const roleNames = { admin: "系統管理員", top_manager: "高級主管", manager: "主管", assistant_manager: "副主管", staff: "人員" };
let currentUserData = { role: "staff", name: "" };
let allUsersList = [];

let viewingUserId = null; 
let allProjectsData = [];
let allAdHocData = [];
let allWeeklyData = [];
let currentFilter = 'ongoing'; 
let selectedProjectId = null;
let ganttInstance = null;

// === 介面切換 ===
window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active');
  document.getElementById('current-title').innerText = title;

  if (tabId === 'tab-projects') setTimeout(renderProjects, 100);
};

document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

window.toggleSubMenu = () => {
  document.getElementById('nav-sub-wrapper').classList.toggle('nav-menu-open');
};

function getWorkingDays(startDate, endDate) {
  let count = 0; let curDate = new Date(startDate); let end = new Date(endDate);
  curDate.setHours(0,0,0,0); end.setHours(0,0,0,0);
  while (curDate <= end) {
    if (curDate.getDay() !== 0 && curDate.getDay() !== 6) count++;
    curDate.setDate(curDate.getDate() + 1);
  }
  return count;
}

// === 登入監聽 ===
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";
    viewingUserId = user.uid;

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) currentUserData = userDoc.data();
      else {
        currentUserData = { name: user.email.split('@')[0], role: "admin" };
        await setDoc(doc(db, "users", user.uid), currentUserData, { merge: true });
      }
    } catch (e) {
      currentUserData = { name: user.email.split('@')[0], role: "admin" };
    }

    const displayName = currentUserData.name || user.email.split('@')[0];
    document.getElementById("user-display-name").innerText = displayName;
    document.getElementById("user-avatar").innerText = displayName.charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = roleNames[currentUserData.role] || (currentUserData.role || "STAFF").toUpperCase();

    if (currentUserData.role === "admin") {
      document.getElementById("nav-org-manage").style.display = "flex";
      document.getElementById("nav-divider-org").style.display = "block";
      loadOrgUsers();
    } else {
      document.getElementById("nav-org-manage").style.display = "none";
      document.getElementById("nav-divider-org").style.display = "none";
    }

    if (currentUserData.role !== 'staff') {
      document.getElementById('nav-sub-wrapper').style.display = 'block';
      loadSidebarSubordinates();
    } else {
      document.getElementById('nav-sub-wrapper').style.display = 'none';
    }

    addTaskRow(); 
    loadProjects();
    loadAdHocEvents();
    loadWeeklyReports();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

function loadSidebarSubordinates() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const list = document.getElementById("nav-sub-list");
    list.innerHTML = `<li class="nav-sub-item active" id="sub-li-${auth.currentUser.uid}" onclick="switchViewingUser('${auth.currentUser.uid}', '自己 (我的資料)')">我的資料</li>`;
    
    snapshot.forEach(docSnap => {
      const u = { uid: docSnap.id, ...docSnap.data() };
      if (u.uid === auth.currentUser.uid) return;
      
      const myRole = currentUserData.role;
      const targetRole = u.role;
      let canView = false;

      if (myRole === 'admin' || myRole === 'top_manager') canView = true;
      else if (myRole === 'manager' && (targetRole === 'assistant_manager' || targetRole === 'staff')) canView = true;
      else if (myRole === 'assistant_manager' && targetRole === 'staff') canView = true;

      if (canView || u.supervisorId === auth.currentUser.uid) {
        const roleLabel = roleNames[u.role] || '人員';
        list.innerHTML += `<li class="nav-sub-item" id="sub-li-${u.uid}" onclick="switchViewingUser('${u.uid}', '${u.name}')">${u.name} <small style="color:#64748b">(${roleLabel})</small></li>`;
      }
    });
  });
}

window.switchViewingUser = (uid, name) => {
  viewingUserId = uid;
  document.querySelectorAll('.nav-sub-item').forEach(el => el.classList.remove('active'));
  const targetLi = document.getElementById(`sub-li-${uid}`);
  if (targetLi) targetLi.classList.add('active');

  const isSelf = viewingUserId === auth.currentUser.uid;
  document.getElementById('viewing-user-name').innerText = isSelf ? '' : `[ 正在檢視：${name} ]`;
  
  document.getElementById('btn-create-wrapper').style.display = isSelf ? 'flex' : 'none';
  document.getElementById('create-project-section').style.display = 'none';
  document.getElementById('adhoc-form-panel').style.display = isSelf ? 'block' : 'none';
  document.getElementById('weekly-form-panel').style.display = isSelf ? 'block' : 'none';

  selectedProjectId = null;
  renderProjects();
  renderAdHocEvents();
  renderWeeklyReports();
};

document.getElementById("btn-login").addEventListener("click", () => {
  signInWithEmailAndPassword(auth, document.getElementById("login-email").value.trim(), document.getElementById("login-password").value.trim()).catch(e => alert(e.message));
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

function getNextWorkingDayStr(dateStr) {
  if (!dateStr) return '';
  let d = new Date(dateStr); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

window.checkWorkingDay = (input) => {
  if (!input.value) return;
  const d = new Date(input.value);
  if (d.getDay() === 0 || d.getDay() === 6) { alert("系統規定只能點選工作日喔！"); input.value = ''; }
};

window.addTaskRow = () => {
  const container = document.getElementById("task-list-container");
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = rows.length > 0 ? getNextWorkingDayStr(rows[rows.length - 1].querySelector('.task-end').value) : "";
  const div = document.createElement('div'); div.className = "form-row task-row"; div.style.marginBottom = "8px";
  div.innerHTML = `<div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="細項名稱"></div><div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="checkWorkingDay(this)"></div><div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-end" onchange="checkWorkingDay(this)"></div><div class="form-group" style="margin:0; max-width: 40px;"><button class="action-btn danger" onclick="this.parentElement.parentElement.remove()" style="padding: 10px;">X</button></div>`;
  container.appendChild(div);
};

window.setProjectFilter = (status) => {
  currentFilter = status;
  document.getElementById('filter-ongoing').classList.toggle('active', status === 'ongoing');
  document.getElementById('filter-completed').classList.toggle('active', status === 'completed');
  document.getElementById('filter-delayed').classList.toggle('active', status === 'delayed');
  selectedProjectId = null; renderProjects();
};

window.selectProject = (projId) => { selectedProjectId = projId; renderProjects(); };

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = [];
    snapshot.forEach(docSnap => allProjectsData.push({ id: docSnap.id, ...docSnap.data() }));
    renderProjects();
  });
}

function formatDateSafe(dateObj) {
  const y = dateObj.getFullYear(); const m = String(dateObj.getMonth() + 1).padStart(2, '0'); const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderProjects() {
  const userProjects = allProjectsData.filter(p => p.ownerId === viewingUserId);
  let countOngoing = 0, countCompleted = 0, countDelayed = 0;
  userProjects.forEach(p => {
    if (!p.tasks || p.tasks.length === 0) return;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
    if (isAllDone) countCompleted++; else countOngoing++;
    if (hasDelay) countDelayed++;
  });
  document.getElementById('stat-ongoing').innerText = countOngoing; document.getElementById('stat-completed').innerText = countCompleted; document.getElementById('stat-delay').innerText = countDelayed;

  const filteredProjects = userProjects.filter(p => {
    if (!p.tasks || p.tasks.length === 0) return false;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
    if (currentFilter === 'completed') return isAllDone;
    if (currentFilter === 'delayed') return hasDelay;
    return !isAllDone;
  });

  const tabsContainer = document.getElementById("project-tabs-container");
  const detailView = document.getElementById("project-detail-view");
  const emptyState = document.getElementById("empty-state");
  tabsContainer.innerHTML = "";

  if (filteredProjects.length === 0) { detailView.style.display = "none"; emptyState.style.display = "block"; return; }
  if (!selectedProjectId || !filteredProjects.find(p => p.id === selectedProjectId)) selectedProjectId = filteredProjects[0].id;

  filteredProjects.forEach(p => {
    const btn = document.createElement("button");
    btn.className = `proj-tab ${p.id === selectedProjectId ? 'active' : ''}`;
    btn.innerText = p.title; btn.onclick = () => selectProject(p.id); tabsContainer.appendChild(btn);
  });

  emptyState.style.display = "none"; detailView.style.display = "block";
  const activeProj = filteredProjects.find(p => p.id === selectedProjectId);
  document.getElementById("current-gantt-title").innerText = `專案：${activeProj.title}`;
  
  const lockBtn = document.getElementById("btn-toggle-lock");
  const delProjBtn = document.getElementById("btn-delete-project");
  
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    lockBtn.style.display = "inline-block";
    lockBtn.innerText = activeProj.isLocked ? "🔒 鎖定中 (解鎖供編輯)" : "🔓 已開放 (點擊鎖定)";
    lockBtn.className = activeProj.isLocked ? "action-btn" : "action-btn danger";
    delProjBtn.style.display = "inline-block";
  } else {
    lockBtn.style.display = "none"; delProjBtn.style.display = "none";
  }

  const isOwner = activeProj.ownerId === auth.currentUser.uid;
  const leftBody = document.getElementById("gantt-left-body");
  const listBody = document.getElementById("project-list-tbody");
  leftBody.innerHTML = ""; 
  if(listBody) listBody.innerHTML = "";
  
  const ganttTasks = [];
  let allHistoryLogs = [];

  activeProj.tasks.forEach((task, index) => {
    const currentProgress = task.progress || 0;
    const workDays = getWorkingDays(task.start, task.end);
    ganttTasks.push({ id: `t_${index}`, name: task.name, start: task.start, end: task.end, progress: currentProgress, custom_class: task.isCompleted ? 'bar-success' : '' });

    const isInputLocked = task.isCompleted || !isOwner; 
    const row = document.createElement("div"); row.className = "gantt-row";
    row.innerHTML = `
      <div class="col-name" title="${task.name}">${task.name}</div>
      <div class="col-date">${workDays} 天</div>
      <div class="col-prog"><input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isInputLocked ? 'disabled' : ''}> %</div>
      <div class="col-act"><button class="action-btn btn-sm" ${isInputLocked ? 'disabled' : ''} onclick="confirmProgress('${activeProj.id}', ${index}, '${task.end}')">${task.isCompleted ? '完成' : '確認'}</button></div>
    `;
    leftBody.appendChild(row);

    if (task.history && task.history.length > 0) {
      task.history.forEach(h => {
        allHistoryLogs.push({ taskName: task.name, ...h });
      });
    }
  });

  if (listBody) {
    allHistoryLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (allHistoryLogs.length === 0) {
      listBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">尚無任何更新紀錄</td></tr>`;
    } else {
      allHistoryLogs.forEach(h => {
        let note = h.type === 'create' ? '<span style="color:var(--text-muted)">(任務建立)</span>' : (h.type === 'complete' ? '<span style="color:var(--success)">(🎉 結案)</span>' : '');
        
        let remarkHtml = '-';
        if (h.type === 'complete' && h.delayReason) {
            remarkHtml = `<span class="pill pill-danger">Delay: ${h.delayReason}</span>`;
        } else if (h.remark) {
            remarkHtml = `<span style="color: var(--text-muted);">${h.remark}</span>`;
        }
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><span style="color:var(--primary); font-weight:600;">${h.timestamp}</span></td>
          <td><strong>${h.taskName}</strong></td>
          <td>${h.progress}% ${note}</td>
          <td>歷時 <b>${h.daysPassed}</b> 天</td>
          <td>${remarkHtml}</td>
        `;
        listBody.appendChild(tr);
      });
    }
  }

  if (ganttTasks.length > 0) {
    const chartContainer = document.getElementById("gantt-chart-container");
    chartContainer.className = activeProj.isLocked ? "gantt-right-panel locked-gantt" : "gantt-right-panel";
    chartContainer.innerHTML = '<div id="gantt-chart"></div>';
    
    setTimeout(() => {
      if (document.getElementById("tab-projects").style.display === "none") return;

      ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
        view_mode: 'Day', language: 'zh', header_height: 50, bar_height: 20, padding: 18,
        on_date_change: async (task, start, end) => {
          if (activeProj.isLocked) { alert("🔒 專案已鎖定！"); renderProjects(); return; }
          if (!isOwner) { alert("🔒 權限不足！"); renderProjects(); return; }
          const idx = parseInt(task.id.split('_')[1]);
          const dStart = new Date(start); const newStart = `${dStart.getFullYear()}-${String(dStart.getMonth()+1).padStart(2,'0')}-${String(dStart.getDate()).padStart(2,'0')}`;
          let dEnd = new Date(end); dEnd.setDate(dEnd.getDate() - 1);
          const newEnd = `${dEnd.getFullYear()}-${String(dEnd.getMonth()+1).padStart(2,'0')}-${String(dEnd.getDate()).padStart(2,'0')}`;
          const proj = allProjectsData.find(p => p.id === activeProj.id);
          proj.tasks[idx].start = newStart; proj.tasks[idx].end = newEnd;
          await updateDoc(doc(db, "projects", activeProj.id), { tasks: proj.tasks });
        }
      });
    }, 150); 
  }
}

// === 確認與寫入歷史進度 (加入日常備註) ===
window.confirmProgress = async (projId, taskIndex, plannedEnd) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  const inputElem = document.getElementById(`prog_input_${taskIndex}`);
  let newProg = parseInt(inputElem.value); 
  const oldProg = tasks[taskIndex].progress || 0;
  
  if (isNaN(newProg) || newProg < 0) newProg = 0; 
  if (newProg > 100) newProg = 100;

  if (newProg < oldProg) { alert(`錯誤：進度不能往回倒扣！目前已達成 ${oldProg}%。`); inputElem.value = oldProg; return; }

  const todayStr = new Date().toISOString().split('T')[0];
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });
  let passedDays = 0;
  if (todayStr >= tasks[taskIndex].start) {
    passedDays = getWorkingDays(tasks[taskIndex].start, todayStr);
  }

  let delayReason = tasks[taskIndex].delayReason || "";
  let currentRemark = "";
  
  if (newProg === 100) {
    if (todayStr > plannedEnd && !delayReason) {
      delayReason = prompt("⚠️ 此任務已超出預計完成日，請填寫 Delay 原因 (必填)：");
      if (!delayReason) { inputElem.value = oldProg; return alert("必須填寫原因才能完成！"); }
    } else {
      currentRemark = prompt("即將結案！可填寫結案備註 (選填)：") || "";
    }
    tasks[taskIndex].isCompleted = true; 
    tasks[taskIndex].completedAt = ts;
    tasks[taskIndex].delayReason = delayReason;
    alert("🎉 進度已達 100%！該任務已結案。");
  } else { 
    currentRemark = prompt("請輸入此次進度更新的備註事項 (選填)：") || "";
    tasks[taskIndex].isCompleted = false; 
    tasks[taskIndex].completedAt = null; 
  }

  tasks[taskIndex].progress = newProg;
  tasks[taskIndex].lastUpdatedAt = ts;

  if (!tasks[taskIndex].history) tasks[taskIndex].history = [];
  tasks[taskIndex].history.push({
    timestamp: ts,
    progress: newProg,
    type: newProg === 100 ? 'complete' : 'update',
    daysPassed: passedDays,
    remark: currentRemark,
    delayReason: delayReason || ""
  });

  await updateDoc(doc(db, "projects", projId), { tasks });
  if(newProg !== 100) alert(`進度已更新為 ${newProg}%`);
};

document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  if (!title) return alert("請填寫主專案名稱！");
  const taskRows = document.querySelectorAll('.task-row'); 
  const tasks = [];
  
  const todayStr = new Date().toISOString().split('T')[0];
  const ts = new Date().toLocaleString('zh-TW', { hour12: false });

  for (let row of taskRows) {
    const name = row.querySelector('.task-name').value.trim(); 
    const start = row.querySelector('.task-start').value; 
    const end = row.querySelector('.task-end').value;
    
    if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
    if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
    
    let passedDays = 0;
    if (todayStr >= start) passedDays = getWorkingDays(start, todayStr);

    tasks.push({ 
      name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "", lastUpdatedAt: ts,
      history: [{ timestamp: ts, progress: 0, type: 'create', daysPassed: passedDays, delayReason: '', remark: '專案建立' }]
    });
  }
  
  await addDoc(collection(db, "projects"), { title, ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email, isLocked: true, tasks: tasks, createdAt: serverTimestamp() });
  document.getElementById("proj-name").value = ""; document.getElementById("task-list-container").innerHTML = ""; addTaskRow(); document.getElementById('create-project-section').style.display = 'none'; alert("專案已建立！");
});
window.toggleCurrentProjectLock = async () => { await updateDoc(doc(db, "projects", selectedProjectId), { isLocked: !allProjectsData.find(p => p.id === selectedProjectId).isLocked }); };
window.deleteCurrentProject = async () => {
  if (!confirm("⚠️ 確定要永久刪除此專案嗎？")) return;
  await deleteDoc(doc(db, "projects", selectedProjectId)); alert("專案已刪除！"); selectedProjectId = null; renderProjects();
};

// === 以下不變 ===
function loadAdHocEvents() {
  onSnapshot(query(collection(db, "ad_hoc_events")), (snapshot) => {
    allAdHocData = []; snapshot.forEach(docSnap => allAdHocData.push({ id: docSnap.id, ...docSnap.data() })); renderAdHocEvents();
  });
}
function renderAdHocEvents() {
  const tbody = document.getElementById("adhoc-list-tbody"); tbody.innerHTML = "";
  const filtered = allAdHocData.filter(e => e.ownerId === viewingUserId);
  filtered.forEach(evt => {
    const tr = document.createElement("tr");
    let actionHtml = !evt.isCompleted && evt.ownerId === auth.currentUser.uid ? `<button class="action-btn" onclick="completeAdHoc('${evt.id}')">完成</button>` : '';
    if (currentUserData.role === 'admin' || currentUserData.role === 'top_manager') actionHtml += `<button class="action-btn danger" style="margin-left:4px;" onclick="deleteAdHoc('${evt.id}')">刪除</button>`;
    
    tr.innerHTML = `<td><strong>${evt.title}</strong></td><td>${evt.reason}</td><td>${evt.startDateTime}</td><td>${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td><td>${actionHtml || '-'}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim(); const reason = document.getElementById("adhoc-reason").value.trim();
  if (!title || !reason) return alert("請填寫完整！");
  await addDoc(collection(db, "ad_hoc_events"), { ownerId: auth.currentUser.uid, title, reason, startDateTime: new Date().toLocaleString(), isCompleted: false });
  document.getElementById("adhoc-title").value = ""; document.getElementById("adhoc-reason").value = ""; alert("事件登記完成！");
});
window.completeAdHoc = async (id) => { await updateDoc(doc(db, "ad_hoc_events", id), { isCompleted: true, completedAt: new Date().toLocaleString() }); };
window.deleteAdHoc = async (id) => { if(confirm("確定刪除此紀錄？")) await deleteDoc(doc(db, "ad_hoc_events", id)); };

function loadWeeklyReports() {
  onSnapshot(query(collection(db, "weekly_reports")), (snapshot) => {
    allWeeklyData = []; snapshot.forEach(docSnap => allWeeklyData.push({ id: docSnap.id, ...docSnap.data() })); renderWeeklyReports();
  });
}
function renderWeeklyReports() {
  const tbody = document.getElementById("weekly-list-tbody"); tbody.innerHTML = "";
  const filtered = allWeeklyData.filter(e => e.ownerId === viewingUserId);
  filtered.forEach(w => {
    const tr = document.createElement("tr");
    let delHtml = (currentUserData.role === 'admin' || currentUserData.role === 'top_manager') ? `<button class="action-btn danger" onclick="deleteWeekly('${w.id}')">刪除</button>` : '-';
    tr.innerHTML = `<td>${w.startDate} ~ ${w.endDate}</td><td style="white-space:pre-wrap;">${w.content}</td><td>${w.createdAt ? new Date(w.createdAt.toDate()).toLocaleString() : ''}</td><td>${delHtml}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  const start = document.getElementById("rep-start").value; const end = document.getElementById("rep-end").value; const content = document.getElementById("rep-content").value.trim();
  if (!start || !end || !content) return alert("請填寫完整！");
  await addDoc(collection(db, "weekly_reports"), { ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email, startDate: start, endDate: end, content, createdAt: serverTimestamp() });
  document.getElementById("rep-content").value = ""; alert("週報已送出！");
});
window.deleteWeekly = async (id) => { if(confirm("確定刪除此週報？")) await deleteDoc(doc(db, "weekly_reports", id)); };

function loadOrgUsers() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody"); const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; supervisorSelect.innerHTML = '<option value="">-- 無 --</option>'; allUsersList = [];
    snapshot.forEach(docSnap => {
      const u = docSnap.data(); allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) supervisorSelect.innerHTML += `<option value="${docSnap.id}">${u.name} (${roleNames[u.role] || u.role})</option>`;
    });
    allUsersList.forEach(u => {
      const supUser = allUsersList.find(x => x.uid === u.supervisorId); const tr = document.createElement("tr");
      tr.innerHTML = `<td><strong>${u.name || '未命名'}</strong></td><td>${u.email || '-'}</td><td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td><td>${supUser ? `${supUser.name}` : "-"}</td><td><button class="action-btn" onclick="openEditModal('${u.uid}')" style="margin-right:6px;">編輯</button>${u.uid !== auth.currentUser.uid ? `<button class="action-btn danger" onclick="deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}</td>`;
      tbody.appendChild(tr);
    });
  });
}
document.getElementById("btn-create-user").addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim(); const email = document.getElementById("new-user-email").value.trim(); const pass = document.getElementById("new-user-pass").value.trim();
  if (!name || !email || pass.length < 6) return alert("資料填寫不全或密碼太短！");
  try {
    const secApp = initializeApp(firebaseConfig, "Secondary"); const secAuth = getAuth(secApp);
    const userCred = await createUserWithEmailAndPassword(secAuth, email, pass); await signOut(secAuth);
    await setDoc(doc(db, "users", userCred.user.uid), { name, email, role: document.getElementById("new-user-role").value, supervisorId: document.getElementById("new-user-supervisor").value || null, createdAt: serverTimestamp() });
    alert(`人員 ${name} 建立成功！`);
  } catch (err) { alert("建立失敗: " + err.message); }
});
window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  document.getElementById("edit-user-uid").value = u.uid; document.getElementById("edit-user-name").value = u.name || ''; document.getElementById("edit-user-role").value = u.role || 'staff';
  const supSelect = document.getElementById("edit-user-supervisor"); supSelect.innerHTML = '<option value="">-- 無 --</option>';
  allUsersList.forEach(user => { if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) supSelect.innerHTML += `<option value="${user.uid}">${user.name}</option>`; });
  supSelect.value = u.supervisorId || ''; document.getElementById("edit-user-modal").classList.add("active");
};
window.closeEditModal = () => document.getElementById("edit-user-modal").classList.remove("active");
window.submitEditUser = async () => {
  try {
    await updateDoc(doc(db, "users", document.getElementById("edit-user-uid").value), { name: document.getElementById("edit-user-name").value.trim(), role: document.getElementById("edit-user-role").value, supervisorId: document.getElementById("edit-user-supervisor").value || null });
    closeEditModal(); alert("人員資訊更新成功！");
  } catch (err) { alert("更新失敗: " + err.message); }
};
window.deleteUserDoc = async (uid, name) => { if (confirm(`確定刪除 ${name} 嗎？`)) { try { await deleteDoc(doc(db, "users", uid)); alert(`已移除 ${name}！`); } catch (err) { alert("刪除失敗: " + err.message); } } };
