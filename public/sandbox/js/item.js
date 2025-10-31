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
        await loadItemLabelPreview(item.id);

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
    const readOnlyFields = ["extended_rcv"];

    const editedHTML = edit
        ? `
      <div class="edited">
        ${edit.new_value || ""}
        <small>(${edit.edited_by || "user"}, ${new Date(edit.edited_at).toLocaleDateString()})</small>
      </div>`
        : `<span style="color:#999;">–</span>`;

    let editCell;

    if (readOnlyFields.includes(field)) {
        editCell = `<span style="color:#999;">Locked</span>`;
    }
    else if (field === "room_area") {
        // 👇 Only dropdown, no typing allowed
        editCell = `<button class="edit-btn" onclick="openRoomDropdown('${field}','${value ?? ''}')">Edit</button>`;
    }
    else if (field === "source_link") {
        editCell = `<button class="edit-btn" onclick="openModal('source_link', document.querySelector('#item a')?.href || '')">Edit</button>`;
    }
    else {
        editCell = `<button class="edit-btn" onclick="openModal('${field}','${value ?? ''}')">Edit</button>`;
    }

    return `
    <tr>
      <td><b>${label}</b></td>
      <td>${value ?? ""}</td>
      <td>${editedHTML}</td>
      <td>${editCell}</td>
    </tr>`;
}


async function openRoomDropdown(field, currentValue) {
    editField = field;
    const modal = document.getElementById("editModal");
    const content = modal.querySelector(".modal-content");

    try {
        const res = await fetch("/api/spaces");
        const spaces = await res.json();

        const selectHTML = `
      <h3>Select Room / Area</h3>
      <select id="newValue" style="width:100%;padding:8px;">
        ${spaces
                .map(
                    s =>
                        `<option value="${s.space_name}" ${s.space_name === currentValue ? "selected" : ""
                        }>${s.space_name}</option>`
                )
                .join("")}
      </select>
      <div style="text-align:right;margin-top:10px;">
        <button onclick="closeModal()">Cancel</button>
        <button id="saveEdit">Save</button>
      </div>
    `;
        content.innerHTML = selectHTML;
        modal.style.display = "flex";

        document.getElementById("saveEdit").onclick = async () => {
            const newVal = document.getElementById("newValue").value;
            await saveFieldChange(editField, currentItem[editField], newVal);
        };
    } catch (err) {
        console.error("Error loading spaces:", err);
        alert("Error loading room list.");
    }
}

async function saveFieldChange(field, oldVal, newVal) {
    const body = {
        field_name: field,
        old_value: oldVal,
        new_value: newVal,
        edited_by: "admin"
    };
    await fetch(`/api/items/${line}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    closeModal();
    loadItem();
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

// === Display room image if this item has a label ===
async function loadItemLabelPreview(itemId) {
    try {
        const res = await fetch(`/api/items/${itemId}/labelinfo`);
        const data = await res.json();

        // No label → nothing to show
        if (!data.hasLabel || !data.image_url) return;

        // === Create preview block ===
        const wrapper = document.createElement("div");
        wrapper.style.marginTop = "30px";
        wrapper.style.paddingTop = "15px";
        wrapper.style.borderTop = "1px solid #ddd";

        wrapper.innerHTML = `
      <h3 style="margin-bottom:10px;">📸 Location in Room</h3>
      <div style="position:relative;display:inline-block;">
        <img src="${data.image_url}" 
             alt="${data.space_name}" 
             style="max-width:520px;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.15);" />
        <div style="
          position:absolute;
          left:${data.x_percent}%;
          top:${data.y_percent}%;
          transform:translate(-50%,-50%);
          width:16px;
          height:16px;
          background:#ff3b30;
          border:2px solid white;
          border-radius:50%;
          box-shadow:0 1px 4px rgba(0,0,0,0.4);
        "></div>
      </div>
      <p style="margin-top:8px;font-size:13px;color:#555;">
        <b>${data.space_name}</b> — ${data.label_text || "Labeled Item"}
      </p>
      <button style="
          background:#0056d2;
          color:white;
          border:none;
          padding:6px 10px;
          border-radius:5px;
          cursor:pointer;
      " 
      onclick="window.location.href='/sandbox/space-labeler.html?id=${data.space_id}&name=${encodeURIComponent(data.space_name)}'">
        🏠 View Full Room
      </button>
    `;

        // ✅ Attach it right under your #item card
        const itemCard = document.getElementById("item");
        itemCard.appendChild(wrapper);
    } catch (err) {
        console.error("Error loading label preview:", err);
    }
}



function formatMoney(v) { return v ? `$${Number(v).toFixed(2)}` : ''; }

loadItem();
