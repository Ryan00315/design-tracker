import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, updateDoc, query, where, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// 請替換為您在 Firebase 複製的設定
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

let currentUserData = null;

// 切換分頁
window.switchTab = (tabId) => {
  document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
  document.getElementById(tabId).style.display = 'block';
};

// 1. 監聽登入狀態與抓取角色資料
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    currentUserData = userDoc.exists() ? userDoc.data() : { role: "designer", name: user.email };
    document.getElementById("user-info").innerText = `${currentUserData.name} (${currentUserData.role})`;
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("app-section").style.display = "block";
    loadProjects();
  } else {
    document.getElementById("auth-section").style.display = "block";
    document.getElementById("app-section").style.display = "none";
  }
});

// 登入按鈕事件：完全由使用者在畫面上輸入，不寫死任何帳號密碼
document.getElementById("btn-login").addEventListener("click", () => {
  const email = document.getElementById("login-email").value;
  const pass = document.getElementById("login-password").value;
  
  signInWithEmailAndPassword(auth, email, pass)
    .then(() => {
      alert("登入成功！");
    })
    .catch(err => alert("登入失敗: " + err.message));
});

// 登出事件
document.getElementById("btn-logout").addEventListener("click", () => signOut(auth));

// 2. 新增並鎖定專案
document.getElementById("btn-add-project").addEventListener("click", async () => {
  const title = document.getElementById("proj-name").value;
  const taskName = document.getElementById("task-name").value;
  const start = document.getElementById("task-start").value;
  const end = document.getElementById("task-end").value;

  if (!title || !taskName || !start || !end) return alert("請填妥欄位");

  await addDoc(collection(db, "projects"), {
    title,
    ownerId: auth.currentUser.uid,
    ownerName: currentUserData.name,
    isLocked: true,
    tasks: [{
      id: "task_1",
      name: taskName,
      start,
      end,
      isCompleted: false,
      completedAt: null,
      delayReason: ""
    }],
    createdAt: serverTimestamp()
  });
  alert("專案已建立並鎖定！");
});

// 3. 讀取專案（依角色權限過濾）
function loadProjects() {
  let q;
  if (currentUserData.role === "admin" || currentUserData.role === "top_manager") {
    // 最高層與管理者看全體
    q = query(collection(db, "projects"));
  } else {
    // 一般設計師僅能看本人
    q = query(collection(db, "projects"), where("ownerId", "==", auth.currentUser.uid));
  }

  onSnapshot(q, (snapshot) => {
    const listEl = document.getElementById("project-list");
    listEl.innerHTML = "";
    const ganttTasks = [];

    snapshot.forEach(docSnap => {
      const proj = docSnap.data();
      const pId = docSnap.id;
      const task = proj.tasks[0];

      ganttTasks.push({
        id: pId,
        name: `${proj.title} - ${task.name}`,
        start: task.start,
        end: task.end,
        progress: task.isCompleted ? 100 : 0
      });

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <strong>${proj.title}</strong> (${proj.ownerName})<br>
        任務：${task.name} (${task.start} ~ ${task.end})<br>
        狀態：${task.isCompleted ? `已完成 (${task.completedAt})` : '進行中'}
        ${task.delayReason ? `<span class="badge delay">Delay: ${task.delayReason}</span>` : ''}
        ${!task.isCompleted ? `<button onclick="completeTask('${pId}', '${task.end}')">點選完成</button>` : ''}
      `;
      listEl.appendChild(card);
    });

    if (ganttTasks.length > 0) {
      document.getElementById("gantt-chart").innerHTML = "";
      new Gantt("#gantt-chart", ganttTasks, { view_mode: 'Day' });
    }
  });
}

// 4. 點選完成與 Delay 檢查
window.completeTask = async (projId, plannedEnd) => {
  const today = new Date().toISOString().split('T')[0];
  let delayReason = "";

  if (today > plannedEnd) {
    delayReason = prompt("已超過預計完成時間，請填寫 Delay 原因：");
    if (!delayReason) return alert("必須填寫 Delay 原因才能提交！");
  }

  const projRef = doc(db, "projects", projId);
  const projSnap = await getDoc(projRef);
  const tasks = projSnap.data().tasks;
  tasks[0].isCompleted = true;
  tasks[0].completedAt = new Date().toLocaleString();
  tasks[0].delayReason = delayReason;

  await updateDoc(projRef, { tasks });
  alert("進度已更新！");
};
