import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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

let currentUserData = { role: "admin", name: "Ryan" };

// 更新頂部系統時間
function updateSystemTime() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeEl = document.getElementById("live-time");
  if (timeEl) timeEl.innerText = `${dateStr}`;
}
updateSystemTime();

// 分頁切換
window.switchNav = (tabId, title, elem) => {
  document.querySelectorAll('.tab-pane').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).style.display = 'block';
  elem.classList.add('active');
  document.getElementById('current-title').innerText = title;
};

// 登入狀態監聽（強化防護：登入必定秒切介面）
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // 1. 先切換 DOM 顯示
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "flex";

    // 2. 非同步載入使用者角色，防止 Firestore 卡住
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
      } else {
        currentUserData = { name: user.email.split('@')[0], role: "admin" };
      }
    } catch (err) {
      console.warn("Firestore 讀取跳過，使用安全預設身分", err);
      currentUserData = { name: user.email.split('@')[0], role: "admin" };
    }

    const displayName = currentUserData.name || user.email.split('@')[0];
    document.getElementById("user-display-name").innerText = displayName;
    document.getElementById("user-avatar").innerText = displayName.charAt(0).toUpperCase();
    document.getElementById("user-role-badge").innerText = (currentUserData.role || "ADMIN").toUpperCase();

    loadProjects();
    loadAdHocEvents();
  } else {
    document.getElementById("auth-section").style.display = "flex";
    document.getElementById("app-section").style.display = "none";
  }
});

// 登入動作
document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value.trim();
  if (!email || !pass) return alert("請輸入信箱與密碼！");

  signInWithEmailAndPassword(auth, email, pass).catch(err => {
    alert("登入失敗: " + err.message);
  });
});

// 登出動作
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

