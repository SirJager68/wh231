const params = new URLSearchParams(window.location.search);
const line = params.get('line');
let currentItem = null;
let editField = null;

// === Load item and edits ===
// async function loadItem() {
//     try {
//         const res = await fetch(`/api/items/${line}/compare`);
//         const data = await res.json();
//         const { item, edits } = data;
//         currentItem = item;
//         const el = document.getElementById('item');

//         el.innerHTML = `
//       <h2>Item #${item.line_number}</h2>
//       <table class="compare-table">
//         <thead><tr><th>Field</th><th>Original</th><th>Edited</th><th></th></tr></thead>
//         <tbody>
//           ${renderRow("room_area", "Room / Area", item.room_area, edits.room_area)}
//           ${renderRow("quantity", "Quantity", item.quantity, edits.quantity)}
//           ${renderRow("description", "Description", item.description, edits.description)}
//           ${renderRow("brand", "Brand", item.brand, edits.brand)}
//           ${renderRow("model", "Model", item.model, edits.model)}
//           ${renderRow("unit_rcv", "Unit RCV", formatMoney(item.unit_rcv), edits.unit_rcv)}
//           ${renderRow("extended_rcv", "Extended RCV", formatMoney(item.extended_rcv), edits.extended_rcv)}
//           ${renderRow("acv_percent", "ACV %", item.acv_percent, edits.acv_percent)}
//           ${renderRow("acv", "ACV", formatMoney(item.acv), edits.acv)}
//           ${renderRow("notes", "Notes", item.notes, edits.notes)}
//           ${renderRow("source_link", "Source", item.source_link ? `<a href='${item.source_link}' target='_blank'>View</a>` : "N/A", edits.source_link)}
//         </tbody>
//       </table>
//     `;

//         await loadHistory();
//     } catch (err) {
//         console.error("Error loading item:", err);
//         document.getElementById('item').innerHTML = "<p>Error loading item details.</p>";
//     }
// }
async function loadItem() {
    try {
        const res = await fetch(`/api/items/${line}/compare`);
        const data = await res.json();
        const { item, edits } = data;
        currentItem = item;
        const el = document.getElementById('item');

        // === STATUS DROPDOWN SECTION ===
        const statusHTML = `
      <h2>Item #${item.line_number}</h2>
      <div style="margin:10px 0 20px 0; display:flex; align-items:center; gap:10px;">
        <label><b>Status:</b></label>
        <select id="statusSelect" onchange="changeStatus(this.value)" style="padding:4px 8px; border-radius:4px;">
          <option value="1">📋 Open</option>
          <option value="50">🕓 In Progress</option>
          <option value="99">✅ Complete</option>
        </select>
        <span id="statusBadge" style="padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600;"></span>
      </div>
    `;

        el.innerHTML = `
      ${statusHTML}
      <table class="compare-table">
        <thead><tr><th>Field</th><th>Original</th><th>Edited</th><th></th></tr></thead>
        <tbody>
          ${renderRow("room_area", "Room / Area", item.room_area, edits.room_area)}
          ${renderRow("quantity", "Quantity", item.quantity, edits.quantity)}
          ${renderRow("description", "Description", item.description, edits.description)}
          ${renderRow("brand", "Brand", item.brand, edits.brand)}
          ${renderRow("model", "Model", item.model, edits.model)}
          ${renderRow("unit_rcv", "Unit RCV", formatMoney(item.unit_rcv), edits.unit_rcv)}
          ${renderRow("extended_rcv", "Extended RCV", formatMoney(item.extended_rcv), edits.extended_rcv)}
          ${renderRow("acv_percent", "ACV %", item.acv_percent, edits.acv_percent)}
          ${renderRow("acv", "ACV", formatMoney(item.acv), edits.acv)}
          ${renderRow("notes", "Notes", item.notes, edits.notes)}
          ${renderRow(
            "source_link",
            "Source",
            item.source_link
                ? "<a href='" + item.source_link + "' target='_blank'>View</a>"
                : "N/A",
            edits.source_link
        )}

        </tbody>
      </table>
    `;

        // === Apply Status Value and Badge ===
        const sel = document.getElementById("statusSelect");
        sel.value = item.status || 1;

        const badge = document.getElementById("statusBadge");
        const { label, color } = getStatusDisplay(item.status);
        badge.textContent = label;
        badge.style.background = color.bg;
        badge.style.color = color.text;

        await loadHistory();
    } catch (err) {
        console.error("Error loading item:", err);
        document.getElementById('item').innerHTML = "<p>Error loading item details.</p>";
    }
}

