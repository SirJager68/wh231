// ======================================================
// items.js — Handles list view, paging, and search
// ======================================================

let currentPage = 1;
let pageSize = 25;
let currentSearch = "";
let totalPages = 1;
let currentRoom = "";
let spacesMode = false; // false = list view, true = room view



async function loadItems() {
    try {
        const offset = (currentPage - 1) * pageSize;
        const status = document.getElementById("statusFilter")?.value || ""; // get selected status (if dropdown exists)
        const search = encodeURIComponent(currentSearch || "");

        //const url = `/api/items?limit=${pageSize}&offset=${offset}&search=${search}&status=${status}`;
        const room = encodeURIComponent(currentRoom || "");
        const url = `/api/items?limit=${pageSize}&offset=${offset}&search=${search}&status=${status}&room=${room}`;

        const res = await fetch(url);
        const data = await res.json();

        render(data);
        await updateTotalRCV();

    } catch (err) {
        console.error("Error loading items:", err);
    }
}

async function updateTotalRCV() {
  try {
    const res = await fetch("/api/clients/1/totalrcv");
    const data = await res.json();
    const total = data.total_extended_rcv || 0;
    document.getElementById("totalRCVDisplay").textContent =
      `Total Extended RCV: $${Number(total).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
  } catch (err) {
    console.error("Error fetching total RCV:", err);
  }
}


// === Render Spaces Mode ===
async function renderSpacesMode() {
  const listContainer = document.getElementById("itemsContainer");
  const spacesView = document.getElementById("spacesView");
  const roomFilter = document.getElementById("roomFilter");

  // 🧱 Defensive checks
  if (!listContainer || !spacesView) {
    console.warn("⚠️ Missing #itemsContainer or #spacesView in HTML.");
    return;
  }

  if (!roomFilter) {
    alert("Room selector not found on page.");
    return;
  }

  const room = roomFilter.value;

  // === Toggle back to list mode ===
  if (!spacesMode) {
    listContainer.style.display = "block";
    spacesView.innerHTML = "";
    spacesView.style.display = "none";
    return;
  }

  // === Must select a room first ===
  if (!room) {
    alert("Select a room first.");
    spacesMode = false;
    document.getElementById("toggleSpacesMode").textContent = "🏠 Spaces Mode";
    return;
  }

  try {
    // === 1️⃣ Fetch room data ===
    const res = await fetch(`/api/spaces?client_id=1`);
    const spaces = await res.json();
    const space = spaces.find((s) => s.space_name === room);

    // === 2️⃣ Fetch items for that room ===
    const itemsRes = await fetch(`/api/items?search=${encodeURIComponent(room)}`);
    const itemsData = await itemsRes.json();

    // === 3️⃣ Build image HTML ===
    const imgHTML = space?.image_url
      ? `<img src="${space.image_url}" alt="${room}" style="max-width:600px;border-radius:8px;margin-bottom:15px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">`
      : `<p style="color:#999;">No image available for this room.</p>`;

    // === 4️⃣ Build items table HTML ===
    const tableHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th><th>Description</th><th>Brand</th><th>Model</th><th>Qty</th><th>RCV</th>
          </tr>
        </thead>
        <tbody>
          ${itemsData.items
            .map(
              (i) => `
              <tr>
                <td>${i.line_number ?? ""}</td>
                <td>${i.description ?? ""}</td>
                <td>${i.brand ?? ""}</td>
                <td>${i.model ?? ""}</td>
                <td>${i.quantity ?? ""}</td>
                <td style="text-align:right;">
                  ${
                    i.unit_rcv && !isNaN(i.unit_rcv)
                      ? "$" + Number(i.unit_rcv).toFixed(2)
                      : ""
                  }
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;

    // === 5️⃣ Render ===
    listContainer.style.display = "none";
    spacesView.innerHTML = `
      <div class="card">
        <h2>${room}</h2>
        ${imgHTML}
        ${tableHTML}
      </div>
    `;
    spacesView.style.display = "block";
  } catch (err) {
    console.error("Spaces Mode error:", err);
    alert("Error loading room view.");
  }
}



// === Add new item ===
document.getElementById("addBtn").onclick = async () => {
    const modal = document.getElementById("addModal");
    const roomSelect = document.getElementById("addRoom");

    try {
        const res = await fetch("/api/spaces");
        const rooms = await res.json();

        if (!rooms.length) {
            roomSelect.innerHTML = `<option value="">No rooms found</option>`;
        } else {
            roomSelect.innerHTML =
                `<option value="">Select Room / Area</option>` +
                rooms.map(r => `<option value="${r.space_name}">${r.space_name}</option>`).join("");
        }
    } catch (err) {
        console.error("Error loading rooms:", err);
        roomSelect.innerHTML = `<option value="">Error loading rooms</option>`;
    }

    modal.style.display = "flex";
};

function closeAdd() {
    document.getElementById("addModal").style.display = "none";
}

async function saveNewItem() {
    const body = {
        room_area: document.getElementById("addRoom").value,
        description: document.getElementById("addDesc").value,
        quantity: parseInt(document.getElementById("addQty").value || "1"),
        unit_rcv: parseFloat(document.getElementById("addUnit").value || "0"),
    };

    const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (res.ok) {
        alert("Item added!");
        closeAdd();
        window.location.reload();
    } else {
        alert("Error adding item");
    }
}

