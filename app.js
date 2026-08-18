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

window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  if (elem) elem.classList.add('active');
  document.getElementById('current-title').innerText = title;
};

document.getElementById('btn-toggle-create').addEventListener('click', () => {
  const form = document.getElementById('create-project-section');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";

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

    addTaskRow(); 
    loadProjects();
    loadAdHocEvents();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  if (!email || !pass) return alert("請輸入信箱與密碼！");
  signInWithEmailAndPassword(auth, email, pass).catch(err => alert("登入失敗: " + err.message));
});
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));
document.getElementById("btn-update-password").addEventListener("click", async () => {
  const newPass = document.getElementById("profile-new-pass").value;
  const confirmPass = document.getElementById("profile-confirm-pass").value;
  if (!newPass || newPass.length < 6) return alert("新密碼長度至少需 6 碼！");
  if (newPass !== confirmPass) return alert("兩次輸入的新密碼不一致！");
  try {
    await updatePassword(auth.currentUser, newPass);
    alert("密碼變更成功！請妥善保存。");
    document.getElementById("profile-new-pass").value = "";
    document.getElementById("profile-confirm-pass").value = "";
  } catch (err) { alert("密碼更新失敗: " + err.message); }
});

function getNextWorkingDay(dateStr) {
  if (!dateStr) return '';
  let d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

window.checkWorkingDay = (input) => {
  if (!input.value) return;
  const d = new Date(input.value);
  if (d.getDay() === 0 || d.getDay() === 6) {
    alert("系統規定僅能選擇工作日 (週一至週五)！");
    input.value = '';
  }
};

window.addTaskRow = () => {
  const container = document.getElementById("task-list-container");
  const rows = container.querySelectorAll('.task-row');
  let defaultStart = "";
  if (rows.length > 0) {
    const lastEnd = rows[rows.length - 1].querySelector('.task-end').value;
    defaultStart = getNextWorkingDay(lastEnd);
  }
  const div = document.createElement('div');
  div.className = "form-row task-row"; div.style.marginBottom = "8px";
  div.innerHTML = `
    <div class="form-group" style="margin:0; flex:2;"><input type="text" class="input-control task-name" placeholder="任務細項名稱"></div>
    <div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-start" value="${defaultStart}" onchange="checkWorkingDay(this)"></div>
    <div class="form-group" style="margin:0; flex:1;"><input type="date" class="input-control task-end" onchange="checkWorkingDay(this)"></div>
    <div class="form-group" style="margin:0; max-width: 40px;"><button class="action-btn danger" onclick="this.parentElement.parentElement.remove()" style="padding: 10px;">X</button></div>
  `;
  container.appendChild(div);
};

// === 專案渲染與甘特圖聯動 ===
let allProjectsData = [];
let currentFilter = 'ongoing'; 
let selectedProjectId = null;
let ganttInstance = null;

window.setProjectFilter = (status) => {
  currentFilter = status;
  document.getElementById('filter-ongoing').classList.toggle('active', status === 'ongoing');
  document.getElementById('filter-completed').classList.toggle('active', status === 'completed');
  document.getElementById('filter-delayed').classList.toggle('active', status === 'delayed');
  selectedProjectId = null;
  renderProjects();
};

window.selectProject = (projId) => {
  selectedProjectId = projId;
  renderProjects();
};

function loadProjects() {
  onSnapshot(query(collection(db, "projects")), (snapshot) => {
    allProjectsData = [];
    snapshot.forEach(docSnap => {
      const proj = { id: docSnap.id, ...docSnap.data() };
      if (currentUserData.role === "staff" && proj.ownerId !== auth.currentUser.uid) return;
      allProjectsData.push(proj);
    });
    
    let countOngoing = 0, countCompleted = 0, countDelayed = 0;
    allProjectsData.forEach(p => {
      if (!p.tasks || p.tasks.length === 0) return;
      const isAllDone = p.tasks.every(t => t.isCompleted);
      const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
      if (isAllDone) countCompleted++; else countOngoing++;
      if (hasDelay) countDelayed++;
    });

    document.getElementById('stat-ongoing').innerText = countOngoing;
    document.getElementById('stat-completed').innerText = countCompleted;
    document.getElementById('stat-delay').innerText = countDelayed;

    renderProjects();
  });
}

function formatDateSafe(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function renderProjects() {
  const tabsContainer = document.getElementById("project-tabs-container");
  const detailView = document.getElementById("project-detail-view");
  const emptyState = document.getElementById("empty-state");
  tabsContainer.innerHTML = "";

  const filteredProjects = allProjectsData.filter(p => {
    if (!p.tasks || p.tasks.length === 0) return false;
    const isAllDone = p.tasks.every(t => t.isCompleted);
    const hasDelay = p.tasks.some(t => t.delayReason || (!t.isCompleted && new Date() > new Date(t.end)));
    if (currentFilter === 'completed') return isAllDone;
    if (currentFilter === 'delayed') return hasDelay;
    return !isAllDone;
  });

  if (filteredProjects.length === 0) {
    detailView.style.display = "none";
    emptyState.style.display = "block";
    return;
  }

  if (!selectedProjectId || !filteredProjects.find(p => p.id === selectedProjectId)) {
    selectedProjectId = filteredProjects[0].id;
  }

  filteredProjects.forEach(p => {
    const btn = document.createElement("button");
    btn.className = `proj-tab ${p.id === selectedProjectId ? 'active' : ''}`;
    btn.innerText = p.title;
    btn.onclick = () => selectProject(p.id);
    tabsContainer.appendChild(btn);
  });

  emptyState.style.display = "none";
  detailView.style.display = "block";

  const activeProj = filteredProjects.find(p => p.id === selectedProjectId);
  document.getElementById("current-gantt-title").innerText = `專案：${activeProj.title}`;
  
  const lockBtn = document.getElementById("btn-toggle-lock");
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    lockBtn.style.display = "inline-block";
    lockBtn.innerText = activeProj.isLocked ? "🔒 鎖定中 (點擊解鎖編輯時間)" : "🔓 已開放編輯 (點擊鎖定)";
    lockBtn.className = activeProj.isLocked ? "action-btn" : "action-btn danger";
  } else {
    lockBtn.style.display = "none";
  }

  // 渲染左側對齊面板
  const leftBody = document.getElementById("gantt-left-body");
  leftBody.innerHTML = "";
  const ganttTasks = [];

  activeProj.tasks.forEach((task, index) => {
    const currentProgress = task.progress || 0;
    
    ganttTasks.push({
      id: `t_${index}`, name: task.name, start: task.start, end: task.end, 
      progress: currentProgress, custom_class: task.isCompleted ? 'bar-success' : ''
    });

    const isLockedUI = task.isCompleted; // 100% 結案鎖定
    const row = document.createElement("div");
    row.className = "gantt-row";
    row.innerHTML = `
      <div class="col-name" title="${task.name}">${task.name}</div>
      <div class="col-date">${task.start.substring(5)} ~ ${task.end.substring(5)}</div>
      <div class="col-prog">
        <input type="number" min="0" max="100" value="${currentProgress}" id="prog_input_${index}" ${isLockedUI ? 'disabled' : ''}> %
      </div>
      <div class="col-act">
        <button class="action-btn" ${isLockedUI ? 'disabled' : ''} onclick="confirmProgress('${activeProj.id}', ${index}, '${task.end}')">
          ${isLockedUI ? '已結案' : '確認'}
        </button>
      </div>
    `;
    leftBody.appendChild(row);
  });

  // 渲染右側 SVG 甘特圖
  if (ganttTasks.length > 0) {
    const chartContainer = document.getElementById("gantt-chart-container");
    const chartDiv = document.getElementById("gantt-chart");
    
    // 如果主管設為鎖定，容器套用防拖曳 CSS
    chartContainer.className = activeProj.isLocked ? "gantt-right-panel locked-gantt" : "gantt-right-panel";
    chartDiv.innerHTML = "";
    
    // 強制等待 DOM 重繪以取得正確寬度，避免 SVG 消失
    setTimeout(() => {
      ganttInstance = new Gantt("#gantt-chart", ganttTasks, { 
        view_mode: 'Day', 
        language: 'zh',
        header_height: 50,
        bar_height: 20,
        padding: 18,
        on_date_change: async (task, start, end) => {
          if (activeProj.isLocked) {
            alert("🔒 專案鎖定中！必須由最高主管解鎖後才能拖曳修改時間。");
            renderProjects(); 
            return;
          }

          const idx = parseInt(task.id.split('_')[1]);
          const newStart = formatDateSafe(start);
          let dEnd = new Date(end);
          dEnd.setDate(dEnd.getDate() - 1);
          const newEnd = formatDateSafe(dEnd);
          
          const proj = allProjectsData.find(p => p.id === activeProj.id);
          proj.tasks[idx].start = newStart;
          proj.tasks[idx].end = newEnd;

          try { await updateDoc(doc(db, "projects", activeProj.id), { tasks: proj.tasks }); } 
          catch (err) { alert("更新失敗：" + err.message); }
        }
      });
    }, 50);
  }
}

// 提交進度更新
window.confirmProgress = async (projId, taskIndex, plannedEnd) => {
  const proj = allProjectsData.find(p => p.id === projId);
  const tasks = [...proj.tasks];
  
  const inputElem = document.getElementById(`prog_input_${taskIndex}`);
  let newProg = parseInt(inputElem.value);

  if (isNaN(newProg) || newProg < 0) newProg = 0;
  if (newProg > 100) newProg = 100;

  // Delay 檢查邏輯
  let delayReason = tasks[taskIndex].delayReason || "";
  if (newProg === 100) {
    const today = new Date().toISOString().split('T')[0];
    if (today > plannedEnd && !delayReason) {
      delayReason = prompt("此任務已超出預計完成日，請填寫 Delay 原因：");
      if (!delayReason) return alert("必須填寫原因才能完成！");
    }
    tasks[taskIndex].isCompleted = true;
    tasks[taskIndex].completedAt = new Date().toLocaleString();
    tasks[taskIndex].delayReason = delayReason;
    alert("🎉 進度 100% 確認！該任務已永久鎖定並結案。");
  } else {
    tasks[taskIndex].isCompleted = false;
    tasks[taskIndex].completedAt = null;
    alert(`進度已更新為 ${newProg}%`);
  }

  tasks[taskIndex].progress = newProg;
  await updateDoc(doc(db, "projects", projId), { tasks });
};


document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  if (!title) return alert("請填寫主專案名稱！");

  const taskRows = document.querySelectorAll('.task-row');
  const tasks = [];
  
  for (let row of taskRows) {
    const name = row.querySelector('.task-name').value.trim();
    const start = row.querySelector('.task-start').value;
    const end = row.querySelector('.task-end').value;
    if (!name || !start || !end) return alert("任務細項不可有空白欄位！");
    if (start > end) return alert(`任務 [${name}] 的起始日不可大於完成日！`);
    
    tasks.push({ name, start, end, progress: 0, isCompleted: false, completedAt: null, delayReason: "" });
  }

  if (tasks.length === 0) return alert("請至少新增一筆任務細項！");

  await addDoc(collection(db, "projects"), {
    title, ownerId: auth.currentUser.uid, ownerName: currentUserData.name || auth.currentUser.email,
    ownerRole: currentUserData.role || "staff", isLocked: true,
    tasks: tasks, createdAt: serverTimestamp()
  });

  document.getElementById("proj-name").value = "";
  document.getElementById("task-list-container").innerHTML = "";
  addTaskRow(); 
  document.getElementById('create-project-section').style.display = 'none';
  alert("專案已成功建立並鎖定！");
});