function getStatusDisplay(code) {
    const num = Number(code);
    switch (num) {
        case 99:
            return { label: "✅ Complete", color: { bg: "#d1f7c4", text: "#146c2f" } };
        case 50:
            return { label: "🕓 In Progress", color: { bg: "#fff3cd", text: "#856404" } };
        case 1:
            return { label: "📋 Open", color: { bg: "#e3f2fd", text: "#0d47a1" } };
        case 0:
            return { label: "🗃 Archived", color: { bg: "#f1f1f1", text: "#555" } };
        default:
            return { label: "Unknown", color: { bg: "#eee", text: "#333" } };
    }
}

async function changeStatus(newStatus) {
    if (!currentItem) return;
    const oldStatus = currentItem.status;
    if (Number(newStatus) === Number(oldStatus)) return;

    const confirmChange = confirm(
        `Change status from ${getStatusDisplay(oldStatus).label} → ${getStatusDisplay(newStatus).label}?`
    );
    if (!confirmChange) {
        document.getElementById("statusSelect").value = oldStatus;
        return;
    }

    const body = {
        field_name: "status",
        old_value: oldStatus,
        new_value: newStatus,
        edited_by: "admin"
    };

    try {
        const res = await fetch(`/api/items/${line}/edit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            await loadItem();  // reload to show new status and badge
        } else {
            alert("Error updating status");
        }
    } catch (err) {
        console.error("Status update error:", err);
        alert("Error updating status");
    }
}

// === Load edit history ===
async function loadHistory() {
    const res = await fetch(`/api/items/${line}/edits`);
    const edits = await res.json();
    const tbody = document.getElementById('historyBody');
    if (!edits.length) {
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center;color:#999;'>No edits yet.</td></tr>";
        return;
    }
    tbody.innerHTML = edits.map(e => `
    <tr>
      <td>${new Date(e.edited_at).toLocaleString()}</td>
      <td>${e.field_name}</td>
      <td>${e.old_value || ""}</td>
      <td>${e.new_value || ""}</td>
      <td>${e.edited_by}</td>
    </tr>
  `).join("");
}

function renderRow(field, label, value, edit) {
    // define which fields are read-only
    const readOnlyFields = ["extended_rcv"];

    const editedHTML = edit ? `
    <div class="edited">
      ${edit.new_value || ""}
      <small>(${edit.edited_by || "user"}, ${new Date(edit.edited_at).toLocaleDateString()})</small>
    </div>` : `<span style="color:#999;">–</span>`;

    // show Locked instead of Edit button
    const editCell = readOnlyFields.includes(field)
        ? `<span style="color:#999;">Locked</span>`
        : `<button class="edit-btn" onclick="openModal('${field}','${value ?? ''}')">Edit</button>`;

    return `
    <tr>
      <td><b>${label}</b></td>
      <td>${value ?? ""}</td>
      <td>${editedHTML}</td>
      <td>${editCell}</td>
    </tr>`;
}


function openModal(field, value) {
    editField = field;
    document.getElementById('editField').innerText = `Edit ${field}`;
    document.getElementById('newValue').value = value;
    document.getElementById('editModal').style.display = 'flex';
}
function closeModal() { document.getElementById('editModal').style.display = 'none'; }

document.getElementById('saveEdit').addEventListener('click', async () => {
    const newVal = document.getElementById('newValue').value;
    if (!editField) return;
    const body = {
        field_name: editField,
        old_value: currentItem[editField],
        new_value: newVal,
        edited_by: 'admin'
    };
    await fetch(`/api/items/${line}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    closeModal();
    loadItem();
});

function formatMoney(v) { return v ? `$${Number(v).toFixed(2)}` : ''; }

loadItem();