// 讀取與渲染專案進度
function loadProjects() {
  let q;
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    q = query(collection(db, "projects"));
  } else {
    q = query(collection(db, "projects"), where("ownerId", "==", auth.currentUser.uid));
  }

  onSnapshot(q, (snapshot) => {
    const tbody = document.getElementById("project-list-tbody");
    tbody.innerHTML = "";
    const ganttTasks = [];

    let ongoingCount = 0;
    let completedCount = 0;
    let delayCount = 0;

    snapshot.forEach(docSnap => {
      const proj = docSnap.data();
      const pId = docSnap.id;
      const task = proj.tasks ? proj.tasks[0] : null;
      if (!task) return;

      if (task.isCompleted) {
        completedCount++;
        if (task.delayReason) delayCount++;
      } else {
        ongoingCount++;
      }

      ganttTasks.push({
        id: pId,
        name: `${proj.title} - ${task.name}`,
        start: task.start,
        end: task.end,
        progress: task.isCompleted ? 100 : 0
      });

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${proj.title}</strong><br><small style="color:var(--text-muted)">${task.name}</small></td>
        <td>${proj.ownerName || '未指定'}</td>
        <td>${task.start} 至 ${task.end}</td>
        <td>${task.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">進行中</span>'}</td>
        <td>
          ${task.completedAt ? `<small>${task.completedAt}</small><br>` : ''}
          ${task.delayReason ? `<span class="pill pill-danger">Delay: ${task.delayReason}</span>` : '-'}
        </td>
        <td>
          ${!task.isCompleted ? `<button class="action-btn" onclick="completeTask('${pId}', '${task.end}')">完成任務</button>` : '<span style="color:#94a3b8;">已結案</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.getElementById("stat-ongoing").innerText = ongoingCount;
    document.getElementById("stat-completed").innerText = completedCount;
    document.getElementById("stat-delay").innerText = delayCount;

    if (ganttTasks.length > 0) {
      document.getElementById("gantt-chart").innerHTML = "";
      new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day', language: 'zh' });
    }
  });
}

// 建立專案
document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value.trim();
  const taskName = document.getElementById("task-name").value.trim();
  const start = document.getElementById("task-start").value;
  const end = document.getElementById("task-end").value;

  if (!title || !taskName || !start || !end) return alert("請完整填寫所有欄位！");

  await addDoc(collection(db, "projects"), {
    title,
    ownerId: auth.currentUser.uid,
    ownerName: currentUserData.name || auth.currentUser.email,
    isLocked: true,
    tasks: [{
      id: "t_1",
      name: taskName,
      start,
      end,
      isCompleted: false,
      completedAt: null,
      delayReason: ""
    }],
    createdAt: serverTimestamp()
  });

  document.getElementById("proj-name").value = "";
  document.getElementById("task-name").value = "";
  alert("專案已成功建立並鎖定！");
});

// 完成任務
window.completeTask = async (projId, plannedEnd) => {
  const today = new Date().toISOString().split('T')[0];
  let delayReason = "";

  if (today > plannedEnd) {
    delayReason = prompt("此任務已超出預計完成日，請填寫 Delay 原因：");
    if (!delayReason) return alert("必須填寫原因才能完成！");
  }

  const projRef = doc(db, "projects", projId);
  const projSnap = await getDoc(projRef);
  const tasks = projSnap.data().tasks;
  tasks[0].isCompleted = true;
  tasks[0].completedAt = new Date().toLocaleString();
  tasks[0].delayReason = delayReason;

  await updateDoc(projRef, { tasks });
};

// 登記插單事件
document.getElementById("btn-add-adhoc").addEventListener("click", async () => {
  const title = document.getElementById("adhoc-title").value.trim();
  const reason = document.getElementById("adhoc-reason").value.trim();
  if (!title || !reason) return alert("請完整填寫事項與原因！");

  await addDoc(collection(db, "ad_hoc_events"), {
    ownerId: auth.currentUser.uid,
    ownerName: currentUserData.name || auth.currentUser.email,
    title,
    reason,
    startDateTime: new Date().toLocaleString(),
    isCompleted: false,
    completedAt: null,
    createdAt: serverTimestamp()
  });

  document.getElementById("adhoc-title").value = "";
  document.getElementById("adhoc-reason").value = "";
  alert("臨時事件已登記！");
});

// 監聽臨時事件
function loadAdHocEvents() {
  const q = query(collection(db, "ad_hoc_events"));
  onSnapshot(q, (snapshot) => {
    const tbody = document.getElementById("adhoc-list-tbody");
    tbody.innerHTML = "";
    snapshot.forEach(docSnap => {
      const evt = docSnap.data();
      const id = docSnap.id;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${evt.title}</strong></td>
        <td>${evt.reason}</td>
        <td>${evt.startDateTime}</td>
        <td>${evt.isCompleted ? '<span class="pill pill-success">已完成</span>' : '<span class="pill pill-warning">處理中</span>'}</td>
        <td>
          ${!evt.isCompleted ? `<button class="action-btn" onclick="completeAdHoc('${id}')">點選完成</button>` : '<span style="color:#94a3b8;">已結案</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

// 結案臨時事件
window.completeAdHoc = async (id) => {
  await updateDoc(doc(db, "ad_hoc_events", id), {
    isCompleted: true,
    completedAt: new Date().toLocaleString()
  });
};

// 週報送出
document.getElementById("btn-add-weekly").addEventListener("click", async () => {
  const start = document.getElementById("rep-start").value;
  const end = document.getElementById("rep-end").value;
  const content = document.getElementById("rep-content").value.trim();

  if (!start || !end || !content) return alert("請完整填寫週報內容！");

  await addDoc(collection(db, "weekly_reports"), {
    ownerId: auth.currentUser.uid,
    ownerName: currentUserData.name || auth.currentUser.email,
    startDate: start,
    endDate: end,
    content,
    createdAt: serverTimestamp()
  });

  document.getElementById("rep-content").value = "";
  alert("週報已送出！");
});