window.toggleCurrentProjectLock = async () => {
  if (!selectedProjectId) return;
  const proj = allProjectsData.find(p => p.id === selectedProjectId);
  await updateDoc(doc(db, "projects", proj.id), { isLocked: !proj.isLocked });
};

/* ================= 組織、事件、週報 (維持不變) ================= */
function loadOrgUsers() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    const tbody = document.getElementById("user-list-tbody");
    const supervisorSelect = document.getElementById("new-user-supervisor");
    tbody.innerHTML = ""; supervisorSelect.innerHTML = '<option value="">-- 無 --</option>';
    allUsersList = [];
    snapshot.forEach(docSnap => {
      const u = docSnap.data();
      allUsersList.push({ uid: docSnap.id, ...u });
      if (["top_manager", "manager", "assistant_manager"].includes(u.role)) {
        supervisorSelect.innerHTML += `<option value="${docSnap.id}">${u.name} (${roleNames[u.role] || u.role})</option>`;
      }
    });
    allUsersList.forEach(u => {
      const supUser = allUsersList.find(x => x.uid === u.supervisorId);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${u.name || '未命名'}</strong></td><td>${u.email || '-'}</td>
        <td><span class="pill pill-role">${roleNames[u.role] || u.role}</span></td>
        <td>${supUser ? `${supUser.name}` : "-"}</td>
        <td>
          <button class="action-btn" onclick="openEditModal('${u.uid}')" style="margin-right:6px;">編輯</button>
          ${u.uid !== auth.currentUser.uid ? `<button class="action-btn danger" onclick="deleteUserDoc('${u.uid}', '${u.name}')">刪除</button>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

document.getElementById("btn-create-user").addEventListener("click", async () => {
  const name = document.getElementById("new-user-name").value.trim();
  const email = document.getElementById("new-user-email").value.trim();
  const pass = document.getElementById("new-user-pass").value.trim();
  if (!name || !email || pass.length < 6) return alert("資料填寫不全或密碼太短！");
  try {
    const secApp = initializeApp(firebaseConfig, "Secondary");
    const secAuth = getAuth(secApp);
    const userCred = await createUserWithEmailAndPassword(secAuth, email, pass);
    await signOut(secAuth);
    await setDoc(doc(db, "users", userCred.user.uid), {
      name, email, role: document.getElementById("new-user-role").value,
      supervisorId: document.getElementById("new-user-supervisor").value || null,
      createdAt: serverTimestamp()
    });
    alert(`人員 ${name} 建立成功！`);
  } catch (err) { alert("建立失敗: " + err.message); }
});

window.openEditModal = (uid) => {
  const u = allUsersList.find(x => x.uid === uid);
  document.getElementById("edit-user-uid").value = u.uid;
  document.getElementById("edit-user-name").value = u.name || '';
  document.getElementById("edit-user-role").value = u.role || 'staff';
  const supSelect = document.getElementById("edit-user-supervisor");
  supSelect.innerHTML = '<option value="">-- 無 --</option>';
  allUsersList.forEach(user => {
    if (user.uid !== uid && ["top_manager", "manager", "assistant_manager"].includes(user.role)) {
      supSelect.innerHTML += `<option value="${user.uid}">${user.name}</option>`;
    }
  });
  supSelect.value = u.supervisorId || '';
  document.getElementById("edit-user-modal").classList.add("active");
};

window.closeEditModal = () => document.getElementById("edit-user-modal").classList.remove("active");

window.submitEditUser = async () => {
  try {
    await updateDoc(doc(db, "users", document.getElementById("edit-user-uid").value), {
      name: document.getElementById("edit-user-name").value.trim(),
      role: document.getElementById("edit-user-role").value,
      supervisorId: document.getElementById("edit-user-supervisor").value || null
    });
    closeEditModal(); alert("人員資訊更新成功！");
  } catch (err) { alert("更新失敗: " + err.message); }
};

window.deleteUserDoc = async (uid, name) => {
  if (confirm(`確定刪除 ${name} 嗎？`)) {
    try { await deleteDoc(doc(db, "users", uid)); alert(`已移除 ${name}！`); } catch (err) { alert("刪除失敗: " + err.message); }
  }
};
