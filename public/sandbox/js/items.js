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
    const res = await fetch(`/api/items?limit=${pageSize}&offset=${offset}&search=${encodeURIComponent(currentSearch)}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    console.error("Error loading items:", err);
  }
}

function formatCurrency(value) {
  const num = Number(value || 0);
  if (isNaN(num)) return "";
  return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function render(data) {
  const tbody = document.querySelector("tbody");
  tbody.innerHTML = "";

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;color:#888;'>No items found.</td></tr>";
    return;
  }

  data.items.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.line_number || ""}</td>
      <td>${item.room_area || ""}</td>
      <td>${item.quantity || ""}</td>
      <td>${item.description || ""}</td>
      <td>${formatCurrency(item.unit_rcv)}</td>
      <td>${formatCurrency(item.extended_rcv)}</td>
    `;

    // ✅ click row to open detail page
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

// === INIT ===
loadItems();
