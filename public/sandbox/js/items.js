// ======================================================
// items.js — Handles list view, paging, and search
// ======================================================

let currentPage = 1;
let pageSize = 25;
let currentSearch = "";
let totalPages = 1;

async function loadItems() {
  try {
    const offset = (currentPage - 1) * pageSize;
    const status = document.getElementById("statusFilter")?.value || ""; // get selected status (if dropdown exists)
    const search = encodeURIComponent(currentSearch || "");

    const url = `/api/items?limit=${pageSize}&offset=${offset}&search=${search}&status=${status}`;
    const res = await fetch(url);
    const data = await res.json();

    render(data);
  } catch (err) {
    console.error("Error loading items:", err);
  }
}


// === Add new item ===
document.getElementById("addBtn").onclick = () => {
    document.getElementById("addModal").style.display = "flex";
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

document.getElementById("exportBtn").addEventListener("click", () => {
    const search = encodeURIComponent(currentSearch);
    window.location.href = `/api/export/items?search=${search}`;
});

document.getElementById("statusFilter").addEventListener("change", () => {
  currentPage = 1;
  loadItems();
});


// === INIT ===
loadItems();