// === Delete selected item ===
let selectedLine = null;
document.querySelector("tbody").addEventListener("click", (e) => {
    const row = e.target.closest("tr");
    if (!row) return;
    selectedLine = row.dataset.line;
    document.querySelectorAll("tbody tr").forEach(r => r.style.background = "");
    row.style.background = "#fee";
});

document.getElementById("deleteBtn").onclick = async () => {
    if (!selectedLine) return alert("Select a row to delete first.");
    if (!confirm("Are you sure you want to delete this item?")) return;

    const res = await fetch(`/api/items/${selectedLine}`, { method: "DELETE" });
    if (res.ok) {
        alert("Deleted!");
        window.location.reload();
    } else {
        alert("Error deleting item.");
    }
};


function formatCurrency(value) {
    const num = Number(value || 0);
    if (isNaN(num)) return "";
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function render(data) {
    const tbody = document.querySelector("tbody");
    tbody.innerHTML = "";

    if (!data.items || data.items.length === 0) {
        tbody.innerHTML = "<tr><td colspan='7' style='text-align:center;color:#888;'>No items found.</td></tr>";
        return;
    }

    data.items.forEach((item) => {
        const lastEdit = item.last_edit_date
            ? new Date(item.last_edit_date).toLocaleDateString()
            : null;

        const editTag = lastEdit
            ? `<span class="tag-edited">Edited ${lastEdit}</span>`
            : "";

        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${item.line_number || ""}</td>
      <td>${item.room_area || ""}</td>
      <td>${item.quantity || ""}</td>
      <td>${item.description || ""} ${editTag}</td>
      <td>${formatCurrency(item.unit_rcv)}</td>
      <td>${formatCurrency(item.extended_rcv)}</td>
      <td>${item.status || ""}</td>
    `;

        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
            window.location.href = `/sandbox/item.html?line=${item.line_number}`;
        });

        tbody.appendChild(tr);
    });

    totalPages = data.pages;
    document.getElementById("pageInfo").textContent = `Page ${data.page} of ${data.pages}`;
    document.getElementById("prevBtn").disabled = data.page <= 1;
    document.getElementById("nextBtn").disabled = data.page >= data.pages;
}


function renderStatusBadge(code) {
    const num = Number(code ?? 1);
    switch (num) {
        case 99:
            return `<span style="background:#d1f7c4; color:#146c2f; padding:3px 8px; border-radius:6px; font-size:12px;">✅ Complete</span>`;
        case 50:
            return `<span style="background:#fff3cd; color:#856404; padding:3px 8px; border-radius:6px; font-size:12px;">🕓 In Progress</span>`;
        case 1:
            return `<span style="background:#e3f2fd; color:#0d47a1; padding:3px 8px; border-radius:6px; font-size:12px;">📋 Open</span>`;
        case 0:
            return `<span style="background:#f1f1f1; color:#555; padding:3px 8px; border-radius:6px; font-size:12px;">🗃 Archived</span>`;
        default:
            return `<span style="background:#eee; color:#333; padding:3px 8px; border-radius:6px; font-size:12px;">Unknown</span>`;
    }
}

// === Load spaces for dropdown ===
async function loadRooms() {
    try {
        const res = await fetch("/api/spaces");
        const rooms = await res.json();
        const select = document.getElementById("roomFilter");
        select.innerHTML = `<option value="">All Rooms / Areas</option>` +
            rooms.map(r => `<option value="${r.space_name}">${r.space_name}</option>`).join("");
    } catch (err) {
        console.error("Error loading rooms:", err);
    }
}

// === Handle room change ===
document.getElementById("roomFilter").addEventListener("change", e => {
    currentRoom = e.target.value;
    currentPage = 1;
    loadItems();
});

// Load rooms on startup
loadRooms();



// === UI EVENT HANDLERS ===
document.getElementById("search").addEventListener("input", e => {
    currentSearch = e.target.value;
    currentPage = 1;
    loadItems();
});

document.getElementById("pageSize").addEventListener("change", e => {
    pageSize = parseInt(e.target.value);
    currentPage = 1;
    loadItems();
});

document.getElementById("prevBtn").addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage--;
        loadItems();
    }
});

document.getElementById("nextBtn").addEventListener("click", () => {
    if (currentPage < totalPages) {
        currentPage++;
        loadItems();
    }
});

// document.getElementById("exportBtn").addEventListener("click", () => {
//     const search = encodeURIComponent(currentSearch);
//     window.location.href = `/api/export/items?search=${search}`;
// });

document.getElementById("statusFilter").addEventListener("change", () => {
    currentPage = 1;
    loadItems();
});

document.getElementById("toggleSpacesMode").addEventListener("click", () => {
    spacesMode = !spacesMode;
    const btn = document.getElementById("toggleSpacesMode");
    btn.textContent = spacesMode ? "🧾 List Mode" : "🏠 Spaces Mode";
    renderSpacesMode();
});



// === INIT ===
loadItems();

